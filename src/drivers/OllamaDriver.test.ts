import { describe, it, expect, vi } from 'vitest'
import { buildOllamaMessages, createOllamaDriver } from './OllamaDriver'
import type { AgentDriver } from './AgentDriver'
import type { SpeakContext } from '../core/types'
import { message, participant } from '../core/test-helpers'

// 환경 독립 fake — 드라이버가 쓰는 부분(ok/status/body.getReader().read/cancel)만 구현. 청크 단위 그대로 방출.
function fakeResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const data = chunks.map((c) => enc.encode(c))
  let i = 0
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: async () => (i < data.length ? { done: false, value: data[i++] } : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  } as unknown as Response
}
function chatLine(content: string, done = false): string {
  return JSON.stringify({ message: { role: 'assistant', content }, done }) + '\n'
}
function ctx(): SpeakContext {
  return {
    participant: participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1, persona: '정중한 미식가' }),
    publicHistory: [
      message({ id: 'm1', by: 'h', role: 'human', text: '뭐 먹지?', status: 'done', turnNo: 1 }),
      message({ id: 'm2', by: 'a1', role: 'ai', text: '음...', status: 'done', turnNo: 1 }),
    ],
    roster: [{ id: 'h', name: '나' }, { id: 'a1', name: '감자' }],
  }
}
async function collect(driver: AgentDriver, signal: AbortSignal): Promise<string> {
  let out = ''
  for await (const tok of driver.speak(ctx(), signal)) out += tok
  return out
}
const freshSignal = () => new AbortController().signal

describe('OllamaDriver([224] §3 · P1)', () => {
  it('NDJSON 스트림 → 토큰 누적, done에서 종료', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([chatLine('반'), chatLine('갑'), chatLine('네', true), chatLine('무시')]))
    const driver = createOllamaDriver({ model: 'm', fetchImpl })
    expect(await collect(driver, freshSignal())).toBe('반갑네') // done 이후 라인 무시
  })

  it('청크 경계로 쪼개진 JSON 라인도 버퍼링 후 파싱', async () => {
    const full = chatLine('하이', true)
    const mid = Math.floor(full.length / 2)
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([full.slice(0, mid), full.slice(mid)]))
    const driver = createOllamaDriver({ model: 'm', fetchImpl })
    expect(await collect(driver, freshSignal())).toBe('하이')
  })

  it('개행 없이 끝난 마지막 라인도 파싱(flush)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([JSON.stringify({ message: { content: '끝' } })]))
    const driver = createOllamaDriver({ model: 'm', fetchImpl })
    expect(await collect(driver, freshSignal())).toBe('끝')
  })

  it('HTTP 에러 → throw', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([], 500))
    const driver = createOllamaDriver({ model: 'm', fetchImpl })
    await expect(collect(driver, freshSignal())).rejects.toThrow(/HTTP 500/)
  })

  it('pre-aborted signal → 즉시 throw, fetch 미호출', async () => {
    const fetchImpl = vi.fn()
    const driver = createOllamaDriver({ model: 'm', fetchImpl })
    const ac = new AbortController()
    ac.abort()
    await expect(collect(driver, ac.signal)).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('signal을 fetch에 전달(생성 취소 연결) + POST /api/chat', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([chatLine('x', true)]))
    const driver = createOllamaDriver({ model: 'm', fetchImpl })
    const ac = new AbortController()
    await collect(driver, ac.signal)
    expect(fetchImpl).toHaveBeenCalledWith('/ollama/api/chat', expect.objectContaining({ method: 'POST', signal: ac.signal }))
  })

  it('baseUrl 미지정 시 기본 /ollama(dev proxy)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([chatLine('x', true)]))
    await collect(createOllamaDriver({ model: 'm', fetchImpl }), freshSignal())
    expect(fetchImpl.mock.calls[0][0]).toBe('/ollama/api/chat')
  })

  it('model 함수형 → 참가자별 모델 선택(AI별 다른 모델)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse([chatLine('x', true)]))
    const driver = createOllamaDriver({ model: (p) => (p.id === 'a1' ? 'model-A' : 'model-B'), fetchImpl })
    await collect(driver, freshSignal()) // ctx().participant.id === 'a1'
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)
    expect(body.model).toBe('model-A')
  })

  it('think 지정 시 body 포함, 미지정 시 생략(비-thinking 모델 안전)', async () => {
    const fWith = vi.fn().mockResolvedValue(fakeResponse([chatLine('x', true)]))
    await collect(createOllamaDriver({ model: 'm', think: false, fetchImpl: fWith }), freshSignal())
    expect(JSON.parse((fWith.mock.calls[0][1] as RequestInit).body as string).think).toBe(false)

    const fNone = vi.fn().mockResolvedValue(fakeResponse([chatLine('x', true)]))
    await collect(createOllamaDriver({ model: 'm', fetchImpl: fNone }), freshSignal())
    expect('think' in JSON.parse((fNone.mock.calls[0][1] as RequestInit).body as string)).toBe(false)
  })
})

describe('buildOllamaMessages — prompt 매핑', () => {
  it('system(persona) + 자기=assistant / 타자=user + [이름] 라벨', () => {
    const msgs = buildOllamaMessages(ctx(), (p) => p.persona ?? p.name)
    expect(msgs[0]).toEqual({ role: 'system', content: '정중한 미식가' })
    expect(msgs[1]).toEqual({ role: 'user', content: '[나] 뭐 먹지?' }) // 사람=타자=user
    expect(msgs[2]).toEqual({ role: 'assistant', content: '[감자] 음...' }) // 자기=assistant
  })

  it('roster에 없는 id는 id 그대로 폴백', () => {
    const c: SpeakContext = {
      participant: participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
      publicHistory: [message({ id: 'm', by: 'ghost', role: 'ai', text: 'x', status: 'done', turnNo: 1 })],
      roster: [{ id: 'a1', name: '감자' }],
    }
    expect(buildOllamaMessages(c, (p) => p.name)[1].content).toBe('[ghost] x')
  })
})
