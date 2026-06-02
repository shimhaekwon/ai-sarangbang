import { describe, it, expect } from 'vitest'
import { buildParticipantMarkdown, buildSummaryMarkdown, slug } from './md-export'
import { message, participant, room } from '../core/test-helpers'

// 결정적 픽스처(고정 ts·createdAt=0). 턴1: 나→감자→고구마, 턴2: 나→감자(중단).
const fixture = () =>
  room(
    [
      participant({ id: 'h', name: '나', kind: 'human', seat: 0 }),
      participant({ id: 'a1', name: '감자', kind: 'ai', seat: 1 }),
      participant({ id: 'a2', name: '고구마', kind: 'ai', seat: 2 }),
    ],
    [
      message({ id: 'm1', by: 'h', role: 'human', text: '안녕하세요', status: 'done', turnNo: 1, ts: 1 }),
      message({ id: 'm2', by: 'a1', role: 'ai', text: '반갑네', status: 'done', turnNo: 1, ts: 2 }),
      message({ id: 'm3', by: 'a2', role: 'ai', text: '어서오게', status: 'done', turnNo: 1, ts: 3 }),
      message({ id: 'm4', by: 'h', role: 'human', text: '뭐하세요', status: 'done', turnNo: 2, ts: 4 }),
      message({ id: 'm5', by: 'a1', role: 'ai', text: '', status: 'stopped', turnNo: 2, ts: 5 }),
    ],
  )

describe('buildSummaryMarkdown([223] §3) — 전원 합본·결정적', () => {
  it('턴 순서대로 전원 발언, 중단은 placeholder', () => {
    expect(buildSummaryMarkdown(fixture())).toBe(
      `# 사랑방 대화 기록
> 세션: 1970-01-01T00:00:00.000Z | 참가자: 3명 | 턴: 2

## Turn 1
[나] 안녕하세요
[감자] 반갑네
[고구마] 어서오게

## Turn 2
[나] 뭐하세요
[감자] _(중단/응답없음)_
`,
    )
  })
})

describe('buildParticipantMarkdown([223] §3.2) — 단일 관점', () => {
  it('감자: 자기 발언까지(턴1 고구마 제외), 미발언 부분 placeholder', () => {
    expect(buildParticipantMarkdown(fixture(), 'a1')).toBe(
      `# 감자 — 사랑방 기록
> 세션: 1970-01-01T00:00:00.000Z | 참가자: 3명 | 턴: 2

## Turn 1
[나] 안녕하세요
[감자] 반갑네

## Turn 2
[나] 뭐하세요
[감자] _(중단/응답없음)_
`,
    )
  })

  it('고구마: 발언한 턴1은 전체, 미발언 턴2는 맥락 전체', () => {
    expect(buildParticipantMarkdown(fixture(), 'a2')).toBe(
      `# 고구마 — 사랑방 기록
> 세션: 1970-01-01T00:00:00.000Z | 참가자: 3명 | 턴: 2

## Turn 1
[나] 안녕하세요
[감자] 반갑네
[고구마] 어서오게

## Turn 2
[나] 뭐하세요
[감자] _(중단/응답없음)_
`,
    )
  })

  it('알 수 없는 참가자 → throw', () => {
    expect(() => buildParticipantMarkdown(fixture(), 'ghost')).toThrow()
  })
})

describe('slug([223] §3.3) — 파일명 안전화', () => {
  it('한글 보존', () => {
    expect(slug('감자')).toBe('감자')
  })
  it('경로 금지문자 제거 · 공백→_', () => {
    expect(slug('a/b:c*d?"<>|')).toBe('abcd')
    expect(slug('hello world')).toBe('hello_world')
  })
  it('빈 이름 → unnamed', () => {
    expect(slug('')).toBe('unnamed')
  })
  it('40자 초과 절단', () => {
    expect(slug('가'.repeat(60)).length).toBe(40)
  })
})
