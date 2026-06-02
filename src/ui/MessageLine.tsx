// 공개 발언 1줄 — [이름] 본문 + 상태 표식([225] §5). 색 = 화자색. 타이핑은 자체 애니메이션 없이
// msg.text를 그대로 렌더(스트리밍 중엔 토큰마다 store emit → 리렌더 = 타이핑 효과의 단일 소스, [222] §4.1).
import type { Message } from '../core/types'
import { t } from '../i18n'

export interface MessageLineProps {
  msg: Message
  name: string
  color: string
}

export function MessageLine({ msg, name, color }: MessageLineProps) {
  const streaming = msg.status === 'streaming'
  const halted = msg.status === 'stopped' || msg.status === 'error'
  return (
    <div className={`msg${halted ? ' stopped' : ''}`} data-status={msg.status}>
      <span className="who" style={{ color }}>[{name}]</span>{' '}
      <span className="body">{msg.text}</span>
      {streaming && <span className="cursor" aria-hidden="true" />}
      {msg.status === 'stopped' && <span className="tagx">{t('msg.stopped')}</span>}
      {msg.status === 'error' && <span className="tagx">{t('msg.error')}</span>}
    </div>
  )
}
