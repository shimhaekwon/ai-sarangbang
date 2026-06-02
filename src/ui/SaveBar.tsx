// 공개 대화 MD 저장([223] §3 · [225] §4) — 참가자별 + 합본. 귓속말은 구조적으로 제외(입력이 RoomSession뿐).
import type { RoomSession } from '../core/types'
import { saveSessionMarkdown } from '../log/md-export'
import { t } from '../i18n'

export interface SaveBarProps {
  room: RoomSession
}

export function SaveBar({ room }: SaveBarProps) {
  const save = () => saveSessionMarkdown(room, room.participants.map((p) => p.id), true)
  return (
    <span className="savebar">
      <button onClick={save}>{t('save.button')}</button>
      <span className="note">{t('save.note')}</span>
    </span>
  )
}
