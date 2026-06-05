// 방 루트 — 터미널 창 레이아웃([225] §2). 좌측(로그+입력)·우측(roster)·귓속말 오버레이.
// [중요] UI는 Coordinator 상태를 store로 구독만([224] §1). 화면이 직접 floor를 만지지 않음.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { AUTO_TURNS_MIN, AUTO_TURNS_MAX, type Coordinator } from '../core/coordinator'
import type { ParticipantId, RoomSession } from '../core/types'
import { useRoomView, type RoomStore } from '../app/store'
import { config } from '../app/config'
import { buildColorMap } from './colors'
import { MessageLine } from './MessageLine'
import { computeRoundMarks } from './roundMarks'
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
  const [maxTurns, setMaxTurns] = useState(config.auto.maxTurns) // [개선] 자동 대화 턴 수(1~99) — 시작 시 coordinator로 전달
  const humanId = participants.find((p) => p.kind === 'human')?.id ?? participants[0]?.id
  const nameOf = (id: ParticipantId) => participants.find((p) => p.id === id)?.name ?? id
  const aiNames = participants.filter((p) => p.kind === 'ai').map((p) => p.name).join(', ')
  const aiCount = participants.filter((p) => p.kind === 'ai').length
  // [D-D] 라운드 종료선 위치 — 메시지 id → 라운드 번호(UI 전용 계산, 데이터 무변경)
  const roundMarks = useMemo(() => computeRoundMarks(view.history, aiCount), [view.history, aiCount])

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
        <span className="auto-group">
          <label className="auto-label">
            {t('auto.turns')}
            <input
              type="number"
              className="auto-turns"
              min={AUTO_TURNS_MIN}
              max={AUTO_TURNS_MAX}
              value={maxTurns}
              disabled={view.autoActive}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              title={t('auto.turnsHint')}
            />
          </label>
          <button
            className="auto-btn"
            aria-pressed={view.autoActive}
            onClick={() => (view.autoActive ? coord.stopAutoMode() : coord.startAutoMode(maxTurns))}
          >
            {view.autoActive ? t('auto.stop') : t('auto.start')}
          </button>
        </span>
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
                <Fragment key={m.id}>
                  <MessageLine msg={m} name={nameOf(m.by)} color={colorMap.get(m.by) ?? 'var(--ink)'} />
                  {roundMarks.has(m.id) && (
                    <div className="msg sys round-end">{t('sys.roundEnd', { n: roundMarks.get(m.id)! })}</div>
                  )}
                </Fragment>
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
