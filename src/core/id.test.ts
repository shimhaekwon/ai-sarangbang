import { describe, it, expect } from 'vitest'
import { newMessageId, newSessionId } from './id'

describe('id 생성([223] §1.3)', () => {
  it('newSessionId = YYYYMMDD-HHmm-xxxxxx 포맷', () => {
    const fixed = new Date(2026, 5, 2, 14, 30) // 2026-06-02 14:30 (month 0-based: 5=June)
    expect(newSessionId(fixed)).toMatch(/^20260602-1430-[0-9a-z]{6}$/)
  })

  it('한 자리 월/일/시/분도 0-padding', () => {
    const d = new Date(2026, 0, 3, 4, 5) // 2026-01-03 04:05
    expect(newSessionId(d)).toMatch(/^20260103-0405-[0-9a-z]{6}$/)
  })

  it('newMessageId = 6자리 [0-9a-z]', () => {
    expect(newMessageId()).toMatch(/^[0-9a-z]{6}$/)
  })

  it('대량 생성 시 충돌 없음(1000개 유니크)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(newMessageId())
    expect(set.size).toBe(1000)
  })
})
