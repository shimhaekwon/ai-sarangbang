// 로비 엔드투엔드 — listModels(fetch) stub + 실제 렌더로 로드/입장/게이트/폴백 검증.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Lobby } from './Lobby'
import { t } from '../i18n'

function tagsRes(names: string[]): Response {
  return { ok: true, status: 200, json: async () => ({ models: names.map((n) => ({ name: n })) }) } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Lobby([228])', () => {
  it('모델 로드 → 기본 1슬롯 + [입장] → onEnter(RoomConfig)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tagsRes(['exaone3.5:7.8b', 'qwen3.5:4b'])))
    const onEnter = vi.fn()
    render(<Lobby onEnter={onEnter} onDemo={() => {}} />)
    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeEnabled())
    fireEvent.click(screen.getByText(t('lobby.enter')))
    expect(onEnter).toHaveBeenCalledTimes(1)
    const cfg = onEnter.mock.calls[0][0]
    expect(cfg.v).toBe(1)
    expect(cfg.ais).toHaveLength(1)
    expect(cfg.ais[0].model).toBe('exaone3.5:7.8b')
    expect(cfg.ais[0].name).toBeTruthy()
  })

  it('Ollama 미실행(fetch throw) → 에러 + [Mock 데모로 시작]', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const onDemo = vi.fn()
    render(<Lobby onEnter={() => {}} onDemo={onDemo} />)
    await waitFor(() => expect(screen.getByText(t('lobby.error'))).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('lobby.demo')))
    expect(onDemo).toHaveBeenCalledTimes(1)
  })

  it('[M1] AI 0명 → 입장 비활성 게이트', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tagsRes(['m1'])))
    render(<Lobby onEnter={() => {}} onDemo={() => {}} />)
    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeEnabled())
    fireEvent.click(screen.getByLabelText(t('lobby.remove'))) // 유일 슬롯 삭제 → 0명
    expect(screen.getByText(t('lobby.enter'))).toBeDisabled()
    expect(screen.getByText(t('lobby.gate'))).toBeInTheDocument()
  })

  it('모델 0개 → 안내 + Mock 데모 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tagsRes([])))
    const onDemo = vi.fn()
    render(<Lobby onEnter={() => {}} onDemo={onDemo} />)
    await waitFor(() => expect(screen.getByText(t('lobby.empty'))).toBeInTheDocument())
    fireEvent.click(screen.getByText(t('lobby.demo')))
    expect(onDemo).toHaveBeenCalledTimes(1)
  })

  it('+ AI 추가 → 슬롯 증가(최대 6 게이트)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tagsRes(['m1'])))
    render(<Lobby onEnter={() => {}} onDemo={() => {}} />)
    await waitFor(() => expect(screen.getByText(t('lobby.addAi'))).toBeInTheDocument())
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByText(t('lobby.addAi')))
    expect(screen.getAllByLabelText(t('lobby.remove'))).toHaveLength(6) // 1 + 5 = 6 상한
    expect(screen.getByText(t('lobby.addAi'))).toBeDisabled()
  })

  it('[연결] 재연결이 편집 중 슬롯을 덮어쓰지 않음(HIGH)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tagsRes(['m1', 'm2'])))
    render(<Lobby onEnter={() => {}} onDemo={() => {}} />)
    await waitFor(() => expect(screen.getByText(t('lobby.addAi'))).toBeEnabled())
    fireEvent.click(screen.getByText(t('lobby.addAi'))) // 편집: 2슬롯
    expect(screen.getAllByLabelText(t('lobby.remove'))).toHaveLength(2)
    fireEvent.click(screen.getByText(t('lobby.reconnect'))) // 재연결
    await waitFor(() => expect(screen.getByText(t('lobby.addAi'))).toBeEnabled())
    expect(screen.getAllByLabelText(t('lobby.remove'))).toHaveLength(2) // 편집 보존(기본 1슬롯으로 덮어쓰지 않음)
  })

  it('[연결] 입장 시 baseUrl 정규화(scheme 없는 host:port → http:// 보충)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tagsRes(['m1'])))
    const onEnter = vi.fn()
    render(<Lobby onEnter={onEnter} onDemo={() => {}} />)
    await waitFor(() => expect(screen.getByText(t('lobby.enter'))).toBeEnabled())
    fireEvent.change(screen.getByLabelText(t('lobby.ollamaUrl')), { target: { value: 'localhost:11434' } })
    fireEvent.click(screen.getByText(t('lobby.enter')))
    expect(onEnter.mock.calls[0][0].baseUrl).toBe('http://localhost:11434')
  })
})
