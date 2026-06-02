// 사람 입력 → startTurn([222] 유일 진입점). 턴 진행 중 Enter = 바지인(D3) — coordinator가 알아서 인터럽트.
import { useState, type KeyboardEvent } from 'react'
import type { Coordinator } from '../core/coordinator'
import type { ParticipantId } from '../core/types'
import { newMessageId } from '../core/id'
import { t } from '../i18n'

export interface ComposerProps {
  coord: Coordinator
  humanId: ParticipantId
}

export function Composer({ coord, humanId }: ComposerProps) {
  const [text, setText] = useState('')
  const submit = () => {
    const value = text.trim()
    if (!value) return
    // turnNo/status는 coordinator가 확정(startTurn에서 status='done', runTurn에서 turnNo 주입).
    coord.startTurn({ id: newMessageId(), turnNo: 0, by: humanId, role: 'human', text: value, status: 'streaming', ts: Date.now() })
    setText('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }
  return (
    <div className="composer">
      <span className="ps">{'> '}</span>
      <input
        className="ip"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('composer.placeholder')}
        aria-label={t('composer.placeholder')}
        autoFocus
      />
      <span className="hint">{t('composer.hint')}</span>
    </div>
  )
}
