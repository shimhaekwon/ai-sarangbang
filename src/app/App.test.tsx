// [228 §4.1 / C2] App 전환 배선 — 로비↔방 phase 전환이 이전 세션 coord.dispose()를 부르는지(C2가 겨냥한 seam).
// Coordinator.dispose 단위 테스트와 별개: 여기선 "전환이 dispose를 호출하는 배선" 자체를 검증.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from './App'
import { Coordinator } from '../core/coordinator'
import { t } from '../i18n'

function tagsRes(names: string[]): Response {
  return { ok: true, status: 200, json: async () => ({ models: names.map((n) => ({ name: n })) }) } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('App([228] §4.1 — phase 전환 + dispose 배선)', () => {
  it('로비 → 입장 → 방 → [설정] → 로비, leave가 이전 세션 dispose', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsRes(['m1'])))
    const disposeSpy = vi.spyOn(Coordinator.prototype, 'dispose')
    render(<App />)

    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeEnabled())
    fireEvent.click(screen.getByText(t('lobby.enter')))

    await waitFor(() => expect(screen.getByPlaceholderText(t('composer.placeholder'))).toBeInTheDocument())
    expect(disposeSpy).not.toHaveBeenCalled() // 첫 입장: 이전 세션 없음

    fireEvent.click(screen.getByText(t('room.settings')))
    expect(disposeSpy).toHaveBeenCalledTimes(1) // leave → 직전 세션 dispose
    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeInTheDocument()) // 로비 복귀
  })

  it('재입장 시 leave에서만 dispose(재입장 시점엔 이전 세션 null)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tagsRes(['m1'])))
    const disposeSpy = vi.spyOn(Coordinator.prototype, 'dispose')
    render(<App />)

    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeEnabled())
    fireEvent.click(screen.getByText(t('lobby.enter')))
    await waitFor(() => expect(screen.getByPlaceholderText(t('composer.placeholder'))).toBeInTheDocument())

    fireEvent.click(screen.getByText(t('room.settings'))) // leave → dispose 1
    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeEnabled())

    fireEvent.click(screen.getByText(t('lobby.enter'))) // 재입장
    await waitFor(() => expect(screen.getByPlaceholderText(t('composer.placeholder'))).toBeInTheDocument())
    expect(disposeSpy).toHaveBeenCalledTimes(1) // 재입장 시 sessionRef=null → 추가 dispose 없음
  })
})
