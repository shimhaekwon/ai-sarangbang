import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Coordinator, type CoordinatorHooks } from './coordinator'
import { assertWhisperVolatile } from './invariants'
import { newMessageId } from './id'
import { participant, room } from './test-helpers'
import type { AgentDriver } from '../drivers/AgentDriver'
import type { Message, ParticipantId } from './types'

// ===== 경쟁 제어 가능한 스텁 드라이버 =====
interface Behavior {
  script?: string[]
  perToken?: number
  startDelay?: number // 첫 토큰 전 지연(경쟁 승자 제어)
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
  return { publish: vi.fn(), onState: vi.fn(), onWhisper: vi.fn(), onRoom: vi.fn() } satisfies CoordinatorHooks
}
function humanMsg(by: ParticipantId, text: string): Message {
  return { id: newMessageId(), turnNo: 0, by, role: 'human', text, status: 'streaming', ts: 0 }
}
const human = participant({ id: 'h', name: '나', kind: 'human', seat: 0 })
const ai = (id: string, seat: number) => participant({ id, name: id.toUpperCase(), kind: 'ai', seat })
const aiBy = (r: ReturnType<typeof room>) => r.history.filter((m) => m.role === 'ai').map((m) => m.by)

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

describe('Coordinator — 속도 경쟁 floor([221] R2)', () => {
  it('먼저 응답한 LLM이 floor 선점 — 속도순 발언(좌석순 아님)', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2), ai('a3', 3)])
    // 첫 토큰: a2(20) < a3(50) < a1(90) → seat순(a1,a2,a3)과 다른 속도순
    const driver = makeDriver((id) => ({ startDelay: id === 'a2' ? 20 : id === 'a3' ? 50 : 90 }))
    const coord = new Coordinator(r, driver, spyHooks())
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(aiBy(r)).toEqual(['a2', 'a3', 'a1']) // 속도순
    expect(r.history.filter((m) => m.role === 'ai').every((m) => m.status === 'done')).toBe(true)
    expect(r.status).toBe('idle')
    expect(r.floorHolder).toBeNull()
  })

  it('진 LLM은 재생성 — 승자 외엔 라운드마다 speak 재호출', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2), ai('a3', 3)])
    const calls = new Map<ParticipantId, number>()
    const driver = makeDriver((id) => ({ startDelay: id === 'a2' ? 20 : id === 'a3' ? 50 : 90 }), calls)
    const coord = new Coordinator(r, driver, spyHooks())
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(calls.get('a2')).toBe(1) // 1R 승
    expect(calls.get('a3')).toBe(2) // 1R 패 + 2R 승
    expect(calls.get('a1')).toBe(3) // 1R·2R 패 + 3R 승
  })

  it('R1: 각 AI 정확히 1회 발언', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const coord = new Coordinator(r, makeDriver((id) => ({ startDelay: id === 'a1' ? 10 : 30 })), spyHooks())
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(r.history.filter((m) => m.by === 'a1')).toHaveLength(1)
    expect(r.history.filter((m) => m.by === 'a2')).toHaveLength(1)
  })

  it('floor 직렬: 한 번에 한 메시지만 streaming(동시 출력 0)', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    let maxStreaming = 0
    const hooks: CoordinatorHooks = {
      ...spyHooks(),
      publish: () => {
        maxStreaming = Math.max(maxStreaming, r.history.filter((m) => m.status === 'streaming').length)
      },
    }
    const coord = new Coordinator(r, makeDriver((id) => ({ startDelay: id === 'a1' ? 10 : 30 })), hooks)
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(maxStreaming).toBeLessThanOrEqual(1) // 출력(publish)은 항상 ≤1개 streaming(경쟁은 생성만 동시)
  })

  it('바지인(D3): 발언 중 startTurn → 현재 발언 stopped 후 새 턴', async () => {
    const r = room([human, ai('a1', 1)])
    const driver = makeDriver(() => ({ startDelay: 10, perToken: 50, script: ['가', '나', '다', '라', '마'] }))
    const coord = new Coordinator(r, driver, spyHooks())
    coord.startTurn(humanMsg('h', '첫'))
    await vi.advanceTimersByTimeAsync(80) // a1 선점 + 일부 토큰
    await flushMicro()
    const a1msg = r.history.find((m) => m.by === 'a1' && m.turnNo === 1)
    expect(a1msg?.status).toBe('streaming')
    coord.startTurn(humanMsg('h', '둘')) // 인터럽트
    await drain()
    expect(a1msg?.status).toBe('stopped') // 부분 보존·중단
    expect(r.turnNo).toBe(2)
    expect(r.status).toBe('idle')
  })

  it('무응답/에러 LLM은 (응답 없음) 표식(조용한 드랍 아님), 나머지는 발언', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const driver = makeDriver((id) => (id === 'a1' ? { noToken: true } : { startDelay: 20 }))
    const coord = new Coordinator(r, driver, spyHooks())
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    const a1msg = r.history.find((m) => m.by === 'a1')
    expect(a1msg?.status).toBe('error') // 무응답 → (응답 없음) 표식
    expect(a1msg?.text).toBe('') // 빈 텍스트(토큰 0)
    expect(coord.getTurnState('a1')).toBe('stopped')
    expect(r.history.find((m) => m.by === 'a2')?.status).toBe('done')
    expect(r.status).toBe('idle')
  })

  it('single-flight: 연속 동기 startTurn → 중첩 없이 pending 최신만', async () => {
    const r = room([human, ai('a1', 1)])
    const coord = new Coordinator(r, makeDriver(() => ({ startDelay: 10 })), spyHooks())
    coord.startTurn(humanMsg('h', '첫'))
    coord.startTurn(humanMsg('h', '둘'))
    coord.startTurn(humanMsg('h', '셋'))
    await drain()
    expect(r.history.filter((m) => m.role === 'human').map((m) => m.text)).toEqual(['첫', '셋']) // 둘 coalesced
    expect(r.turnNo).toBe(2)
    expect(r.status).toBe('idle')
  })

  it('willSpeak=false인 AI는 경쟁 미참여', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const coord = new Coordinator(r, makeDriver(() => ({ startDelay: 10 })), spyHooks(), { willSpeak: (p) => p.id !== 'a2' })
    coord.startTurn(humanMsg('h', '안녕'))
    await drain()
    expect(r.history.find((m) => m.by === 'a1')).toBeTruthy()
    expect(r.history.find((m) => m.by === 'a2')).toBeUndefined()
  })

  it('[C1] willSpeak throw해도 방 wedge 안 됨', async () => {
    const r = room([human, ai('a1', 1), ai('a2', 2)])
    const coord = new Coordinator(r, makeDriver(() => ({ startDelay: 10 })), spyHooks(), {
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
})
