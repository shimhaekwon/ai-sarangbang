import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockDriver } from './MockDriver'
import { withHardTimeout } from './withHardTimeout'
import type { AgentDriver } from './AgentDriver'
import type { SpeakContext } from '../core/types'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function ctxFor(id: string, name = id): SpeakContext {
  return { participant: { id, name, kind: 'ai', seat: 0 }, publicHistory: [], roster: [{ id, name }] }
}

async function consume(driver: AgentDriver, ctx: SpeakContext, signal: AbortSignal): Promise<string> {
  let out = ''
  for await (const tok of driver.speak(ctx, signal)) out += tok
  return out
}

describe('MockDriver([222] §4.1)', () => {
  it('스크립트 텍스트를 글자 단위로 스트리밍(한글 음절 보존)', async () => {
    const driver = createMockDriver({ lines: { a1: [{ text: '반갑네' }] }, defaultPerTokenMs: 10 })
    const ac = new AbortController()
    const p = consume(driver, ctxFor('a1'), ac.signal)
    await vi.runAllTimersAsync()
    expect(await p).toBe('반갑네')
  })

  it('abort 즉시 중단 + 부분 텍스트(바지인 실증)', async () => {
    const driver = createMockDriver({ lines: { a1: [{ text: '가나다라마' }] }, defaultPerTokenMs: 100 })
    const ac = new AbortController()
    let out = ''
    const p = (async () => {
      for await (const tok of driver.speak(ctxFor('a1'), ac.signal)) out += tok
    })()
    const rejected = expect(p).rejects.toThrow() // 핸들러 선부착(reject 윈도우 방지)
    await vi.advanceTimersByTimeAsync(250) // 약 3토큰 진행
    ac.abort()
    await rejected // AbortError
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThan(5) // 전체(5자) 미만 = 부분 보존
    expect('가나다라마'.startsWith(out)).toBe(true)
  })

  it('failAfter: N토큰 후 드라이버 에러(throw, 부분 보존)', async () => {
    const driver = createMockDriver({ lines: { a1: [{ text: 'abcdef', failAfter: 2 }] }, defaultPerTokenMs: 10 })
    const ac = new AbortController()
    let out = ''
    const p = (async () => {
      for await (const t of driver.speak(ctxFor('a1'), ac.signal)) out += t
    })()
    const rejected = expect(p).rejects.toThrow(/시뮬레이션 실패/) // 핸들러 선부착
    await vi.runAllTimersAsync()
    await rejected
    expect(out).toBe('ab') // 2토큰까지
  })

  it('턴마다 다음 대사로 순환', async () => {
    const driver = createMockDriver({ lines: { a1: [{ text: '하나' }, { text: '둘' }] }, defaultPerTokenMs: 5 })
    const ac = new AbortController()
    const a = consume(driver, ctxFor('a1'), ac.signal)
    await vi.runAllTimersAsync()
    expect(await a).toBe('하나')
    const b = consume(driver, ctxFor('a1'), ac.signal)
    await vi.runAllTimersAsync()
    expect(await b).toBe('둘')
    const c = consume(driver, ctxFor('a1'), ac.signal)
    await vi.runAllTimersAsync()
    expect(await c).toBe('하나') // 순환
  })

  it('대사 없는 참가자 → 빈 발언(즉시 종료)', async () => {
    const driver = createMockDriver({ lines: {}, defaultPerTokenMs: 10 })
    const ac = new AbortController()
    expect(await consume(driver, ctxFor('nobody'), ac.signal)).toBe('')
  })
})

describe('withHardTimeout([222] §6 안전망)', () => {
  it('무응답 드라이버를 idleMs 후 중단(throw)', async () => {
    const hanging: AgentDriver = {
      async *speak(_ctx, signal) {
        // 토큰을 절대 내지 않고 대기(무종료) — 내부 signal abort엔 반응
        await new Promise<void>((_res, rej) => {
          signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true })
        })
      },
    }
    const wrapped = withHardTimeout(hanging, 1000)
    const ac = new AbortController()
    const p = consume(wrapped, ctxFor('a1'), ac.signal)
    const rejected = expect(p).rejects.toThrow() // 핸들러 선부착(타임아웃 reject 윈도우 방지)
    await vi.advanceTimersByTimeAsync(1100)
    await rejected // idle 타임아웃 발동
  })

  it('정상 종료 드라이버는 타임아웃 영향 없음', async () => {
    const driver = createMockDriver({ lines: { a1: [{ text: 'ok' }] }, defaultPerTokenMs: 10 })
    const wrapped = withHardTimeout(driver, 1000)
    const ac = new AbortController()
    const p = consume(wrapped, ctxFor('a1'), ac.signal)
    await vi.runAllTimersAsync()
    expect(await p).toBe('ok')
  })
})
