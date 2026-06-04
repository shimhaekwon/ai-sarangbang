// [228 §4.2] Ollama 모델 목록 — GET /api/tags. 로비가 진입 시 호출(런타임 모델 선택용).
// [중요] /api/chat과 동일 baseUrl 제약([228] §2 / C1·D-8): dev·preview의 Vite proxy 한정(prod는 별도 proxy 필요).
// core/UI 무의존 — OllamaDriver와 같은 drivers 계층. 실패는 throw(로비 §4.8 폴백이 catch).

// 로비가 쓰는 정규화 모델 엔트리. details 부재·필드 누락 가능 → 전부 옵셔널 가드([L3]).
export interface OllamaModel {
  name: string // 모델 태그(예: 'exaone3.5:7.8b') — buildSession이 그대로 model로 사용
  parameterSize?: string // details.parameter_size(문자열! '7.8B' 등 — 숫자 아님)
  family?: string // details.family(예: 'llama')
  size?: number // 디스크 바이트(표시용, 부재 가능)
}

// /api/tags 원시 응답 — 모든 필드 옵셔널로 받아 방어적 파싱.
interface RawTagsResponse {
  models?: Array<{
    name?: string
    model?: string
    size?: number
    details?: { family?: string; parameter_size?: string; quantization_level?: string }
  }>
}

export interface ListModelsOptions {
  baseUrl?: string // 기본 '/ollama'(dev·preview proxy). 직접 호출 시 'http://localhost:11434'(CORS 확인 필요)
  fetchImpl?: typeof fetch // 테스트 주입(기본 전역 fetch)
}

const DEFAULT_BASE_URL = '/ollama'

// 로컬 Ollama에 설치된 모델 목록. HTTP 실패·네트워크 오류는 throw → 로비가 §4.8(미실행/접근불가) 처리.
export async function listModels(opts: ListModelsOptions = {}): Promise<OllamaModel[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(`${baseUrl}/api/tags`, { method: 'GET' })
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
  const data = (await res.json()) as RawTagsResponse
  const raw = Array.isArray(data?.models) ? data.models : [] // models 부재/비배열 → 빈 목록(throw 아님)
  const out: OllamaModel[] = []
  for (const m of raw) {
    const name = m?.name ?? m?.model // name 우선, 폴백 model
    if (typeof name !== 'string' || !name) continue // 이름 없는 엔트리 스킵
    out.push({ name, parameterSize: m?.details?.parameter_size, family: m?.details?.family, size: m?.size })
  }
  return out
}
