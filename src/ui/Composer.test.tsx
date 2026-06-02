import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Composer } from './Composer'
import { t } from '../i18n'
import type { Coordinator } from '../core/coordinator'

function mockCoord() {
  return { startTurn: vi.fn() } as unknown as Coordinator
}

describe('Composer([225] §2)', () => {
  it('Enter → coord.startTurn(humanMsg)', () => {
    const coord = mockCoord()
    render(<Composer coord={coord} humanId="me" />)
    const input = screen.getByPlaceholderText(t('composer.placeholder'))
    fireEvent.change(input, { target: { value: '안녕' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(coord.startTurn).toHaveBeenCalledTimes(1)
    expect((coord.startTurn as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      by: 'me',
      role: 'human',
      text: '안녕',
    })
  })

  it('빈/공백 입력은 무시', () => {
    const coord = mockCoord()
    render(<Composer coord={coord} humanId="me" />)
    const input = screen.getByPlaceholderText(t('composer.placeholder'))
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(coord.startTurn).not.toHaveBeenCalled()
  })
})
