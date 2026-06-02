// Coordinator — Floor 루프 상태머신([222]). 본 제품의 심장. single-flight 루프로 race-free([222] §2).
// [중요] 이 파일은 react/react-dom/DOM을 import하지 않는다(core 순수성, [224] §1). UI는 hooks(콜백)로만 구독.
import type { AgentDriver } from '../drivers/AgentDriver'
import type { Intent, Message, MessageStatus, Participant, ParticipantId, RoomSession, TurnState, Whisper } from './types'
import { buildSpeakContext, whisperContext } from './context'
import { newMessageId } from './id'

// UI 동기화 콜백(seam) — core는 React/DOM을 모르고 이 sink들로만 변경을 통지([224] §1).
export interface CoordinatorHooks {
  // 새/갱신 Message 통지. history는 coordinator가 소유(room.history); 이 콜백은 UI 미러 갱신(append-or-update by id).
  publish: (m: Message) => void
  onState: (id: ParticipantId, s: TurnState) => void
  // [C1] 귓속말 휘발 UI emit — 공개 publish와 별개 채널(history/MD/스냅샷 미오염, [222] §7).
  onWhisper: (target: ParticipantId, thread: Whisper) => void
  // room 메타(status/turnNo/floorHolder) 변경 통지. UI가 room에서 재독. [구현보강] 222 §4 의사코드엔 턴 종료
  // floorHolder=null 통지 경로가 없어 추가 — UI가 floorHolder/status/turnNo를 구독하려면 필수([226] S2.5). 헤드리스는 생략 가능.
  onRoom?: () => void
}

export interface CoordinatorOptions {
  whisperTimeoutMs?: number // [226] §7 기본 30000. 무종료 hang 방지(드라이버 무관 안전망, [222] §6)
  willSpeak?: (p: Participant) => boolean | Promise<boolean> // D2 흡수: P0=전원(기본 true). P1+ opt-out 훅
}

const DEFAULT_WHISPER_TIMEOUT_MS = 30_000

export class Coordinator {
  private queue: Intent[] = [] // FIFO 발언 의사(D4: collectIntents가 좌석순 enqueue)
  private spokeThisTurn = new Set<ParticipantId>()
  private turnState = new Map<ParticipantId, TurnState>()
  private current: AbortController | null = null
  private pending: Message | null = null // [H-1] 대기 사람 입력(최신만 유효). 인터럽트 = 이 슬롯 교체
  private busy = false // [H-1] 턴 루프 single-flight 가드
  private whispers = new Map<ParticipantId, Whisper>() // [H2] 휘발 — RoomSession과 분리([223] §2)
  private readonly whisperTimeoutMs: number
  private readonly willSpeak: (p: Participant) => boolean | Promise<boolean>

  constructor(
    private room: RoomSession,
    private driver: AgentDriver,
    private hooks: CoordinatorHooks,
    opts: CoordinatorOptions = {},
  ) {
    this.whisperTimeoutMs = opts.whisperTimeoutMs ?? DEFAULT_WHISPER_TIMEOUT_MS
    this.willSpeak = opts.willSpeak ?? (() => true)
  }

  // ===== 통지 헬퍼(단일 소스) =====
  private setState(id: ParticipantId, s: TurnState) {
    this.turnState.set(id, s)
    this.hooks.onState(id, s)
  }
  private notifyRoom() {
    this.hooks.onRoom?.()
  }
  // 새 공개 Message: room.history(canonical) push + UI emit. update는 publishUpdate.
  private publishNew(msg: Message) {
    this.room.history.push(msg)
    this.hooks.publish(msg)
  }
  private publishUpdate(msg: Message) {
    this.hooks.publish(msg) // msg는 이미 room.history에 reference로 존재 → UI에 in-place 갱신 통지
  }

