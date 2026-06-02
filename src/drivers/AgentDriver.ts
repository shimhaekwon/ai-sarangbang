// 백엔드 seam — AI 호출 추상화([222] §8, [224] §1). 무료→유료 전환·멀티유저 이식이 이 인터페이스 뒤에서만 일어난다.
import type { SpeakContext } from '../core/types'

// speak: 토큰 스트림. AsyncIterable 정상 종료 = done([222] §6). 바지인 abort = signal로 전파(드라이버가 생성 취소).
// 구현체: P0 MockDriver(스크립트/지연) · P1 OllamaDriver(localhost:11434) · P2 ApiDriver(백엔드 프록시).
export interface AgentDriver {
  speak(ctx: SpeakContext, signal: AbortSignal): AsyncIterable<string>
}
