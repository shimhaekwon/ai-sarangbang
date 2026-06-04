import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Coordinator, type CoordinatorHooks } from './coordinator'
import { assertWhisperVolatile } from './invariants'
import { newMessageId } from './id'
import { participant, room } from './test-helpers'
import type { AgentDriver } from '../drivers/AgentDriver'
import type { Message, ParticipantId } from './types'

// ===== 제어 가능한 스텁 드라이버 =====
interface Behavior {
  script?: string[]
  perToken?: number
  startDelay?: number // 첫 토큰 전 지연
  failAfter?: number // N토큰 후 드라이버 에러
  noToken?: boolean // 토큰 없이 종료(무응답)
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

function makeDriver(behavior: (id: ParticipantId) => Behavior = () => ({}), calls?: Map<ParticipantId, number>): AgentDriver {
  return {
    async *speak(ctx, signal) {
      const id = ctx.participant.id
      if (calls) calls.set(id, (calls.get(id) ?? 0) + 1)
      const b = behavior(id)
      if (b.startDelay) await abortableDelay(b.startDelay, signal)
      if (b.noToken) return
      const script = b.script ?? ['t1', 't2', 't3']
      const perToken = b.perToken ?? 10
      for (let i = 0; i < script.length; i++) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        if (b.failAfter !== undefined && i >= b.failAfter) throw new Error(`fail:${id}`)
        yield script[i]
        await abortableDelay(perToken, signal)
      }
    },
  }
}

function spyHooks() {
  return { publish: vi.fn(), onState: vi.fn(), onWhisper: vi.fn(), onRoom: vi.fn(), onAuto: vi.fn(), onOrder: vi.fn() } satisfies CoordinatorHooks
}
function humanMsg(by: ParticipantId, text: string): Message {
  return { id: newMessageId(), turnNo: 0, by, role: 'human', text, status: 'streaming', ts: 0 }
}
const human = participant({ id: 'h', name: '나', kind: 'human', seat: 0 })
const ai = (id: string, seat: number) => participant({ id, name: id.toUpperCase(), kind: 'ai', seat })
const aiBy = (r: ReturnType<typeof room>) => r.history.filter((m) => m.role === 'ai').map((m) => m.by)
// [227] 셔플 rng: 0.99(≈1) → Fisher-Yates 항등(좌석순 유지) → 결정적 순서. 0 → 특정 순열로 비결정성 입증.
const seatOrderRng = () => 0.99

