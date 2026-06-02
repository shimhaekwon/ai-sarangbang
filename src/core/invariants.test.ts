import { describe, it, expect } from 'vitest'
import { assertWhisperVolatile, completedNaturally } from './invariants'
import { message } from './test-helpers'

describe('completedNaturally([222] §5·§6)', () => {
  it('done만 true, 나머지 false', () => {
    expect(completedNaturally('done')).toBe(true)
    expect(completedNaturally('streaming')).toBe(false)
    expect(completedNaturally('stopped')).toBe(false)
    expect(completedNaturally('error')).toBe(false)
  })
})

describe('assertWhisperVolatile([223] §2)', () => {
  it('정상 공개 history(turnNo>=1)는 통과', () => {
    expect(() => assertWhisperVolatile([
      message({ id: 'm1', by: 'a1', turnNo: 1 }),
      message({ id: 'm2', by: 'h', turnNo: 2 }),
    ])).not.toThrow()
  })

  it('turnNo<1(합성/귓속말) Message가 섞이면 throw', () => {
    expect(() => assertWhisperVolatile([
      message({ id: 'm1', by: 'a1', turnNo: 1 }),
      message({ id: 'w0', by: 'a1', turnNo: -1 }), // 유출된 whisper 합성물
    ])).toThrow(/유출/)
  })
})
