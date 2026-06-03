// Coordinator — Floor 루프 상태머신([222]). single-flight 턴 루프 + **속도 경쟁 floor**([221] R2 원문).
// [중요] react/react-dom/DOM 미import(core 순수성, [224] §1). UI는 hooks(콜백)로만 구독.
// 경쟁 모델: 사람 입력 → 후보 전원 동시 생성 → 가장 먼저 토큰 낸 자가 floor 선점·발언, 나머지 즉시 중단(abort).
//           승자 발언이 끝나면 남은 후보가 그 발언을 본 맥락으로 다시 경쟁·재생성. 큐 소진까지(R1 각 1회, R3).
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
}

export interface CoordinatorOptions {
  whisperTimeoutMs?: number
  willSpeak?: (p: Participant) => boolean | Promise<boolean> // D2: P0=전원(기본 true). P1+ opt-out
  contextLimit?: ContextLimit // [M4] 발화 컨텍스트 윈도우(누적 폭증 방지). 미지정 시 무제한
  autoDelayMs?: number // [C3] 자동 대화 턴 간 지연(기본 3000)
  autoMaxTurns?: number // [C3] 자동 대화 최대 연속 턴(폭주 방지, 기본 8)
}

const DEFAULT_WHISPER_TIMEOUT_MS = 30_000

export class Coordinator {
  private spokeThisTurn = new Set<ParticipantId>()
  private turnState = new Map<ParticipantId, TurnState>()
  private current: AbortController | null = null // 현재 라운드(경쟁+승자)의 마스터 abort — 사람 인터럽트(D3)용
  private pending: Message | null = null // [H-1] 대기 사람 입력(최신만). 인터럽트 = 이 슬롯 교체
  private busy = false // [H-1] 턴 루프 single-flight 가드
  private whispers = new Map<ParticipantId, Whisper>() // [H2] 휘발 — RoomSession과 분리([223] §2)
  private readonly whisperTimeoutMs: number
  private readonly willSpeak: (p: Participant) => boolean | Promise<boolean>
  private readonly contextLimit?: ContextLimit
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
  // 경쟁에서 토큰을 못 낸(타임아웃/무응답) 후보를 조용히 버리지 않고 공개 로그에 (응답 없음)으로 표시.
  // status='error' + 빈 텍스트 → UI가 (응답 없음). done이 아니라 컨텍스트엔 미주입([223] §4), MD엔 _(중단/응답없음)_.
  private indicateNoResponse(by: ParticipantId) {
    const p = this.room.participants.find((x) => x.id === by)
    if (!p) return
    const msg: Message = { id: newMessageId(), turnNo: this.room.turnNo, by, role: p.kind, text: '', status: 'error', ts: Date.now() }
    this.publishNew(msg)
    this.setState(by, 'stopped')
  }

