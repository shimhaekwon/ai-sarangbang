// Coordinator — Floor 루프 상태머신([222] · [227]). single-flight 턴 루프 + **랜덤 순서 직렬 발언**.
// [중요] react/react-dom/DOM 미import(core 순수성, [224] §1). UI는 hooks(콜백)로만 구독.
// [227] 모델: 사람 입력 → 발언 후보 랜덤 추첨(셔플) → 추첨 순서대로 1명씩 직렬 발언(자원 독점 → 저사양 안정).
//        순서는 onOrder로 UI에 통지(순번 배지). 사람 인터럽트(D3)는 진행 중 발언 abort 후 다음 턴.
import type { AgentDriver } from '../drivers/AgentDriver'
import type { Message, MessageStatus, Participant, ParticipantId, RoomSession, TurnState, Whisper } from './types'
import { buildSpeakContext, whisperContext, type ContextLimit } from './context'
import { newMessageId } from './id'

export interface CoordinatorHooks {
  publish: (m: Message) => void
  onState: (id: ParticipantId, s: TurnState) => void
  onWhisper: (target: ParticipantId, thread: Whisper) => void
  onRoom?: () => void
  onAuto?: (active: boolean) => void // [C3] 자동 대화 모드 on/off 통지(UI 토글 동기화)
  onOrder?: (ranks: ReadonlyMap<ParticipantId, number>) => void // [227] 발언 순번(배지). 빈 Map = 클리어
}

export interface CoordinatorOptions {
  whisperTimeoutMs?: number
  willSpeak?: (p: Participant) => boolean | Promise<boolean> // D2: P0=전원(기본 true). P1+ opt-out
  contextLimit?: ContextLimit // [M4] 발화 컨텍스트 윈도우(누적 폭증 방지). 미지정 시 무제한
  autoDelayMs?: number // [C3] 자동 대화 턴 간 지연(기본 3000)
  autoMaxTurns?: number // [C3] 자동 대화 최대 연속 턴(폭주 방지, 기본 8)
  rng?: () => number // [227] 셔플 난수원([0,1)). 테스트 시드 주입. 기본은 전역 Math.random 함수 참조(호출 아님 → core-purity 가드 통과)
}

const DEFAULT_WHISPER_TIMEOUT_MS = 30_000

export class Coordinator {
  private spokeThisTurn = new Set<ParticipantId>()
  private turnState = new Map<ParticipantId, TurnState>()
  private current: AbortController | null = null // 현재 발언자 abort — 사람 인터럽트(D3)용
  private pending: Message | null = null // [H-1] 대기 사람 입력(최신만). 인터럽트 = 이 슬롯 교체
  private busy = false // [H-1] 턴 루프 single-flight 가드
  private whispers = new Map<ParticipantId, Whisper>() // [H2] 휘발 — RoomSession과 분리([223] §2)
  private readonly whisperTimeoutMs: number
  private readonly willSpeak: (p: Participant) => boolean | Promise<boolean>
  private readonly contextLimit?: ContextLimit
  private readonly rng: () => number // [227] 셔플 난수원
  // [C3] 자동 대화 모드
  private autoMode = false
  private autoLeft = 0 // 남은 자동 턴(0이면 종료)
  private autoCursor = 0 // 라운드로빈 화자 인덱스
  private readonly autoDelayMs: number
  private readonly autoMaxTurns: number

  constructor(
    private room: RoomSession,
    private driver: AgentDriver,
    private hooks: CoordinatorHooks,
    opts: CoordinatorOptions = {},
  ) {
    this.whisperTimeoutMs = opts.whisperTimeoutMs ?? DEFAULT_WHISPER_TIMEOUT_MS
    this.willSpeak = opts.willSpeak ?? (() => true)
    this.contextLimit = opts.contextLimit
    this.rng = opts.rng ?? Math.random
    this.autoDelayMs = opts.autoDelayMs ?? 3000
    this.autoMaxTurns = opts.autoMaxTurns ?? 8
  }

  // ===== 통지 헬퍼 =====
  private setState(id: ParticipantId, s: TurnState) {
    this.turnState.set(id, s)
    this.hooks.onState(id, s)
  }
  private notifyRoom() {
    this.hooks.onRoom?.()
  }
  private publishNew(msg: Message) {
    this.room.history.push(msg)
    this.hooks.publish(msg)
  }
  private publishUpdate(msg: Message) {
    this.hooks.publish(msg)
  }

  // ===== 헬퍼 계약 [222] §4.1 — 타이핑 효과 데이터 흐름의 단일 소스 =====
  private beginMessage(by: ParticipantId, turnNo: number): Message {
    const p = this.room.participants.find((x) => x.id === by)
    if (!p) throw new Error(`beginMessage: 알 수 없는 참가자 ${by}`)
    const msg: Message = { id: newMessageId(), turnNo, by, role: p.kind, text: '', status: 'streaming', ts: Date.now() }
    this.publishNew(msg)
    return msg
  }
  private appendToken(msg: Message, tok: string) {
    msg.text += tok
    this.publishUpdate(msg)
  }
  private endMessage(msg: Message, status: MessageStatus) {
    msg.status = status
    this.publishUpdate(msg)
  }

