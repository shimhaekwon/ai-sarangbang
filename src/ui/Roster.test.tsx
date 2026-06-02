import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Roster } from './Roster'
import { t } from '../i18n'
import { participant } from '../core/test-helpers'
import type { RoomView } from '../app/store'
import type { TurnState } from '../core/types'

function mkView(over: Partial<RoomView> = {}): RoomView {
  return { history: [], status: 'turn_active', turnNo: 1, floorHolder: null, turnState: new Map(), whispers: new Map(), ...over }
}
const ps = () => [
  participant({ id: 'h', name: '나', kind: 'human', seat: 0 }),
  participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
]
const cmap = new Map([['h', 'var(--me)'], ['a1', 'var(--ai1)']])

describe('Roster([225] §2·§5)', () => {
  it('floor 보유자 발언중 하이라이트', () => {
    const { container } = render(<Roster participants={ps()} view={mkView({ floorHolder: 'a1' })} colorMap={cmap} onWhisper={() => {}} />)
    expect(screen.getByText('감자')).toBeInTheDocument()
    expect(container.querySelector('.pp.floor')).toBeTruthy()
    expect(screen.getByText(t('status.speaking'))).toBeInTheDocument()
  })

  it('queued 라벨', () => {
    const ts = new Map<string, TurnState>([['a1', 'queued']])
    render(<Roster participants={ps()} view={mkView({ turnState: ts })} colorMap={cmap} onWhisper={() => {}} />)
    expect(screen.getByText(t('status.queued'))).toBeInTheDocument()
  })

  it('AI 클릭 → onWhisper(target), 사람은 클릭 대상 아님', () => {
    const onW = vi.fn()
    render(<Roster participants={ps()} view={mkView()} colorMap={cmap} onWhisper={onW} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1) // AI(감자)만 button
    fireEvent.click(buttons[0])
    expect(onW).toHaveBeenCalledWith('a1')
  })
})