  // ===== 헬퍼 계약 [222] §4.1 — 타이핑 효과 데이터 흐름의 단일 소스 =====
  // Message 생성·publish. status='streaming', role은 participants.find(by).kind로 단독 채움([M-3]).
  private beginMessage(by: ParticipantId, turnNo: number): Message {
    const p = this.room.participants.find((x) => x.id === by)
    if (!p) throw new Error(`beginMessage: 알 수 없는 참가자 ${by}`)
    const msg: Message = { id: newMessageId(), turnNo, by, role: p.kind, text: '', status: 'streaming', ts: Date.now() }
    this.publishNew(msg)
    return msg
  }
  // 토큰 누적 + UI 갱신 emit. [중요] 타이핑 효과의 단일 소스 = 여기(UI Typewriter는 이 emit만 구독, [225] §4).
  private appendToken(msg: Message, tok: string) {
    msg.text += tok
    this.publishUpdate(msg)
  }
  // status 확정 후 동일 id 갱신 emit(재-publish 아님, in-place).
  private endMessage(msg: Message, status: MessageStatus) {
    msg.status = status
    this.publishUpdate(msg)
  }

  // ===== 진입점(유일) =====
  // 사람 입력. 진행 중이면 인터럽트(현재 abort + pending 교체), 유휴면 루프 시작([222] §4).
  startTurn(humanMsg: Message) {
    humanMsg.status = 'done' // [C-1] 사람 발언은 스트리밍 없음 → 즉시 done(컨텍스트 포함되도록)
    this.pending = humanMsg // 최신 입력만 유효(미처리 인터럽트는 덮어씀)
    if (this.busy) this.current?.abort() // [D3] 진행 중 발언 즉시 중단(부분 보존). 루프가 pending을 다음 턴으로
    else void this.runLoop() // 유휴 → 단일 루프 시작
  }

  // 현재 turn-state 조회(UI roster 초기 동기화·미발언자 기본 'idle').
  getTurnState(id: ParticipantId): TurnState {
    return this.turnState.get(id) ?? 'idle'
  }

