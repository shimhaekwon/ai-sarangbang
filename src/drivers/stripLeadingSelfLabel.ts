// 이름 메아리 제거 래퍼 — 모델이 본문 앞에 자기 이름을 붙이는 경우("[Qwen3] …", "Qwen3: …", 중복까지) 선행 라벨만 벗김.
// UI가 [이름]을 따로 렌더하므로 모델이 또 붙이면 중복([Qwen3][Qwen3]). 스트림 안전: 앞부분을 충분히 모은 뒤 판정.
// 모델명(EXAONE/Gemma2/Qwen3)이라 본문이 그 단어로 시작할 확률이 낮아 오탐 위험 작음.
import type { AgentDriver } from './AgentDriver'

export function stripLeadingSelfLabel(driver: AgentDriver): AgentDriver {
  return {
    async *speak(ctx, signal) {
      const name = ctx.participant.name
      const labelRe = leadingLabelRegex(name)
      const cap = name.length * 4 + 24 // 버퍼 상한(무한 대기 방지)
      let buf = ''
      let stripping = true
      for await (const tok of driver.speak(ctx, signal)) {
        if (!stripping) {
          yield tok
          continue
        }
        buf += tok
        const stripped = buf.replace(labelRe, '')
        if (buf.length < cap && (stripped.length === 0 || couldStartLabel(stripped, name))) {
          continue // 아직 라벨(부분 포함)만 봄 → 더 모음
        }
        stripping = false
        if (stripped) yield stripped
        buf = ''
      }
      if (stripping && buf) {
        const s = buf.replace(labelRe, '')
        if (s) yield s
      }
    },
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 선행 라벨(반복): "[name]" | "name:" | "name "(공백 경계) — 대소문자 무시
function leadingLabelRegex(name: string): RegExp {
  const n = escapeRegExp(name)
  return new RegExp(`^(?:\\s*(?:\\[\\s*${n}\\s*\\]|${n}\\s*:|${n}(?=\\s))\\s*)+`, 'i')
}

// stripped가 또 다른 라벨의 (부분) 시작일 수 있는지 → 더 기다림
function couldStartLabel(stripped: string, name: string): boolean {
  const s = stripped.replace(/^\s+/, '')
  if (s === '') return true
  const lower = s.toLowerCase()
  const n = name.toLowerCase()
  if (s[0] === '[') {
    const inner = lower.slice(1).replace(/^\s+/, '')
    return n.startsWith(inner) || inner.startsWith(n) // "[na" 진행 중 or "[name" 직후(']' 대기)
  }
  return n.startsWith(lower) && lower.length <= n.length // "nam" 또는 "name"(공백/콜론 대기)
}
