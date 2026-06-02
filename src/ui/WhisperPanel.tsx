// 귓속말 1:1 패널([221] R4 · [222] §7 · [225] §6) — 보라색 격리 오버레이. 휘발 배너. 공개 로그와 절대 안 섞임.
// thread는 store.whispers(휘발 미러)에서. 입력 → coord.whisper(target,text). Esc 닫기.
import { useState, type KeyboardEvent } from 'react'
import type { Coordinator } from '../core/coordinator'
import type { Participant, ParticipantId } from '../core/types'
import type { RoomView } from '../app/store'
import { t } from '../i18n'

export interface WhisperPanelProps {
  target: ParticipantId
  participants: Participant[]
  view: RoomView
  coord: Coordinator
  onClose: () => void
}

export function WhisperPanel({ target, participants, view, coord, onClose }: WhisperPanelProps) {
  const [text, setText] = useState('')
  const targetName = participants.find((p) => p.id === target)?.name ?? target
  const thread = view.whispers.get(target)
  const send = () => {
    const value = text.trim()
    if (!value) return
    void coord.whisper(target, value)
    setText('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }
  return (
    <div className="whisper-overlay" onClick={onClose}>
      <div className="whisper-panel" onClick={(e) => e.stopPropagation()}>
        <div className="whisper-head">
          <span className="whisper-to">{t('whisper.to', { name: targetName })}</span>
          <button onClick={onClose} aria-label={t('whisper.close')}>×</button>
        </div>
        <div className="whisper-banner">{t('whisper.banner')}</div>
        <div className="whisper-thread">
          {(thread?.messages ?? []).map((m, i) => (
            <div key={i} className={`wmsg ${m.by === 'human' ? 'wme' : 'wai'}`}>{m.text}</div>
          ))}
        </div>
        <input
          className="whisper-ip"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('whisper.placeholder')}
          aria-label={t('whisper.placeholder')}
          autoFocus
        />
      </div>
    </div>
  )
}
