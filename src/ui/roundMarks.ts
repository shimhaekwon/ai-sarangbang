// [D-D] 라운드 경계 계산 — UI 전용 표시 로직(coordinator·history·MD 무변경, 방식 A).
// "전원 한 바퀴 = 1라운드": 사람 턴(같은 turnNo에 human 포함)은 그 자체로 1라운드,
// 자동 발언(human 없는 단일 ai, turnNo가 1명씩 증가)은 AI 전원이 한 번씩 '실제로' 등장하면 1라운드.
// (자동은 랜덤+연속회피라 발언 수 ≠ 항상 전원 → 발언 수가 아니라 등장한 화자 집합으로 판정.)
// 반환: 메시지 id → 그 메시지 '뒤'에 표시할 라운드 번호(없으면 키 없음).
import type { Message, MessageId, ParticipantId } from '../core/types'

interface TurnGroup {
  turnNo: number
  msgs: Message[]
}

// history는 push 순서(=시간순, turnNo 비감소). 같은 turnNo 연속분을 한 그룹으로(사람 턴=human+ai 동일 turnNo, 자동=단일).
function groupByTurnNo(history: Message[]): TurnGroup[] {
  const groups: TurnGroup[] = []
  for (const m of history) {
    const last = groups[groups.length - 1]
    if (last && last.turnNo === m.turnNo) last.msgs.push(m)
    else groups.push({ turnNo: m.turnNo, msgs: [m] })
  }
  return groups
}

export function computeRoundMarks(history: Message[], aiCount: number): Map<MessageId, number> {
  const marks = new Map<MessageId, number>()
  if (aiCount < 1) return marks
  let round = 0
  const seenAuto = new Set<ParticipantId>() // 진행 중 자동 바퀴에서 등장한 AI(전원 채우면 1라운드)
  for (const g of groupByTurnNo(history)) {
    const last = g.msgs[g.msgs.length - 1]
    const hasHuman = g.msgs.some((m) => m.role === 'human')
    if (hasHuman) {
      // 사람 턴(입력 + AI 전원 답변) = 명확한 1라운드. 진행 중이던 자동 바퀴는 사람 입력으로 리셋.
      seenAuto.clear()
      round++
      marks.set(last.id, round)
    } else {
      // 자동 발언(단일 AI). AI 전원이 한 번씩 등장하면 1라운드 닫고 다음 바퀴 시작.
      for (const m of g.msgs) if (m.role === 'ai') seenAuto.add(m.by)
      if (seenAuto.size >= aiCount) {
        round++
        marks.set(last.id, round)
        seenAuto.clear()
      }
    }
  }
  return marks
}
