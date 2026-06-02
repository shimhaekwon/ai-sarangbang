import { describe, it, expect } from 'vitest'
import { buildSpeakContext, HUMAN_SENTINEL, whisperContext } from './context'
import { message, participant, room } from './test-helpers'
import type { Whisper } from './types'

describe('buildSpeakContext([223] §4 · [C-2] self 포함)', () => {
  it('self 포함 — 발화자 자기 발언도 publicHistory에 들어간다(stateless 드라이버 자기 기억)', () => {
    const human = participant({ id: 'h', name: '나', kind: 'human', seat: 0 })
    const ai = participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 })
    const r = room([human, ai], [
      message({ id: 'm1', by: 'h', role: 'human', text: '안녕', status: 'done', turnNo: 1 }),
      message({ id: 'm2', by: 'a1', role: 'ai', text: '반가워', status: 'done', turnNo: 1 }),
    ])
    const ctx = buildSpeakContext(r, 'a1')
    expect(ctx.participant.id).toBe('a1')
    expect(ctx.publicHistory.map((m) => m.id)).toEqual(['m1', 'm2']) // self(m2) 포함
  })

  it('done만 — streaming/stopped/error는 미주입(completed-only)', () => {
    const ai = participant({ id: 'a1', kind: 'ai', seat: 1 })
    const r = room([ai], [
      message({ id: 'd', by: 'a1', status: 'done', turnNo: 1 }),
      message({ id: 's', by: 'a1', status: 'streaming', turnNo: 1 }),
      message({ id: 'x', by: 'a1', status: 'stopped', turnNo: 1 }),
      message({ id: 'e', by: 'a1', status: 'error', turnNo: 1 }),
    ])
    expect(buildSpeakContext(r, 'a1').publicHistory.map((m) => m.id)).toEqual(['d'])
  })

  it('알 수 없는 화자 → throw', () => {
    expect(() => buildSpeakContext(room([], []), 'nope')).toThrow()
  })
})

describe('whisperContext([223] §4.1 · [M1] 정규화)', () => {
  it('human→__human__ · turnNo=-1 · status=done · 공개 history 0참조', () => {
    const ai = participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 })
    const r = room([ai], [message({ id: 'pub', by: 'a1', text: '공개발언', status: 'done', turnNo: 1 })])
    const w: Whisper = { target: 'a1', messages: [{ by: 'human', text: '비밀?' }, { by: 'a1', text: '쉿' }] }
    const ctx = whisperContext('a1', w, r)
    expect(ctx.participant.id).toBe('a1')
    expect(ctx.publicHistory).toHaveLength(2)
    expect(ctx.publicHistory[0]).toMatchObject({ by: HUMAN_SENTINEL, role: 'human', turnNo: -1, status: 'done', text: '비밀?' })
    expect(ctx.publicHistory[1]).toMatchObject({ by: 'a1', role: 'ai', turnNo: -1, status: 'done', text: '쉿' })
    expect(ctx.publicHistory.some((m) => m.text === '공개발언')).toBe(false) // 공개 history 불참조(사적 격리)
  })

  it('빈 text 메시지는 제외', () => {
    const ai = participant({ id: 'a1', kind: 'ai', seat: 1 })
    const w: Whisper = { target: 'a1', messages: [{ by: 'human', text: 'q' }, { by: 'a1', text: '' }] }
    expect(whisperContext('a1', w, room([ai], [])).publicHistory).toHaveLength(1)
  })

  it('알 수 없는 대상 → throw', () => {
    const w: Whisper = { target: 'nope', messages: [] }
    expect(() => whisperContext('nope', w, room([], []))).toThrow()
  })
})
