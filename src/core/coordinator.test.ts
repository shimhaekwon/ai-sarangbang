import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Coordinator, type CoordinatorHooks } from './coordinator'
import { assertWhisperVolatile } from './invariants'
import { newMessageId } from './id'
import { participant, room } from './test-helpers'
import type { AgentDriver } from '../drivers/AgentDriver'
import type { Message, ParticipantId } from './types'

// ===== 제어 가능한 스텁 드라이버([226] S3 — S4 MockDriver 불요, M1 게이트 독립) =====
type Conc = { active: number; max: number } // 동시 speak() 카운터 → runTurn 중첩 탐지(중첩 시 동시 stream 발생)
interface DriverBehavior {
  script?: string[]
  perToken?: number
  failAfter?: number // N번째 토큰부터 드라이버 에러(abort 아님)
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    }, { once: true })
  })
}

function makeDriver(conc: Conc, behavior: (id: ParticipantId) => DriverBehavior = () => ({})): AgentDriver {
  return {
    async *speak(ctx, signal) {
      conc.active++
      conc.max = Math.max(conc.max, conc.active)
      try {
        const b = behavior(ctx.participant.id)
        const script = b.script ?? ['t1', 't2', 't3']
        const perToken = b.perToken ?? 20
        for (let i = 0; i < script.length; i++) {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
          if (b.failAfter !== undefined && i >= b.failAfter) throw new Error('driver-fail')
          yield script[i]
          await abortableDelay(perToken, signal) // 토큰 사이 파킹(fake timer)
        }
      } finally {
        conc.active--
      }
    },
  }
}

function spyHooks() {
  return { publish: vi.fn(), onState: vi.fn(), onWhisper: vi.fn(), onRoom: vi.fn() } satisfies CoordinatorHooks
}

function humanMsg(by: ParticipantId, text: string): Message {
  return { id: newMessageId(), turnNo: 0, by, role: 'human', text, status: 'streaming', ts: 0 }
}

const room1h2ai = () => room([
  participant({ id: 'h', name: '나', kind: 'human', seat: 0 }),
  participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
  participant({ id: 'a2', name: '고구마', kind: 'ai', seat: 2 }),
])