  // [H-1] 단일 비행 턴 루프 — busy 가드로 절대 중첩 없음. 인터럽트는 pending 교체로 흡수.
  // (A) while 검사와 (C) busy=false 사이에 await가 없어, pending 설정은 항상 (A) 이전(처리됨) 또는 (C) 이후(새 루프)로 떨어짐 → 입력 유실/중첩 0.
  private async runLoop() {
    this.busy = true
    try {
      while (this.pending) {
        const humanMsg = this.pending
        this.pending = null
        await this.runTurn(humanMsg)
      }
    } finally {
      // [C1] busy는 어떤 경우에도 해제 — 턴 본문(예: willSpeak 훅) throw가 방을 영구 wedge하지 않도록(방어).
      this.busy = false
      // 비정상 종료 시 안전 복귀. 정상 경로는 runTurn 말미가 이미 idle 처리 → 조건 불충족으로 skip(중복 통지 없음).
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
    this.queue.length = 0 // 새 턴은 잔여 큐 폐기(인터럽트로 넘어온 경우 이전 큐 무효)
    this.spokeThisTurn.clear()
    humanMsg.turnNo = this.room.turnNo // 턴 번호 주입
    this.publishNew(humanMsg) // 사람의 1회 공개 발언(status='done')
    this.spokeThisTurn.add(humanMsg.by)
    this.setState(humanMsg.by, 'done') // [C-1] 사람 status='done'(AI가 질문 봄)
    this.notifyRoom()
    await this.collectIntents() // D2: P0=전원 좌석순
    await this.drainFloor() // R2 + R3
    this.room.floorHolder = null // [H-1] 턴 종료 시에만 null
    if (!this.pending) this.room.status = 'idle' // 대기 인터럽트 있으면 idle로 안 떨굼(루프가 곧 다음 턴)
    this.notifyRoom()
  }

  // 발언 의사 제출 — 출력 권한 아님. R1: 턴당 1회. [M-2] 턴 밖 차단.
  enqueue(intent: Intent) {
    if (this.room.status !== 'turn_active') return
    if (this.spokeThisTurn.has(intent.by)) return
    if (this.queue.some((q) => q.by === intent.by)) return
    this.queue.push(intent)
    this.setState(intent.by, 'queued')
  }

  // D2: 발언할 AI를 좌석순으로 enqueue. P0=전원(willSpeak 기본 true). [M-1] 턴 머리에서 1회 수집(정적 1뱃치).
  private async collectIntents() {
    const ais = this.room.participants.filter((p) => p.kind === 'ai').sort((a, b) => a.seat - b.seat) // [H4] 좌석순=D4
    for (const ai of ais) {
      let speaks = false
      try {
        speaks = await this.willSpeak(ai) // [C1] D2/P1 훅(모델·네트워크)이 throw/reject해도 방을 wedge하지 않게 가드
      } catch {
        speaks = false // 훅 실패 = 이번 턴 미발언으로 강등(graceful). P1은 별도 에러 훅으로 승격 가능
      }
      if (speaks) this.enqueue({ by: ai.id, turnNo: this.room.turnNo })
    }
  }

  // R2 + R3: 큐 소진까지 한 명씩. pending(인터럽트) 생기면 즉시 중단 → 루프가 새 턴으로.
  private async drainFloor() {
    while (this.queue.length && !this.pending) {
      const intent = this.queue.shift()!
      this.room.floorHolder = intent.by // [H-1] 직접 교체(null 경유 안 함)
      this.setState(intent.by, 'speaking')
      this.notifyRoom()
      const ac = new AbortController()
      this.current = ac
      await this.stream(intent, ac.signal) // 끝까지 await(R2). 화자 turn-state는 stream이 단일 확정([L1] 중복 emit 제거)
      this.spokeThisTurn.add(intent.by)
      this.current = null
    }
  }

  // 드라이버 스트림을 floor 보유자에게. done 감지 = stream-end([222] §6). 화자 turn-state를 단일 확정(Message·Participant 동시).
  private async stream(intent: Intent, signal: AbortSignal): Promise<void> {
    const msg = this.beginMessage(intent.by, this.room.turnNo)
    try {
      for await (const tok of this.driver.speak(buildSpeakContext(this.room, intent.by), signal)) {
        this.appendToken(msg, tok) // 토큰 누적 + UI emit(타이핑 효과 단일 소스, §4.1)
      }
      // [H1] 드라이버가 abort를 무시하고 stream-end까지 와도, signal.aborted면 stopped로 분류 → 사람 인터럽트가 항상 stopped 보장.
      const status: MessageStatus = signal.aborted ? 'stopped' : 'done'
      this.endMessage(msg, status)
      this.setState(intent.by, status === 'done' ? 'done' : 'stopped')
    } catch {
      const st: MessageStatus = signal.aborted ? 'stopped' : 'error' // 부분 응답 보존
      this.endMessage(msg, st)
      this.setState(intent.by, 'stopped') // [H-2] 화자 turn-state 즉시 확정. 드라이버 에러 = Message:error / Participant:stopped([H1])
    }
  }

  // [H2] 귓속말 — floor 밖. 휘발 Map. 자체 타임아웃. [H-3] 컨텍스트는 whisperContext가 SpeakContext로([223] §4.1).
  async whisper(target: ParticipantId, text: string) {
    if (!this.room.participants.some((p) => p.id === target)) {
      throw new Error(`whisper: 알 수 없는 대상 ${target}`) // [M2] 상태 변경·emit 전에 검증 — orphan 스레드/UI 유령 패널 방지
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
        this.hooks.onWhisper(target, w) // 토큰마다 휘발 emit(WhisperPanel 타이핑)
      }
    } catch {
      /* abort/error: 부분 보존, 공개 로그·MD·스냅샷 미기록([223] §2) */
    } finally {
      clearTimeout(to)
    }
  }
}