  // ===== 진입점(유일) =====
  startTurn(humanMsg: Message) {
    humanMsg.status = 'done' // [C-1]
    this.pending = humanMsg
    if (this.autoMode) this.setAuto(false) // [C3] 사람 입력 → 자동 일시정지(사람 우선)
    if (this.busy) this.current?.abort() // [D3] 진행 중(발언/지연) 즉시 중단. 루프가 pending을 다음 턴으로
    else void this.runLoop()
  }

  getTurnState(id: ParticipantId): TurnState {
    return this.turnState.get(id) ?? 'idle'
  }

  // [C3] 자동 대화 시작/정지 — 사람 없이 AI끼리 라운드로빈으로 진행.
  startAutoMode() {
    this.autoLeft = this.autoMaxTurns
    this.setAuto(true)
    if (!this.busy) void this.runLoop()
  }
  stopAutoMode() {
    this.setAuto(false)
    this.current?.abort() // 진행 중 자동 발언/지연 즉시 중단
  }
  isAutoActive(): boolean {
    return this.autoMode
  }
  private setAuto(active: boolean) {
    if (this.autoMode === active) return
    this.autoMode = active
    this.hooks.onAuto?.(active)
  }

  // [H-1] 단일 비행 턴 루프 — busy 가드로 절대 중첩 없음. 인터럽트는 pending 교체로 흡수. [C3] 자동 모드 턴도 여기서.
  private async runLoop() {
    this.busy = true
    try {
      // 사람 입력(우선) 또는 자동 모드가 남아 있는 동안 턴을 돈다.
      while (this.pending || (this.autoMode && this.autoLeft > 0)) {
        if (this.pending) {
          const humanMsg = this.pending
          this.pending = null
          await this.runTurn(humanMsg) // 사람 턴: 랜덤 순서 직렬
        } else {
          await this.runAutoTurn() // [C3] 자동 턴: 한 AI(라운드로빈)만 발언
          this.autoLeft--
          if (this.autoMode && this.autoLeft > 0 && !this.pending) await this.interruptibleDelay(this.autoDelayMs)
        }
      }
    } finally {
      // [C1] busy는 어떤 경우에도 해제. 비정상 종료 시 안전 복귀(정상 경로는 runTurn 말미가 이미 처리).
      this.busy = false
      if (this.autoLeft <= 0) this.setAuto(false) // 최대 턴 도달 → 자동 종료(UI 토글 off)
      if (this.room.status !== 'idle' && !this.pending) {
        this.room.floorHolder = null
        this.room.status = 'idle'
        this.notifyRoom()
      }
    }
  }

  // [227] 사람 턴 — 발언 후보를 랜덤 추첨한 순서대로 1명씩 직렬 발언.
  private async runTurn(humanMsg: Message) {
    this.room.turnNo++
    this.room.status = 'turn_active'
    this.spokeThisTurn.clear()
    humanMsg.turnNo = this.room.turnNo
    this.publishNew(humanMsg) // 사람의 1회 공개 발언(status='done')
    this.spokeThisTurn.add(humanMsg.by)
    this.setState(humanMsg.by, 'done') // [C-1]
    this.notifyRoom()

    // 발언 순서 = 매 턴 랜덤 추첨(좌석순 고정 아님). 후보 = AI 전원(D2 willSpeak), R1 각 1회.
    const order = this.shuffle(await this.collectSpeakers())
    this.hooks.onOrder?.(new Map(order.map((p, i) => [p.id, i + 1]))) // [227] 1-based 순번(배지)
    for (const p of order) this.setState(p.id, 'queued') // 대기 표시

    // 추첨 순서대로 직렬 발언(자원 독점 → 저사양 안정). 사람 인터럽트(D3)면 즉시 중단(다음 턴으로).
    for (const p of order) {
      if (this.pending) break // [D3] 대기 사람 입력 → 루프 탈출, 다음 턴
      const ac = new AbortController()
      this.current = ac
      await this.speakOne(p.id, ac.signal)
      this.current = null
      this.spokeThisTurn.add(p.id)
    }
    // [M2] 인터럽트로 발언 못 한 후보의 queued 잔류 해제(stale 방지)
    for (const p of order) if (!this.spokeThisTurn.has(p.id)) this.setState(p.id, 'idle')

    this.room.floorHolder = null // [H-1] 턴 종료 시에만 null
    this.hooks.onOrder?.(new Map()) // [C2] 순번 배지 클리어(다음 턴까지 잔류 방지)
    if (!this.pending) this.room.status = 'idle' // 대기 인터럽트 있으면 idle로 안 떨굼
    this.notifyRoom()
  }