async function flushMicro(n = 60) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}
async function drain() {
  for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(500)
  await flushMicro()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Coordinator — 랜덤 순서 직렬 floor([227])', () => {
  it('추첨 순서대로 직렬 발언(rng≈1 → 좌석순 항등)', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2), ai('a3', 3)])
    const coord = new Coordinator(r, makeDriver(), spyHooks(), { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(aiBy(r)).toEqual(['a1', 'a2', 'a3']) // 셔플 항등 → collectSpeakers 좌석순
    expect(r.history.filter((m) => m.role === 'ai').every((m) => m.status === 'done')).toBe(true)
    expect(r.status).toBe('idle')
    expect(r.floorHolder).toBeNull()
  })

  it('셔플은 rng에 따라 순서가 바뀜(비결정)', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2), ai('a3', 3)])
    // rng=0 → Fisher-Yates: [a1,a2,a3] →(i2,j0)[a3,a2,a1] →(i1,j0)[a2,a3,a1]
    const coord = new Coordinator(r, makeDriver(), spyHooks(), { rng: () => 0 })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(aiBy(r)).toEqual(['a2', 'a3', 'a1']) // 좌석순과 다른 추첨 순열
  })

  it('R1: 각 AI 정확히 1회 발언', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const coord = new Coordinator(r, makeDriver(), spyHooks(), { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(r.history.filter((m) => m.by === 'a1')).toHaveLength(1)
    expect(r.history.filter((m) => m.by === 'a2')).toHaveLength(1)
  })

  it('직렬: 한 번에 한 메시지만 streaming(동시 출력 0)', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    let maxStreaming = 0
    const hooks: CoordinatorHooks = {
      ...spyHooks(),
      publish: () => {
        maxStreaming = Math.max(maxStreaming, r.history.filter((m) => m.status === 'streaming').length)
      },
    }
    const coord = new Coordinator(r, makeDriver(), hooks, { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(maxStreaming).toBeLessThanOrEqual(1)
  })

  it('바지인(D3): 발언 중 startTurn → 현재 발언 stopped 후 새 턴', async () => {
    const r = room([human, ai('a1', 1)])
    const driver = makeDriver(() => ({ perToken: 50, script: ['가', '나', '다', '라', '마'] }))
    const coord = new Coordinator(r, driver, spyHooks(), { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '첫'))
    await vi.advanceTimersByTimeAsync(60) // a1 발언 시작 + 일부 토큰
    await flushMicro()
    const a1msg = r.history.find((m) => m.by === 'a1' && m.turnNo === 1)
    expect(a1msg?.status).toBe('streaming')
    coord.startTurn(humanMsg('h', '둘')) // 인터럽트
    await drain()
    expect(a1msg?.status).toBe('stopped') // 부분 보존·중단
    expect(r.turnNo).toBe(2)
    expect(r.status).toBe('idle')
  })

  it('무응답 LLM은 (응답 없음) 표식(직렬 보존, H2), 나머지는 발언', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const driver = makeDriver((id) => (id === 'a1' ? { noToken: true } : {}))
    const coord = new Coordinator(r, driver, spyHooks(), { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    const a1msg = r.history.find((m) => m.by === 'a1')
    expect(a1msg?.status).toBe('error') // 무응답 → (응답 없음)
    expect(a1msg?.text).toBe('') // 빈 텍스트(토큰 0)
    expect(coord.getTurnState('a1')).toBe('stopped')
    expect(r.history.find((m) => m.by === 'a2')?.status).toBe('done')
    expect(r.status).toBe('idle')
  })

  it('single-flight: 연속 동기 startTurn → 중첩 없이 pending 최신만', async () => {
    const r = room([human, ai('a1', 1)])
    const coord = new Coordinator(r, makeDriver(), spyHooks(), { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '첫'))
    coord.startTurn(humanMsg('h', '둘'))
    coord.startTurn(humanMsg('h', '셋'))
    await drain()
    expect(r.history.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['첫', '셋']) // 둘 coalesced
    expect(r.turnNo).toBe(2)
    expect(r.status).toBe('idle')
  })

  it('willSpeak=false인 AI는 발언 미참여', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const coord = new Coordinator(r, makeDriver(), spyHooks(), { willSpeak: (p) => p.id !== 'a2', rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(r.history.find((m) => m.by === 'a1')).toBeTruthy()
    expect(r.history.find((m) => m.by === 'a2')).toBeUndefined()
  })

  it('[C1] willSpeak throw해도 방 wedge 안 됨', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const coord = new Coordinator(r, makeDriver(), spyHooks(), {
      rng: seatOrderRng,
      willSpeak: (p) => {
        if (p.id === 'a1') throw new Error('hook')
        return true
      },
    })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(r.history.find((m) => m.by === 'a1')).toBeUndefined()
    expect(r.history.find((m) => m.by === 'a2')?.status).toBe('done')
    expect(r.status).toBe('idle')
  })

  it('[227] 순번 onOrder: 추첨 시 emit · 턴 종료 시 클리어', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const hooks = spyHooks()
    const coord = new Coordinator(r, makeDriver(), hooks, { rng: seatOrderRng })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    const orderCalls = hooks.onOrder.mock.calls.map((c) => c[0] as ReadonlyMap<string, number>)
    const emitted = orderCalls.find((m) => m.size === 2)
    expect(emitted).toBeTruthy()
    expect(emitted!.get('a1')).toBe(1) // 좌석순(rng≈1) → a1=1, a2=2
    expect(emitted!.get('a2')).toBe(2)
    expect(orderCalls.at(-1)!.size).toBe(0) // 마지막 = 배지 클리어
  })

  // ===== whisper (휘발 — floor 무관, 유지) =====
  it('whisper 휘발(C1·R4): onWhisper emit · 공개 history 0오염', async () => {
    const r = room([human, participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 })])
    const hooks = spyHooks()
    const coord = new Coordinator(r, makeDriver(() => ({ script: ['귓', '속', '말'], perToken: 10 })), hooks)
    const before = r.history.length
    const p = coord.whisper('a1', '비밀')
    await drain()
    await p
    expect(hooks.onWhisper.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(hooks.onWhisper.mock.calls.at(-1)![1].messages[1].text).toBe('귓속말')
    expect(r.history.length).toBe(before)
    expect(hooks.publish).not.toHaveBeenCalled()
    expect(() => assertWhisperVolatile(r.history)).not.toThrow()
    expect(r.status).toBe('idle')
  })

  it('[M2] 알 수 없는 whisper 대상 → throw', async () => {
    const coord = new Coordinator(room([human, ai('a1', 1)]), makeDriver(), spyHooks())
    await expect(coord.whisper('ghost', 'hi')).rejects.toThrow(/알 수 없는 대상/)
  })

  it('whisper 하드 타임아웃: 무종료도 종료', async () => {
    const r = room([human, participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 })])
    const coord = new Coordinator(r, makeDriver(() => ({ script: ['x', 'y'], perToken: 60_000 })), spyHooks(), { whisperTimeoutMs: 1000 })
    const p = coord.whisper('a1', '안끝남')
    await drain()
    await expect(p).resolves.toBeUndefined()
  })

  // ===== 자동 모드 (라운드로빈 — 셔플 미적용 D-D, 유지) =====
  it('[C3] 자동 모드: 한 AI씩 라운드로빈으로 최대 N턴 발언 후 자동 정지', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const hooks = spyHooks()
    const coord = new Coordinator(r, makeDriver(() => ({ script: ['응답'], perToken: 5 })), hooks, { autoMaxTurns: 4, autoDelayMs: 100 })
    coord.startAutoMode()
    await drain()
    const aiMsgs = r.history.filter((m) => m.role === 'ai')
    expect(aiMsgs.map((m) => m.by)).toEqual(['a1', 'a2', 'a1', 'a2']) // 라운드로빈 · 4턴
    expect(coord.isAutoActive()).toBe(false)
    expect(r.status).toBe('idle')
    expect(hooks.onAuto).toHaveBeenCalledWith(true)
    expect(hooks.onAuto).toHaveBeenLastCalledWith(false)
  })

  it('[C3] stopAutoMode로 즉시 정지(진행 중 발언 중단)', async () => {
    const r = room([human, ai('a1', 1)])
    const coord = new Coordinator(r, makeDriver(() => ({ script: ['가', '나', '다'], perToken: 50 })), spyHooks(), { autoMaxTurns: 10, autoDelayMs: 100 })
    coord.startAutoMode()
    await vi.advanceTimersByTimeAsync(60)
    await flushMicro()
    expect(coord.isAutoActive()).toBe(true)
    coord.stopAutoMode()
    await drain()
    expect(coord.isAutoActive()).toBe(false)
    expect(r.status).toBe('idle')
    expect(r.history.filter((m) => m.role === 'ai').length).toBeLessThan(10)
  })

  it('[C3] 사람 입력 시 자동 정지(사람 우선) + 사람 턴 처리', async () => {
    const r = room([human, ai('a1', 1)])
    const coord = new Coordinator(r, makeDriver(() => ({ script: ['오토'], perToken: 5 })), spyHooks(), { autoMaxTurns: 10, autoDelayMs: 1000, rng: seatOrderRng })
    coord.startAutoMode()
    await vi.advanceTimersByTimeAsync(50)
    await flushMicro()
    coord.startTurn(humanMsg('h', '사람입력'))
    await drain()
    expect(coord.isAutoActive()).toBe(false) // 사람 입력 → 자동 정지
    expect(r.history.find((m) => m.by === 'h')?.text).toBe('사람입력')
    expect(r.status).toBe('idle')
  })
})
