import { describe, it, expect } from 'vitest'
import { normalizeBaseUrl } from './config'

describe('normalizeBaseUrl([연결])', () => {
  it('빈/공백/undefined → "" (proxy 폴백)', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
    expect(normalizeBaseUrl(undefined)).toBe('')
  })

  it('scheme 없으면 http:// 보충(상대경로 오인 방지)', () => {
    expect(normalizeBaseUrl('localhost:11434')).toBe('http://localhost:11434')
    expect(normalizeBaseUrl('192.168.0.5:11434')).toBe('http://192.168.0.5:11434')
  })

  it('scheme 있으면 보존(http/https)', () => {
    expect(normalizeBaseUrl('http://pc2:11434')).toBe('http://pc2:11434')
    expect(normalizeBaseUrl('https://host:443')).toBe('https://host:443')
  })

  it('trailing slash 제거(// 이중 경로 방지)', () => {
    expect(normalizeBaseUrl('http://x:11434/')).toBe('http://x:11434')
    expect(normalizeBaseUrl('localhost:11434//')).toBe('http://localhost:11434')
  })
})
