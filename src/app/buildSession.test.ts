import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildSession, buildDemoSession } from './buildSession'
import type { RoomConfig } from './config'

// OllamaDriver가 쓰는 부분(ok/status/body.getReader().read/cancel)만 갖춘 NDJSON 스트림 fake.
function streamRes(tokens: string[]): Response {
  const enc = new TextEncoder()
  const lines = [...tokens.map((t) => JSON.stringify({ message: { content: t } }) + '\n'), JSON.stringify({ done: true }) + '\n']
  const data = lines.map((l) => enc.encode(l))
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (i < data.length ? { done: false, value: data[i++] } : { done: true, value: undefined }),
        cancel: async () => {},
      }),
    },
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildSession([228] §4.4)', () => {
  it('human seat0 + N AIs(슬롯 순서대로 seat 부여, humanName 적용)', () => {
    const c: RoomConfig = {
      v: 1,
      ais: [
        { id: 'x1', name: 'A', model: 'm1' },
        { id: 'x2', name: 'B', model: 'm2', think: true },
      ],
      humanName: '홍길동',
    }
    const s = buildSession(c)
    expect(s.room.participants.map((p) => [p.id, p.kind, p.seat, p.name])).toEqual([
      ['me', 'human', 0, '홍길동'],
      ['x1', 'ai', 1, 'A'],
      ['x2', 'ai', 2, 'B'],
    ])
    expect(s.coord).toBeTruthy()
    expect(s.store.getSnapshot().history).toEqual([])
  })

  it('humanName 미지정 → 기본 이름(i18n) + id me', () => {
    const s = buildSession({ v: 1, ais: [{ id: 'x1', name: 'A', model: 'm1' }] })
    expect(s.room.participants[0].id).toBe('me')
    expect(s.room.participants[0].name).toBeTruthy()
  })

  it('[H1] 드라이버에 슬롯 모델·think 주입(strip+hardTimeout 경유 fetch body)', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => streamRes(['안녕']))
    vi.stubGlobal('fetch', fetchSpy)
    const s = buildSession({ v: 1, ais: [{ id: 'x1', name: 'A', model: 'cool:7b', think: true }] })
    s.coord.startTurn({ id: 'h1', turnNo: 0, by: 'me', role: 'human', text: 'hi', status: 'streaming', ts: 0 })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const url = fetchSpy.mock.calls[0][0]
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
    expect(url).toBe('/ollama/api/chat')
    expect(body.model).toBe('cool:7b')
    expect(body.think).toBe(true)
    s.coord.dispose()
  })

  it('buildDemoSession: 고정 demo 참가자(H2 — RoomConfig 우회)', () => {
    const s = buildDemoSession()
    expect(s.room.participants.map((p) => p.id)).toEqual(['me', 'exaone', 'phi4mini', 'qwen3'])
  })

  it('[연결] roomConfig.baseUrl이 fetch 주소에 반영(원격 Ollama)', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => streamRes(['x']))
    vi.stubGlobal('fetch', fetchSpy)
    const s = buildSession({ v: 1, ais: [{ id: 'x1', name: 'A', model: 'm' }], baseUrl: 'http://pc2:11434' })
    s.coord.startTurn({ id: 'h1', turnNo: 0, by: 'me', role: 'human', text: 'hi', status: 'streaming', ts: 0 })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls[0][0]).toBe('http://pc2:11434/api/chat')
    s.coord.dispose()
  })
})
