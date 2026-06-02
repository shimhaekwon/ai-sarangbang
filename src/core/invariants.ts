// 불변식 — v1 carry-forward([224] §4·§5). (1) completedNaturally(중단 오분류 방지) (2) whisper 휘발([223] §2).
import type { Message, MessageStatus } from './types'

// completedNaturally — 자연 종료(done)만 "완료된 공개 발언". streaming/stopped/error는 미완([222] §5·§6).
// 단일 술어: context done 필터·MD 본문/플레이스홀더 판정·재수화 가드가 이를 공유 → 중단을 done으로 오분류하지 않음.
export function completedNaturally(status: MessageStatus): boolean {
  return status === 'done'
}

// whisper 휘발 단언([223] §2) — 합성/귓속말 Message가 공개 history에 절대 새지 않음을 구조적으로 검증.
// 공개 발언은 항상 turnNo >= 1(턴은 1-based, [223] §1). whisperContext 합성물은 turnNo = -1 → history에 있으면 유출.
// dev/테스트 가드: 위반 시 throw로 불변식 회귀를 즉시 드러냄.
export function assertWhisperVolatile(history: readonly Message[]): void {
  for (const m of history) {
    if (m.turnNo < 1) {
      throw new Error(`[invariant] whisper/합성 Message가 공개 history에 유출됨: id=${m.id} turnNo=${m.turnNo}`)
    }
  }
}
