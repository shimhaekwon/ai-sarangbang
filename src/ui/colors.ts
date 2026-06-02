// 화자 색 배정([223] Participant.color · [225] §1.1) — 사람은 항상 초록(--me), AI는 좌석순으로 팔레트 순환.
// Participant.color가 있으면 그것을 우선. 반환값은 CSS 변수 문자열(팔레트 단일 소스 = theme.css).
import type { Participant } from '../core/types'

const HUMAN_COLOR = 'var(--me)'
const AI_PALETTE = ['var(--ai1)', 'var(--ai2)', 'var(--ai3)', 'var(--ai4)']

export function buildColorMap(participants: Participant[]): Map<string, string> {
  const map = new Map<string, string>()
  let aiIdx = 0
  for (const p of [...participants].sort((a, b) => a.seat - b.seat)) {
    if (p.color) map.set(p.id, p.color)
    else if (p.kind === 'human') map.set(p.id, HUMAN_COLOR)
    else map.set(p.id, AI_PALETTE[aiIdx++ % AI_PALETTE.length])
  }
  return map
}