  // ===== 진입점(유일) =====
  startTurn(humanMsg: Message) {
    humanMsg.status = 'done' // [C-1]
    this.pending = humanMsg
    if (this.autoMode) this.setAuto(false) // [C3] 사람 입력 → 자동 일시정지(사람 우선)
    if (this.busy) this.current?.abort() // [D3] 진행 중(경쟁/발언/지연) 즉시 중단. 루프가 pending을 다음 턴으로
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
          await this.runTurn(humanMsg) // 사람 턴: 전원 속도 경쟁
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

  private async runTurn(humanMsg: Message) {
    this.room.turnNo++
    this.room.status = 'turn_active'
    this.spokeThisTurn.clear()
    humanMsg.turnNo = this.room.turnNo
    this.publishNew(humanMsg) // 사람의 1회 공개 발언(status='done')
    this.spokeThisTurn.add(humanMsg.by)
    this.setState(humanMsg.by, 'done') // [C-1]
    this.notifyRoom()

    // 발언 후보(AI, R1: 각 1회). D2 willSpeak. 미발언 후보 집합.
    const remaining = new Set((await this.collectSpeakers()).map((p) => p.id))
    for (const id of remaining) this.setState(id, 'queued') // 경쟁 대기 표시

    // 속도 경쟁 라운드: 먼저 응답한 후보가 floor 선점·발언 → 나머지 중단 → 남은 후보 재경쟁(재생성). 큐 소진까지(R3).
    while (remaining.size > 0 && !this.pending) {
      const { winner, failed } = await this.raceRound(remaining)
      for (const f of failed) {
        remaining.delete(f) // 응답 못한 후보(타임아웃/무토큰)는 이번 턴 제외
        this.indicateNoResponse(f) // 조용한 드랍 대신 공개 로그에 (응답 없음) 표식
      }
      if (winner) {
        remaining.delete(winner)
        this.spokeThisTurn.add(winner)
      } else {
        break // 아무도 응답 못함
      }
    }

    this.room.floorHolder = null // [H-1] 턴 종료 시에만 null
    if (!this.pending) this.room.status = 'idle' // 대기 인터럽트 있으면 idle로 안 떨굼
    this.notifyRoom()
  }

  // D2: 발언할 AI를 좌석순으로([H4] tie-break). P0=전원(willSpeak 기본 true). [C1] 훅 throw 가드.
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

  // 한 라운드 경쟁: remaining 후보를 동시 생성 → 첫 토큰 선점 승자 발언(끝까지), 나머지 abort(다음 라운드 재생성).
  // 토큰 없이 종료/에러한 후보는 failed(이번 턴 제외). 반환: 승자 + 실패목록.
  private async raceRound(remaining: Set<ParticipantId>): Promise<{ winner: ParticipantId | null; failed: ParticipantId[] }> {
    const racers = [...remaining].map((id) => {
      const ac = new AbortController()
      const iterator = this.driver.speak(buildSpeakContext(this.room, id, this.contextLimit), ac.signal)[Symbol.asyncIterator]()
      return { id, ac, iterator }
    })
    // [D3] 마스터 abort(사람 인터럽트) → 라운드 전원 취소
    const master = new AbortController()
    this.current = master
    const cancelAll = () => {
      for (const r of racers) r.ac.abort()
    }
    master.signal.addEventListener('abort', cancelAll, { once: true })

    // 각 racer를 첫 유효 토큰까지 진행시키는 프로미스(racer 식별 포함).
    const firsts = new Map<ParticipantId, Promise<{ id: ParticipantId; token: string | null }>>()
    for (const r of racers) firsts.set(r.id, this.pullFirstToken(r.id, r.iterator))

    const failed: ParticipantId[] = []
    let winnerId: ParticipantId | null = null
    try {
      while (firsts.size > 0 && !this.pending) {
        const settled = await Promise.race(firsts.values())
        firsts.delete(settled.id)
        if (settled.token !== null) {
          winnerId = settled.id
          // 승자 결정 → 나머지 즉시 중단(재생성 대상)
          for (const r of racers) if (r.id !== winnerId) r.ac.abort()
          const w = racers.find((r) => r.id === winnerId)!
          await this.streamWinner(w.id, w.iterator, w.ac.signal, settled.token) // 첫 토큰 + 나머지 스트림
          break
        }
        failed.push(settled.id) // 토큰 없이 종료/에러 → 탈락
      }
    } finally {
      if (!winnerId) cancelAll() // 인터럽트/전원 실패 시 정리
      this.current = null
    }
    return { winner: winnerId, failed }
  }

  // 첫 유효 토큰까지 iterator 진행. 토큰 없이 종료/에러면 token=null. (abort 시에도 catch→null)
  private async pullFirstToken(
    id: ParticipantId,
    it: AsyncIterator<string>,
  ): Promise<{ id: ParticipantId; token: string | null }> {
    try {
      for (;;) {
        const r = await it.next()
        if (r.done) return { id, token: null }
        if (r.value) return { id, token: r.value }
      }
    } catch {
      return { id, token: null }
    }
  }

  // 승자 발언: floor 부여 + beginMessage + 첫 토큰 + 나머지 스트림. 화자 turn-state 단일 확정([H1]/[H-2]).
  private async streamWinner(id: ParticipantId, it: AsyncIterator<string>, signal: AbortSignal, firstToken: string): Promise<void> {
    this.room.floorHolder = id // [H-1] 직접 교체(null 경유 안 함)
    this.setState(id, 'speaking')
    this.notifyRoom()
    const msg = this.beginMessage(id, this.room.turnNo)
    try {
      this.appendToken(msg, firstToken) // 경쟁에서 이미 뽑은 첫 토큰
      for (;;) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        const r = await it.next()
        if (r.done) break
        if (r.value) this.appendToken(msg, r.value)
      }
      // [H1] 드라이버가 abort 무시하고 끝까지 와도 signal.aborted면 stopped(사람 인터럽트 항상 stopped 보장).
      const status: MessageStatus = signal.aborted ? 'stopped' : 'done'
      this.endMessage(msg, status)
      this.setState(id, status === 'done' ? 'done' : 'stopped')
    } catch {
      const st: MessageStatus = signal.aborted ? 'stopped' : 'error' // 부분 응답 보존
      this.endMessage(msg, st)
      this.setState(id, 'stopped') // [H-2] 드라이버 에러 = Message:error / Participant:stopped
    }
  }

  // [C3] 자동 턴 — 한 AI(라운드로빈)만 직전 대화에 반응해 발언(사람 opener 없음).
  private async runAutoTurn() {
    const ais = this.room.participants.filter((p) => p.kind === 'ai').sort((a, b) => a.seat - b.seat)
    if (ais.length === 0) {
      this.setAuto(false)
      return
    }
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

  // 단일 AI 발언 스트림(경쟁 없음 — 자동 턴용). 빈 응답은 (응답 없음)으로.
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
