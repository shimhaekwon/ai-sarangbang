// SpeakContext 빌더 — 드라이버 주입용 컨텍스트 구성 정본([223] §4). 타입은 types.ts(S1), 빌더만 여기(S2, DAG).
import type { Message, ParticipantId, RoomSession, SpeakContext, Whisper } from './types'
import { completedNaturally } from './invariants'

// 귓속말 정규화 시 '사람' 발화자 표식([223] §4.1). 공개 ParticipantId와 충돌하지 않는 sentinel.
export const HUMAN_SENTINEL: ParticipantId = '__human__'

// [M4] 맥락 윈도우 — LLM은 stateless(매 요청 messages만 봄)라 history를 매번 보내야 함. 무한 누적 방지로 최근분만 전달.
export interface ContextLimit {
  maxMessages?: number // 최근 N개 발언만(슬라이딩 윈도우). 미지정 시 무제한
  maxChars?: number // 총 글자 budget 초과 시 오래된 것부터 버림(단일 거대 발언이 dominate해도 최소 1개는 유지)
}

// [C-2] 공개 done 전사 — self 포함(stateless 드라이버의 자기 기억). whisper는 history에 없어 자동 제외([223] §2).
// 화자 구분은 드라이버 prompt의 [이름] 라벨로. limit으로 최근 윈도우만 전달(누적 폭증·느려짐 방지, [223] §4 [M4]).
export function buildSpeakContext(session: RoomSession, speakerId: ParticipantId, limit?: ContextLimit): SpeakContext {
  const speaker = session.participants.find((p) => p.id === speakerId)
  if (!speaker) throw new Error(`buildSpeakContext: 알 수 없는 참가자 ${speakerId}`)
  let publicHistory = session.history.filter((m) => completedNaturally(m.status)) // 완료분만(streaming/stopped/error 미주입)
  if (limit?.maxMessages !== undefined && publicHistory.length > limit.maxMessages) {
    publicHistory = publicHistory.slice(-limit.maxMessages) // 최근 N개
  }
  if (limit?.maxChars !== undefined) {
    let total = publicHistory.reduce((s, m) => s + m.text.length, 0)
    while (publicHistory.length > 1 && total > limit.maxChars) {
      total -= publicHistory[0].text.length
      publicHistory = publicHistory.slice(1) // 오래된 것부터 제거(최소 1개는 유지)
    }
  }
  const roster = session.participants.map((p) => ({ id: p.id, name: p.name }))
  return { participant: speaker, publicHistory, roster }
}

// [H-3] 귓속말 스레드를 SpeakContext로 정규화 → 드라이버 seam([222] §8)이 동일 시그니처로 수용. 공개 history 불참조(사적 격리).
// 합성 Message[]는 휘발 — 드라이버 입력용일 뿐 history/MD/스냅샷에 안 들어감([223] §4.1). turnNo=-1로 표식(공개 발언은 항상 >=1).
export function whisperContext(target: ParticipantId, w: Whisper, session: RoomSession): SpeakContext {
  const speaker = session.participants.find((p) => p.id === target)
  if (!speaker) throw new Error(`whisperContext: 알 수 없는 대상 ${target}`)
  const publicHistory: Message[] = w.messages
    .filter((m) => m.text)
    .map((m, i): Message => ({
      id: `w${i}`,
      turnNo: -1,
      by: m.by === 'human' ? HUMAN_SENTINEL : m.by,
      role: m.by === 'human' ? 'human' : 'ai',
      text: m.text,
      status: 'done',
      ts: 0,
    }))
  // 귓속말 roster = 사람(sentinel) + 대상 둘뿐(사적 1:1, 공개 참가자 비참조)
  const human = session.participants.find((p) => p.kind === 'human')
  const roster = [
    { id: HUMAN_SENTINEL, name: human?.name ?? HUMAN_SENTINEL },
    { id: target, name: speaker.name },
  ]
  return { participant: speaker, publicHistory, roster }
}
