// [228 §4.7 / H3] 방 구성 영속 — localStorage. 스키마 버전 게이트 + try/catch(손상값→null) + typeof 가드.
// [중요] 자동 입장은 안 한다(D-7): 복원 후에도 로비를 다시 보여줘 모델 검증(reconcileModels) 기회를 준다.
import type { AiSlot, RoomConfig } from './config'

const KEY = 'ai-sarangbang.config'
const SCHEMA_V = 1 // RoomConfig.v 와 일치. 불일치하면 loadConfig가 null(기본값 폴백).

// SSR/비브라우저 환경 가드 — localStorage 부재 시 안전 no-op.
function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null // 일부 환경에서 접근 자체가 SecurityError
  }
}

export function saveConfig(config: RoomConfig): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify(config))
  } catch {
    /* QuotaExceeded 등 — 영속 실패는 무시(앱 동작엔 무영향) */
  }
}

export function loadConfig(): RoomConfig | null {
  const s = storage()
  if (!s) return null
  let raw: string | null
  try {
    raw = s.getItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isValidConfig(parsed) ? parsed : null // [H3] 버전·구조 불일치 → null(기본값)
  } catch {
    return null // 손상 JSON
  }
}

export function clearConfig(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(KEY)
  } catch {
    /* 무시 */
  }
}

// [H3] 구조·버전 검증 — 신뢰할 수 없는 영속값을 RoomConfig로 좁힘.
function isValidConfig(v: unknown): v is RoomConfig {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  if (c.v !== SCHEMA_V) return false // 버전 불일치 → 무시(스키마 진화 시 안전)
  if (!Array.isArray(c.ais)) return false
  if (c.humanName !== undefined && typeof c.humanName !== 'string') return false
  return c.ais.every(isValidSlot)
}

function isValidSlot(a: unknown): a is AiSlot {
  if (typeof a !== 'object' || a === null) return false
  const s = a as Record<string, unknown>
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.model === 'string' &&
    (s.think === undefined || typeof s.think === 'boolean')
  )
}

// [228 §4.7 / R1] 복원 config의 모델을 현재 사용 가능 목록과 대조 — 사라진 모델 태그를 반환(로비가 표시·대체 유도).
// config 자체는 변형하지 않는다(그대로 입장 시 첫 발언에서 404→"(응답 없음)" 안전망이 받음).
export function reconcileModels(config: RoomConfig, available: readonly string[]): string[] {
  const set = new Set(available)
  return Array.from(new Set(config.ais.filter((a) => !set.has(a.model)).map((a) => a.model))) // [L-B] 중복 슬롯 → dedup
}
