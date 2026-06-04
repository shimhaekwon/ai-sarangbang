// 엔드투엔드 — 실제 store+coordinator+MockDriver 와이어링으로 "동작하는 사랑방" 검증(헤드리스).
// 실타이머 + waitFor(비동기 store emit→리렌더 처리). 바지인 등 메커닉은 coordinator.test가 결정적으로 검증.
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Room } from './Room'
import { Coordinator } from '../core/coordinator'
import { createMockDriver } from '../drivers/MockDriver'
import { createRoomStore } from '../app/store'
import { participant } from '../core/test-helpers'
import { t } from '../i18n'
import type { RoomSession } from '../core/types'

function setup() {
  const participants = [
    participant({ id: 'me', name: '나', kind: 'human', seat: 0 }),
    participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
  ]
  const room: RoomSession = { id: 'r', createdAt: 0, status: 'idle', turnNo: 0, floorHolder: null, participants, history: [] }
  const store = createRoomStore(room)
  const driver = createMockDriver({ lines: { a1: [{ text: '반가워' }] }, defaultPerTokenMs: 1 })
  const coord = new Coordinator(room, driver, store)
  return { room, store, coord }
}

describe('Room — 동작하는 사랑방(엔드투엔드)', () => {
  it('사람 입력 → AI 발언이 로그에 [이름]으로 렌더', async () => {
    const { room, store, coord } = setup()
    render(<Room room={room} store={store} coord={coord} onLeave={() => {}} />)
    const input = screen.getByPlaceholderText(t('composer.placeholder'))
    fireEvent.change(input, { target: { value: '안녕' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('[감자]')).toBeInTheDocument())
    expect(screen.getByText('[나]')).toBeInTheDocument()
    expect(screen.getByText('안녕')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('반가워')).toBeInTheDocument())
  })
})