// fake timer 환경 헬퍼
async function flushMicro(turns = 50) {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}
async function drain() {
  for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(1000)
  await flushMicro()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Coordinator floor 루프([222])', () => {
  it('R1·R2·R3 기본 흐름: 사람→AI 좌석순 1회씩→idle, floor 직렬(동시 0)', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room1h2ai()
    const floorLog: (ParticipantId | null)[] = []
    const hooks: CoordinatorHooks = { ...spyHooks(), onRoom: vi.fn(() => void floorLog.push(r.floorHolder)) }
    const coord = new Coordinator(r, makeDriver(conc), hooks)

    coord.startTurn(humanMsg('h', '안녕'))
    await drain()

    // 발언 순서: 사람 → a1 → a2 (좌석순), 각 1회(R1)
    expect(r.history.map((m) => m.by)).toEqual(['h', 'a1', 'a2'])
    expect(r.history.filter((m) => m.by === 'a1')).toHaveLength(1) // R1: 턴당 1회
    expect(r.history.every((m) => m.status === 'done')).toBe(true)
    // R3: 큐 소진 → idle
    expect(r.status).toBe('idle')
    expect(r.floorHolder).toBeNull()
    expect(coord.getTurnState('a1')).toBe('done')
    expect(coord.getTurnState('a2')).toBe('done')
    // R2: floor 직렬화 — 동시 stream 0(중첩 없음)
    expect(conc.max).toBe(1)
    // floorHolder 직접 교체(null 경유 안 함): 턴 시작 null → a1 → a2 → 턴 종료 null
    expect(floorLog).toEqual([null, 'a1', 'a2', null])
  })

  it('enqueue 가드: 턴 밖 무시 · 중복 무시(R1·[M-2])', () => {
    const r = room([participant({ id: 'a1', kind: 'ai', seat: 1 })], [], { status: 'idle' })
    const coord = new Coordinator(r, makeDriver({ active: 0, max: 0 }), spyHooks())
    coord.enqueue({ by: 'a1', turnNo: 1 }) // 턴 밖(idle) → 무시
    expect(coord.getTurnState('a1')).toBe('idle')
    r.status = 'turn_active'
    coord.enqueue({ by: 'a1', turnNo: 1 })
    expect(coord.getTurnState('a1')).toBe('queued')
    coord.enqueue({ by: 'a1', turnNo: 1 }) // 중복 → 무시(여전히 queued)
    expect(coord.getTurnState('a1')).toBe('queued')
  })

  it('turnNo 증가 = 입력 수(순차 처리 시 입력 유실 0)', async () => {
    const r = room1h2ai()
    const coord = new Coordinator(r, makeDriver({ active: 0, max: 0 }), spyHooks())
    for (const t of ['하나', '둘', '셋']) {
      coord.startTurn(humanMsg('h', t))
      await drain()
    }
    expect(r.turnNo).toBe(3)
    expect(r.history.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['하나', '둘', '셋'])
  })

  it('사람 인터럽트(D3): 발언 중 startTurn → 현재 abort(부분 보존·stopped) 후 새 턴', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room1h2ai()
    const coord = new Coordinator(r, makeDriver(conc), spyHooks())

    coord.startTurn(humanMsg('h', '첫'))
    await flushMicro() // a1 speaking + 토큰 1개 파킹 상태까지만(타이머 미진행)
    expect(coord.getTurnState('a1')).toBe('speaking')
    const a1FirstMsg = r.history.find((m) => m.by === 'a1' && m.turnNo === 1)!
    expect(a1FirstMsg.status).toBe('streaming')
    expect(a1FirstMsg.text).toBe('t1') // 부분 텍스트

    coord.startTurn(humanMsg('h', '둘')) // 인터럽트
    await drain()

    // 첫 턴 a1 발언은 stopped(부분 보존)
    expect(a1FirstMsg.status).toBe('stopped')
    expect(a1FirstMsg.text).toBe('t1')
    // 새 턴(turnNo=2) 정상 진행
    expect(r.turnNo).toBe(2)
    expect(r.history.filter((m) => m.turnNo === 2 && m.by === 'a1')[0].status).toBe('done')
    expect(r.status).toBe('idle')
    expect(conc.max).toBe(1) // 중첩 0
  })

  it('single-flight race [M4]: 연속 동기 startTurn N회 → runTurn 중첩 0 · pending 최신만 코얼레싱', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room1h2ai()
    const coord = new Coordinator(r, makeDriver(conc), spyHooks())

    // await 없이 동기 연속 4회(첫이 turn_active 진입 → 나머지는 busy → pending 덮어쓰기)
    coord.startTurn(humanMsg('h', '첫'))
    coord.startTurn(humanMsg('h', '둘'))
    coord.startTurn(humanMsg('h', '셋'))
    coord.startTurn(humanMsg('h', '넷'))
    await drain()

    // 핵심: runTurn 중첩 0 → 동시 speak 0(max ≤ 1)
    expect(conc.max).toBeLessThanOrEqual(1)
    // pending 최신만: 첫(턴1) + 넷(턴2). 둘·셋은 코얼레싱 폐기 → turnNo=2
    expect(r.turnNo).toBe(2)
    expect(r.history.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['첫', '넷'])
    // 턴1은 즉시 선점되어 AI 미발언(drainFloor 진입 전 pending), 턴2에서 전원 발언
    expect(r.history.filter((m) => m.turnNo === 1 && m.role === 'ai')).toHaveLength(0)
    expect(r.history.filter((m) => m.turnNo === 2 && m.role === 'ai')).toHaveLength(2)
    expect(r.status).toBe('idle')
    expect(r.floorHolder).toBeNull()
  })

  it('드라이버 에러(H1): Message=error · Participant=stopped · 다음 화자 계속', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room1h2ai()
    const driver = makeDriver(conc, (id) => (id === 'a1' ? { failAfter: 1 } : {}))
    const coord = new Coordinator(r, driver, spyHooks())

    coord.startTurn(humanMsg('h', '안녕'))
    await drain()

    const a1msg = r.history.find((m) => m.by === 'a1')!
    expect(a1msg.status).toBe('error') // [H1] Message=error
    expect(a1msg.text).toBe('t1') // 부분 보존
    expect(coord.getTurnState('a1')).toBe('stopped') // [H1] Participant=stopped
    // 다음 화자(a2)는 정상 진행
    expect(r.history.find((m) => m.by === 'a2')!.status).toBe('done')
    expect(coord.getTurnState('a2')).toBe('done')
    expect(r.status).toBe('idle')
    expect(conc.max).toBe(1)
  })

  it('whisper 휘발(C1·R4): onWhisper 토큰마다 emit · 공개 history 0오염 · floor 독립', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room([
      participant({ id: 'h', name: '나', kind: 'human', seat: 0 }),
      participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
    ])
    const driver = makeDriver(conc, () => ({ script: ['귓', '속', '말'], perToken: 20 }))
    const hooks = spyHooks()
    const coord = new Coordinator(r, driver, hooks)
    const beforeLen = r.history.length

    const p = coord.whisper('a1', '비밀얘기')
    await drain()
    await p

    // onWhisper 토큰마다 발화(최초 + 토큰 3회)
    expect(hooks.onWhisper.mock.calls.length).toBeGreaterThanOrEqual(4)
    const lastThread = hooks.onWhisper.mock.calls.at(-1)![1]
    expect(lastThread.target).toBe('a1')
    expect(lastThread.messages[0]).toEqual({ by: 'human', text: '비밀얘기' })
    expect(lastThread.messages[1].text).toBe('귓속말') // 토큰 누적 완료
    // 공개 로그 0오염([223] §2): history 증가 0, publish 미호출, 휘발 단언 통과
    expect(r.history.length).toBe(beforeLen)
    expect(hooks.publish).not.toHaveBeenCalled()
    expect(() => assertWhisperVolatile(r.history)).not.toThrow()
    // floor 독립: 공개 턴을 열지 않음(자체 AbortController 사용, this.current 미사용)
    expect(r.status).toBe('idle')
    expect(r.floorHolder).toBeNull()
  })

  it('whisper 하드 타임아웃: 무종료 드라이버도 WHISPER_TIMEOUT_MS 후 종료(hang 방지)', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room([
      participant({ id: 'h', name: '나', kind: 'human', seat: 0 }),
      participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
    ])
    // 토큰 간격이 타임아웃보다 긴 = 사실상 무종료
    const driver = makeDriver(conc, () => ({ script: ['x', 'y'], perToken: 60_000 }))
    const coord = new Coordinator(r, driver, spyHooks(), { whisperTimeoutMs: 1000 })

    const p = coord.whisper('a1', '안끝나는질문')
    await drain() // 1000ms 경과 → 내부 ac.abort → whisper 종료
    await expect(p).resolves.toBeUndefined() // hang 없이 resolve
  })

  it('[C1] willSpeak 훅이 throw해도 방이 wedge되지 않음(graceful 미발언·idle 복귀·후속 입력 정상)', async () => {
    const conc: Conc = { active: 0, max: 0 }
    const r = room1h2ai()
    const coord = new Coordinator(r, makeDriver(conc), spyHooks(), {
      willSpeak: (p) => {
        if (p.id === 'a1') throw new Error('hook-fail') // P1 모델/네트워크 훅 실패 모사
        return true
      },
    })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(r.history.find((m) => m.by === 'a1')).toBeUndefined() // a1은 훅 실패로 미발언
    expect(r.history.find((m) => m.by === 'a2')!.status).toBe('done') // a2는 정상
    expect(r.status).toBe('idle') // 방 idle 복귀
    // wedge 안 됨: 후속 입력 정상 처리
    coord.startTurn(humanMsg('h', '다시'))
    await drain()
    expect(r.turnNo).toBe(2)
    expect(r.history.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['안녕', '다시'])
  })

  it('[H1] 드라이버가 abort를 무시하고 끝까지 와도, 인터럽트 중이면 stopped로 분류', async () => {
    const r = room1h2ai()
    // signal을 보지 않는 비-순응 드라이버(perToken 간격으로 끝까지 yield)
    const ignoreAbortDriver: AgentDriver = {
      async *speak(_ctx, _signal) {
        for (const t of ['t1', 't2', 't3']) {
          yield t
          await new Promise<void>((res) => setTimeout(res, 20))
        }
      },
    }
    const coord = new Coordinator(r, ignoreAbortDriver, spyHooks())
    coord.startTurn(humanMsg('h', '첫'))
    await flushMicro()
    expect(coord.getTurnState('a1')).toBe('speaking')
    coord.startTurn(humanMsg('h', '둘')) // 인터럽트 — 드라이버는 signal 무시하고 끝까지 진행
    await drain()
    const a1Turn1 = r.history.find((m) => m.by === 'a1' && m.turnNo === 1)!
    expect(a1Turn1.status).toBe('stopped') // [H1] stream-end까지 왔어도 abort 중이었으므로 stopped
    expect(r.turnNo).toBe(2)
    expect(r.status).toBe('idle')
  })

  it('[M2] 알 수 없는 whisper 대상 → 상태 변경 전 throw(orphan 스레드/emit 0)', async () => {
    const r = room1h2ai()
    const hooks = spyHooks()
    const coord = new Coordinator(r, makeDriver({ active: 0, max: 0 }), hooks)
    await expect(coord.whisper('ghost', 'hi')).rejects.toThrow(/알 수 없는 대상/)
    expect(hooks.onWhisper).not.toHaveBeenCalled() // emit 0(상태 변경 전 차단)
  })
})
