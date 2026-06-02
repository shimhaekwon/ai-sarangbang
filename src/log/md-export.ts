// MD 로그 포맷([223] §3) — 결정적 생성(LLM 요약/절삭 없음, 원문 전체). 공개 대화만(whisper는 구조적으로 닿지 못함, [223] §2).
// 입력이 RoomSession(=Message[])뿐이라 whisper에 닿을 수 없음(타입 차단). 웹앱이므로 chrome.downloads → Blob 다운로드 치환([223] §3.3).
import type { Message, ParticipantId, RoomSession } from '../core/types'
import { completedNaturally } from '../core/invariants'

const PLACEHOLDER = '_(중단/응답없음)_' // status !== 'done'(중단·에러·미완) 발언의 본문 자리 유지([223] §3.1)

function maxTurnNo(session: RoomSession): number {
  return session.history.reduce((mx, m) => Math.max(mx, m.turnNo), 0)
}
function nameOf(session: RoomSession, id: ParticipantId): string {
  return session.participants.find((p) => p.id === id)?.name ?? id
}
// 발언 순서 = turnNo → ts(결정적, [223] §3.1).
function sortedHistory(session: RoomSession): Message[] {
  return [...session.history].sort((a, b) => a.turnNo - b.turnNo || a.ts - b.ts)
}
function turnNumbers(session: RoomSession): number[] {
  return [...new Set(sortedHistory(session).map((m) => m.turnNo))].sort((a, b) => a - b)
}
function bodyOf(m: Message): string {
  return completedNaturally(m.status) ? m.text : PLACEHOLDER
}
function header(title: string, session: RoomSession): string[] {
  return [
    `# ${title}`,
    `> 세션: ${new Date(session.createdAt).toISOString()} | 참가자: ${session.participants.length}명 | 턴: ${maxTurnNo(session)}`,
  ]
}

// 참가자별 단일 관점 — 자기 발언 + 발언 시점까지 본 공개 맥락([223] §3.2). [H3] §4 빌더(self 제외 아님)와 달리 자기 발언 포함(사람이 읽는 기록).
// 자기가 발언한 턴은 자기 발언까지(이후 같은 턴 화자는 그 시점엔 못 봄), 미발언 턴은 전체(맥락으로 들음).
export function buildParticipantMarkdown(session: RoomSession, participantId: ParticipantId): string {
  const target = session.participants.find((p) => p.id === participantId)
  if (!target) throw new Error(`buildParticipantMarkdown: 알 수 없는 참가자 ${participantId}`)
  const lines = header(`${target.name} — 사랑방 기록`, session)
  const all = sortedHistory(session)
  for (const turn of turnNumbers(session)) {
    const turnMsgs = all.filter((m) => m.turnNo === turn)
    const myIdx = turnMsgs.findIndex((m) => m.by === participantId)
    const visible = myIdx === -1 ? turnMsgs : turnMsgs.slice(0, myIdx + 1)
    if (visible.length === 0) continue
    lines.push('', `## Turn ${turn}`)
    for (const m of visible) lines.push(`[${nameOf(session, m.by)}] ${bodyOf(m)}`)
  }
  return lines.join('\n') + '\n'
}

// 전체 합본 — 턴 순서대로 전원 발언([223] §3.2). 사람 발화도 [이름](하드코딩 금지, Participant.name).
export function buildSummaryMarkdown(session: RoomSession): string {
  const lines = header('사랑방 대화 기록', session)
  const all = sortedHistory(session)
  for (const turn of turnNumbers(session)) {
    const turnMsgs = all.filter((m) => m.turnNo === turn)
    if (turnMsgs.length === 0) continue
    lines.push('', `## Turn ${turn}`)
    for (const m of turnMsgs) lines.push(`[${nameOf(session, m.by)}] ${bodyOf(m)}`)
  }
  return lines.join('\n') + '\n'
}

// [M-E] 파일명 안전화: 한글 보존, 경로 금지문자 제거, 공백→_, 길이 제한([223] §3.3).
export function slug(name: string): string {
  return (name || 'unnamed').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 40)
}

// Blob 다운로드(chrome.downloads 치환) — 브라우저 전용([223] §3.3).
function downloadMarkdown(filename: string, md: string): void {
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url) // 누수 방지
}

// 공개 대화 MD 저장(요청 시·whisper 제외). 다중 파일 = 순차 anchor 클릭([223] §3.3, zip은 follow-up).
export function saveSessionMarkdown(
  session: RoomSession,
  participantIds: ParticipantId[],
  includeSummary: boolean,
): void {
  for (const id of participantIds) {
    const p = session.participants.find((x) => x.id === id)
    if (!p) continue
    downloadMarkdown(`${slug(p.name)}.md`, buildParticipantMarkdown(session, id))
  }
  if (includeSummary) downloadMarkdown('summary.md', buildSummaryMarkdown(session))
}
