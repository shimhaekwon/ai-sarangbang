// id 체계 — v1 계승([223] §1.3). nanoid customAlphabet(소문자+숫자, 6자리).
import { customAlphabet } from 'nanoid'
import type { MessageId, RoomSessionId } from './types'

const nano6 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

// RoomSession.id = "YYYYMMDD-HHmm-" + nano6 (예 "20260602-1430-a1b2c3").
// now 주입 가능 — 결정적 테스트/재현용([223] §1.3).
export function newSessionId(now = new Date()): RoomSessionId {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  return `${stamp}-${nano6()}`
}

// Message.id/ParticipantId 공통 — 접두 불요(타입으로 구분). 정렬은 ts/turnNo로([223] §1.3).
export const newMessageId = (): MessageId => nano6()

// [228] 범용 id — 로비 AI 슬롯 등(모델·이름 교체에도 유지되는 안정 키). nano6 재사용.
export const newId = (): string => nano6()
