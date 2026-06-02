// 하드 타임아웃 안전망([222] §6) — 무응답/무종료 드라이버를 idle 기준으로 강제 종결. core 비침투(드라이버 래퍼).
// 정상 종료엔 영향 없음. 외부(사람 인터럽트) signal은 내부로 전파 → 인터럽트=stopped / 타임아웃=error 구분 유지.
import type { AgentDriver } from './AgentDriver'

export function withHardTimeout(driver: AgentDriver, idleMs: number): AgentDriver {
  return {
    async *speak(ctx, signal) {
      const inner = new AbortController()
      const relay = () => inner.abort() // 외부 abort(사람 인터럽트) → 내부 전파(드라이버 생성 취소)
      signal.addEventListener('abort', relay, { once: true })
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => inner.abort(), idleMs) // 토큰/종료 없이 idleMs 경과 → 무응답으로 판단, 중단
      }
      try {
        arm()
        for await (const tok of driver.speak(ctx, inner.signal)) {
          arm() // 토큰마다 재무장(idle 타임아웃)
          yield tok
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        signal.removeEventListener('abort', relay)
      }
    },
  }
}
