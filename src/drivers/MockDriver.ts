// P0 MockDriver — AI 없이 메커닉 무결화([221] §2, [222] §4.1 · [224] §P0). 스크립트된 토큰을 지연으로 흘려보냄.
// signal.abort 즉시 반응(바지인 실증), 무응답·에러 케이스도 스크립트 가능. 정본 = 본 파일 + [222] §4.1.
import type { AgentDriver } from './AgentDriver'
import type { ParticipantId } from '../core/types'
import { abortableDelay } from './timing'

export interface MockLine {
  text: string
  perTokenMs?: number // 이 대사의 토큰 간격(미지정 시 driver 기본)
  failAfter?: number // N번째 토큰부터 드라이버 에러(무응답/실패 시연 — 코디네이터가 Message=error 처리)
}

export interface MockDriverConfig {
  lines: Record<ParticipantId, MockLine[]> // 참가자별 대사 목록(턴마다 순환)
  defaultPerTokenMs?: number // 기본 토큰 간격(미지정 시 28ms — [225] §1.2 타이핑 속도)
  tokenize?: (text: string) => string[] // 토큰화(기본: 글자 단위 — 90s 타이핑 효과, 한글 음절 1코드포인트)
}

const byChar = (text: string): string[] => [...text]
const DEFAULT_PER_TOKEN_MS = 28

// 구현 메모: speak()는 stateless가 아니라 참가자별 커서를 유지(턴마다 다음 대사). 드라이버 인스턴스 1개가 데모 진행.
export function createMockDriver(config: MockDriverConfig): AgentDriver {
  const cursor = new Map<ParticipantId, number>()
  const tokenize = config.tokenize ?? byChar
  const basePerToken = config.defaultPerTokenMs ?? DEFAULT_PER_TOKEN_MS

  return {
    async *speak(ctx, signal) {
      const id = ctx.participant.id
      const lines = config.lines[id] ?? []
      if (lines.length === 0) return // 대사 없음 → 빈 발언으로 즉시 종료(stream-end = done)
      const i = cursor.get(id) ?? 0
      cursor.set(id, i + 1)
      const line = lines[i % lines.length]
      const tokens = tokenize(line.text)
      const perTokenMs = line.perTokenMs ?? basePerToken
      for (let t = 0; t < tokens.length; t++) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError') // 바지인 즉시 반응
        if (line.failAfter !== undefined && t >= line.failAfter) throw new Error(`MockDriver: ${id} 시뮬레이션 실패`)
        yield tokens[t]
        await abortableDelay(perTokenMs, signal)
      }
    },
  }
}
