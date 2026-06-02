// 테스트 전용 픽스처/유틸 — 프로덕션 코드에서 import하지 않는다(테스트 파일만 사용).
import type { Message, Participant, RoomSession } from './types'

export function participant(over: Partial<Participant> & { id: string }): Participant {
  return { name: over.id, kind: 'ai', seat: 0, ...over }
}

export function message(over: Partial<Message> & { id: string; by: string }): Message {
  return { turnNo: 1, role: 'ai', text: '', status: 'done', ts: 0, ...over }
}

export function room(
  participants: Participant[],
  history: Message[] = [],
  over: Partial<RoomSession> = {},
): RoomSession {
  return {
    id: 'test-room',
    createdAt: 0,
    status: 'idle',
    turnNo: history.reduce((mx, m) => Math.max(mx, m.turnNo), 0),
    floorHolder: null,
    participants,
    history,
    ...over,
  }
}
