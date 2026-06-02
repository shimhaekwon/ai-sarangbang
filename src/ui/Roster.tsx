// 참가자 좌석순 + 상태(발언중/대기/완료/중단) + 색 점([225] §2·§5). AI 클릭 = 귓속말 진입([225] §6).
import type { Participant, ParticipantId } from '../core/types'
import type { RoomView } from '../app/store'
import { t } from '../i18n'

export interface RosterProps {
  participants: Participant[]
  view: RoomView
  colorMap: Map<string, string>
  onWhisper: (target: ParticipantId) => void
}

function labelFor(view: RoomView, p: Participant): { label: string; cls: string } {
  if (view.floorHolder === p.id) return { label: t('status.speaking'), cls: 'floor' }
  switch (view.turnState.get(p.id)) {
    case 'queued':
      return { label: t('status.queued'), cls: 'queued' }
    case 'done':
      return { label: t('status.done'), cls: 'done' }
    case 'stopped':
      return { label: t('status.stopped'), cls: 'stopped' }
    default:
      return { label: p.kind === 'human' ? t('status.here') : '', cls: '' }
  }
}

export function Roster({ participants, view, colorMap, onWhisper }: RosterProps) {
  const ordered = [...participants].sort((a, b) => a.seat - b.seat)
  return (
    <div className="roster">
      <h4>{t('roster.title')}</h4>
      {ordered.map((p) => {
        const { label, cls } = labelFor(view, p)
        const color = colorMap.get(p.id) ?? 'var(--ink)'
        const isAi = p.kind === 'ai'
        return (
          <div
            key={p.id}
            className={`pp ${cls}`.trim()}
            role={isAi ? 'button' : undefined}
            title={isAi ? t('whisper.title') : undefined}
            onClick={isAi ? () => onWhisper(p.id) : undefined}
          >
            <span className="seat">{p.seat}</span>
            <span className="d" style={{ background: color }} />
            <span className="nm" style={{ color }}>{p.name}</span>
            <span className="st">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
