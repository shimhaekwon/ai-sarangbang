// 방 루트 — 터미널 창 레이아웃([225] §2). 좌측(로그+입력)·우측(roster)·귓속말 오버레이.
// [중요] UI는 Coordinator 상태를 store로 구독만([224] §1). 화면이 직접 floor를 만지지 않음.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Coordinator } from '../core/coordinator'
import type { ParticipantId, RoomSession } from '../core/types'
import { useRoomView, type RoomStore } from '../app/store'
import { buildColorMap } from './colors'
import { MessageLine } from './MessageLine'
import { Roster } from './Roster'
import { Composer } from './Composer'
import { WhisperPanel } from './WhisperPanel'
import { SaveBar } from './SaveBar'
import { t } from '../i18n'

export interface RoomProps {
  room: RoomSession
  store: RoomStore
  coord: Coordinator
  onLeave: () => void // [228 §8] 헤더 [설정] → App이 dispose 후 로비로
}

export function Room({ room, store, coord, onLeave }: RoomProps) {
  const view = useRoomView(store)
  const participants = room.participants
  const colorMap = useMemo(() => buildColorMap(participants), [participants])
  const [whisperTarget, setWhisperTarget] = useState<ParticipantId | null>(null)
  const humanId = participants.find((p) => p.kind === 'human')?.id ?? participants[0]?.id
  const nameOf = (id: ParticipantId) => participants.find((p) => p.id === id)?.name ?? id
  const aiNames = participants.filter((p) => p.kind === 'ai').map((p) => p.name).join(', ')

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [view.history])

  return (
    <div className="term">
      <div className="bar">
        <span className="dot" style={{ background: '#ff5f57' }} />
        <span className="dot" style={{ background: '#febc2e' }} />
        <span className="dot" style={{ background: '#28c840' }} />
        <span className="t">{t('app.title')}</span>
        <button
          className="auto-btn"
          aria-pressed={view.autoActive}
          onClick={() => (view.autoActive ? coord.stopAutoMode() : coord.startAutoMode())}
        >
          {view.autoActive ? t('auto.stop') : t('auto.start')}
        </button>
        <SaveBar room={room} />
        <button className="leave-btn" onClick={onLeave}>
          {t('room.settings')}
        </button>
      </div>
      <div className="body">
        <div className="main-col">
          <div className="screen">
            <div className="log" ref={logRef}>
              <div className="msg sys">{t('sys.enter')}</div>
              {aiNames && <div className="msg sys">{t('sys.join', { names: aiNames })}</div>}
              {view.history.map((m) => (
                <MessageLine key={m.id} msg={m} name={nameOf(m.by)} color={colorMap.get(m.by) ?? 'var(--ink)'} />
              ))}
            </div>
          </div>
          {humanId && <Composer coord={coord} humanId={humanId} />}
        </div>
        <Roster participants={participants} view={view} colorMap={colorMap} onWhisper={setWhisperTarget} />
      </div>
      {whisperTarget && (
        <WhisperPanel
          target={whisperTarget}
          participants={participants}
          view={view}
          coord={coord}
          onClose={() => setWhisperTarget(null)}
        />
      )}
    </div>
  )
}
