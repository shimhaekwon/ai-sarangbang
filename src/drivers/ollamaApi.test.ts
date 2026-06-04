import { describe, it, expect, vi } from 'vitest'
import { listModels } from './ollamaApi'

// listModels는 res.json()만 사용 — getReader 불필요. ok/status/json만 갖춘 fake.
function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as unknown as Response
}

describe('listModels([228] §4.2)', () => {
  it('정상 응답 → name·parameterSize·family·size 파싱', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'exaone3.5:7.8b', model: 'exaone3.5:7.8b', size: 4_800_000_000, details: { family: 'exaone', parameter_size: '7.8B' } },
          { name: 'phi4-mini:latest', details: { parameter_size: '3.8B' } },
        ],
      }),
    )
    expect(await listModels({ fetchImpl })).toEqual([
      { name: 'exaone3.5:7.8b', parameterSize: '7.8B', family: 'exaone', size: 4_800_000_000 },
      { name: 'phi4-mini:latest', parameterSize: '3.8B', family: undefined, size: undefined },
    ])
  })

  it('details 부재 → parameterSize undefined(L3 방어, throw 아님)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ models: [{ name: 'm1' }] }))
    expect((await listModels({ fetchImpl }))[0]).toEqual({ name: 'm1', parameterSize: undefined, family: undefined, size: undefined })
  })

  it('name 없고 model만 → model 폴백 / 이름 없는 엔트리 스킵', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ models: [{ model: 'm2' }, { details: {} }, { name: '' }] }))
    expect((await listModels({ fetchImpl })).map((m) => m.name)).toEqual(['m2'])
  })

  it('HTTP 에러 → throw', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500))
    await expect(listModels({ fetchImpl })).rejects.toThrow(/HTTP 500/)
  })

  it('models 부재/비배열 → 빈 목록(throw 아님)', async () => {
    expect(await listModels({ fetchImpl: vi.fn().mockResolvedValue(jsonResponse({})) })).toEqual([])
    expect(await listModels({ fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ models: 'x' })) })).toEqual([])
  })

  it('GET /api/tags 호출(기본 baseUrl /ollama)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ models: [] }))
    await listModels({ fetchImpl })
    expect(fetchImpl).toHaveBeenCalledWith('/ollama/api/tags', { method: 'GET', signal: expect.any(AbortSignal) })
  })

  it('baseUrl 주입 시 그 경로로 호출', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ models: [] }))
    await listModels({ fetchImpl, baseUrl: 'http://localhost:11434' })
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:11434/api/tags', { method: 'GET', signal: expect.any(AbortSignal) })
  })

  it('[연결] timeoutMs 초과 → abort throw(무한 로딩 방지)', async () => {
    // 영원히 pending → timeout이 signal abort → reject
    const hangFetch = vi.fn(
      (_url: string, opts?: { signal?: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    await expect(listModels({ fetchImpl: hangFetch as unknown as typeof fetch, timeoutMs: 20 })).rejects.toThrow()
  })
})
