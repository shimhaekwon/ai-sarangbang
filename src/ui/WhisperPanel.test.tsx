import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WhisperPanel } from './WhisperPanel'
import { t } from '../i18n'
import { participant } from '../core/test-helpers'
import type { RoomView } from '../app/store'
import type { Coordinator } from '../core/coordinator'

function mkView(over: Partial<RoomView> = {}): RoomView {
  return { history: [], status: 'idle', turnNo: 0, floorHolder: null, turnState: new Map(), turnOrder: new Map(), whispers: new Map(), autoActive: false, ...over }
}
const ps = [participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 })]
const mockCoord = () => ({ whisper: vi.fn() }) as unknown as Coordinator

describe('WhisperPanel([225] §6 · 휘발)', () => {
  it('휘발 배너 + 스레드 렌더', () => {
    const view = mkView({
      whispers: new Map([['a1', { target: 'a1', messages: [{ by: 'human', text: '비밀얘기' }, { by: 'a1', text: '쉿' }] }]]),
    })
    render(<WhisperPanel target="a1" participants={ps} view={view} coord={mockCoord()} onClose={() => {}} />)
    expect(screen.getByText(t('whisper.banner'))).toBeInTheDocument()
    expect(screen.getByText('비밀얘기')).toBeInTheDocument()
    expect(screen.getByText('쉿')).toBeInTheDocument()
  })

  it('Enter → coord.whisper(target, text)', () => {
    const coord = mockCoord()
    render(<WhisperPanel target="a1" participants={ps} view={mkView()} coord={coord} onClose={() => {}} />)
    const input = screen.getByPlaceholderText(t('whisper.placeholder'))
    fireEvent.change(input, { target: { value: '안녕' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(coord.whisper).toHaveBeenCalledWith('a1', '안녕')
  })

  it('Esc → onClose', () => {
    const onClose = vi.fn()
    render(<WhisperPanel target="a1" participants={ps} view={mkView()} coord={mockCoord()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByPlaceholderText(t('whisper.placeholder')), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
