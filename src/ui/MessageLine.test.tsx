import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageLine } from './MessageLine'
import { t } from '../i18n'
import { message } from '../core/test-helpers'

describe('MessageLine([225] §5)', () => {
  it('[이름] 본문 렌더', () => {
    render(<MessageLine msg={message({ id: 'm', by: 'a1', text: '안녕', status: 'done' })} name="감자" color="var(--ai1)" />)
    expect(screen.getByText('[감자]')).toBeInTheDocument()
    expect(screen.getByText('안녕')).toBeInTheDocument()
  })

  it('streaming → 커서 + data-status', () => {
    const { container } = render(
      <MessageLine msg={message({ id: 'm', by: 'a1', text: '타이', status: 'streaming' })} name="감자" color="x" />,
    )
    expect(container.querySelector('.cursor')).toBeTruthy()
    expect(container.querySelector('[data-status="streaming"]')).toBeTruthy()
  })

  it('stopped → 부분 텍스트 + 중단 표식 + stopped 클래스', () => {
    const { container } = render(
      <MessageLine msg={message({ id: 'm', by: 'a1', text: '부분', status: 'stopped' })} name="감자" color="x" />,
    )
    expect(screen.getByText('부분')).toBeInTheDocument()
    expect(container.querySelector('.msg.stopped')).toBeTruthy()
    expect(screen.getByText(t('msg.stopped'))).toBeInTheDocument()
  })

  it('error + 빈 텍스트(무응답) → (응답 없음) 표식 + stopped(시각) 클래스', () => {
    const { container } = render(
      <MessageLine msg={message({ id: 'm', by: 'a1', text: '', status: 'error' })} name="감자" color="x" />,
    )
    expect(container.querySelector('.msg.stopped')).toBeTruthy()
    expect(screen.getByText(t('msg.noResponse'))).toBeInTheDocument()
  })

  it('error + 부분 텍스트 → (응답 오류) 표식', () => {
    render(<MessageLine msg={message({ id: 'm', by: 'a1', text: '부분답변', status: 'error' })} name="감자" color="x" />)
    expect(screen.getByText(t('msg.error'))).toBeInTheDocument()
  })

  it('이름 escape(XSS 방지): 태그가 텍스트로 렌더', () => {
    const { container } = render(
      <MessageLine msg={message({ id: 'm', by: 'x', text: 'hi', status: 'done' })} name={'<img src=x onerror=alert(1)>'} color="x" />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