  // D2: 발언할 AI를 좌석순으로 수집(willSpeak). [C1] 훅 throw 가드. (발언 순서는 runTurn이 셔플)
  private async collectSpeakers(): Promise<Participant[]> {
    const ais = this.room.participants.filter((p) => p.kind === 'ai').sort((a, b) => a.seat - b.seat)
    const speakers: Participant[] = []
    for (const ai of ais) {
      let ok = false
      try {
        ok = await this.willSpeak(ai)
      } catch {
        ok = false
      }
      if (ok) speakers.push(ai)
    }
    return speakers
  }

  // [227] Fisher-Yates 셔플(주입 rng로 결정성). 원본 불변 → 복사본 반환.
  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1)) // rng: () => number ∈ [0,1)
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  // [227][H1] 직렬 발언 1건 — floor 연출(streamWinner 계승) + streamMessage 재사용.
  private async speakOne(id: ParticipantId, signal: AbortSignal): Promise<void> {
    this.room.floorHolder = id // [H-1] 직접 교체(null 경유 안 함)
    this.setState(id, 'speaking')
    this.notifyRoom()
    await this.streamMessage(id, signal) // 빈응답→error("응답 없음")·abort→stopped·드라이버에러→error 내장
  }

  // [C3] 자동 턴 — 한 AI(라운드로빈)만 직전 대화에 반응해 발언(사람 opener 없음).
  private async runAutoTurn() {
    const ais = this.room.participants.filter((p) => p.kind === 'ai').sort((a, b) => a.seat - b.seat)
    if (ais.length === 0) {
      this.setAuto(false)
      return
    }
    this.hooks.onOrder?.(new Map()) // [227][C2] 직전 사람턴 순번 배지 잔류 방지(자동턴 셔플=D-D 후속)
    const speaker = ais[this.autoCursor % ais.length]
    this.autoCursor++
    this.room.turnNo++
    this.room.status = 'turn_active'
    this.notifyRoom()
    this.room.floorHolder = speaker.id
    this.setState(speaker.id, 'speaking')
    this.notifyRoom()
    const ac = new AbortController()
    this.current = ac
    await this.streamMessage(speaker.id, ac.signal)
    this.current = null
    this.room.floorHolder = null
    if (!this.pending) this.room.status = 'idle'
    this.notifyRoom()
  }

  // 단일 AI 발언 스트림. 빈 응답은 (응답 없음)으로([227] H2: status='error' + 빈 텍스트).
  private async streamMessage(by: ParticipantId, signal: AbortSignal): Promise<void> {
    const msg = this.beginMessage(by, this.room.turnNo)
    try {
      for await (const tok of this.driver.speak(buildSpeakContext(this.room, by, this.contextLimit), signal)) {
        this.appendToken(msg, tok)
      }
      const status: MessageStatus = signal.aborted ? 'stopped' : msg.text ? 'done' : 'error'
      this.endMessage(msg, status)
      this.setState(by, status === 'done' ? 'done' : 'stopped')
    } catch {
      const st: MessageStatus = signal.aborted ? 'stopped' : 'error'
      this.endMessage(msg, st)
      this.setState(by, 'stopped')
    }
  }

  // 자동 턴 사이 지연 — 사람 입력(startTurn)·정지(stopAutoMode)의 current.abort()로 즉시 깨움(reject 아님, 그냥 진행).
  private interruptibleDelay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const ac = new AbortController()
      this.current = ac
      const t = setTimeout(() => {
        if (this.current === ac) this.current = null
        resolve()
      }, ms)
      ac.signal.addEventListener('abort', () => {
        clearTimeout(t)
        if (this.current === ac) this.current = null
        resolve()
      }, { once: true })
    })
  }

  // [H2] 귓속말 — floor 밖. 휘발 Map. 자체 타임아웃. [H-3] 컨텍스트는 whisperContext가 SpeakContext로.
  async whisper(target: ParticipantId, text: string) {
    if (!this.room.participants.some((p) => p.id === target)) {
      throw new Error(`whisper: 알 수 없는 대상 ${target}`) // [M2] 상태 변경·emit 전 검증
    }
    const w = this.whispers.get(target) ?? { target, messages: [] }
    this.whispers.set(target, w)
    w.messages.push({ by: 'human', text })
    const reply: { by: ParticipantId; text: string } = { by: target, text: '' }
    w.messages.push(reply)
    this.hooks.onWhisper(target, w) // [C1] 휘발 UI emit — 공개 publish 아님([222] §7)
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), this.whisperTimeoutMs)
    try {
      for await (const tok of this.driver.speak(whisperContext(target, w, this.room), ac.signal)) {
        reply.text += tok
        this.hooks.onWhisper(target, w)
      }
    } catch {
      /* abort/error: 부분 보존, 공개 로그·MD·스냅샷 미기록([223] §2) */
    } finally {
      clearTimeout(to)
    }
  }
}
