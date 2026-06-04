import { describe, it, expect, beforeEach } from 'vitest'
import { saveConfig, loadConfig, clearConfig, reconcileModels } from './persist'
import type { RoomConfig } from './config'

const KEY = 'ai-sarangbang.config'
const cfg: RoomConfig = {
  v: 1,
  ais: [
    { id: 'x1', name: 'A', model: 'm1', think: false },
    { id: 'x2', name: 'B', model: 'm2' }, // think 미지정(undefined)
  ],
  humanName: '나',
}

beforeEach(() => {
  clearConfig()
})

describe('persist([228] §4.7 / H3)', () => {
  it('round-trip: save → load 동일', () => {
    saveConfig(cfg)
    expect(loadConfig()).toEqual(cfg)
  })

  it('저장값 없으면 null', () => {
    expect(loadConfig()).toBeNull()
  })

  it('손상 JSON → null(무throw)', () => {
    localStorage.setItem(KEY, '{broken json')
    expect(() => loadConfig()).not.toThrow()
    expect(loadConfig()).toBeNull()
  })

  it('버전 불일치 → null(기본값 폴백)', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, ais: [] }))
    expect(loadConfig()).toBeNull()
  })

  it('슬롯 구조 불량(model 누락) → null', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ais: [{ id: 'x', name: 'A' }] }))
    expect(loadConfig()).toBeNull()
  })

  it('think 비-boolean → null', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ais: [{ id: 'x', name: 'A', model: 'm', think: 'yes' }] }))
    expect(loadConfig()).toBeNull()
  })

  it('clearConfig 후 load null', () => {
    saveConfig(cfg)
    clearConfig()
    expect(loadConfig()).toBeNull()
  })

  it('reconcileModels: 현재 목록에 없는 모델 태그 반환', () => {
    expect(reconcileModels(cfg, ['m1'])).toEqual(['m2']) // m2 사라짐
    expect(reconcileModels(cfg, ['m1', 'm2'])).toEqual([]) // 전부 존재
    expect(reconcileModels(cfg, [])).toEqual(['m1', 'm2']) // 전부 사라짐
  })

  it('reconcileModels: 같은 모델 중복 슬롯 → dedup(L-B)', () => {
    const dup: RoomConfig = { v: 1, ais: [{ id: 'a', name: 'A', model: 'gone' }, { id: 'b', name: 'B', model: 'gone' }] }
    expect(reconcileModels(dup, ['m1'])).toEqual(['gone']) // 한 번만
  })

  it('[연결] baseUrl round-trip + 비-문자열 거부(v:1 호환)', () => {
    saveConfig({ ...cfg, baseUrl: 'http://pc2:11434' })
    expect(loadConfig()?.baseUrl).toBe('http://pc2:11434')
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ais: [], baseUrl: 123 }))
    expect(loadConfig()).toBeNull() // baseUrl 비-문자열 → null
  })
})
