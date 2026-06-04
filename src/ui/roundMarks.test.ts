import { describe, expect, it } from 'vitest'
import { computeRoundMarks } from './roundMarks'
import type { Message } from '../core/types'

let seq = 0
function msg(turnNo: number, by: string, role: 'human' | 'ai'): Message {
  return { id: `m${seq++}`, turnNo, by, role, text: 'x', status: 'done', ts: 0 }
}

describe('computeRoundMarks — 라운드 경계(전원 한 바퀴)', () => {
  it('빈 history → 마크 0', () => {
    expect(computeRoundMarks([], 3).size).toBe(0)
  })

  it('aiCount<1 → 마크 0(AI 없으면 자동 라운드 개념 없음)', () => {
    const h = [msg(1, 'h', 'human'), msg(1, 'a1', 'ai')]
    expect(computeRoundMarks(h, 0).size).toBe(0)
  })

  it('사람 턴(입력+AI 전원, 같은 turnNo) → 턴 끝에 라운드 1', () => {
    const m0 = msg(1, 'h', 'human')
    const m1 = msg(1, 'a1', 'ai')
    const m2 = msg(1, 'a2', 'ai')
    const m3 = msg(1, 'a3', 'ai')
    const marks = computeRoundMarks([m0, m1, m2, m3], 3)
    expect(marks.size).toBe(1)
    expect(marks.get(m3.id)).toBe(1) // 마지막 발언 뒤
  })

  it('자동 발언: AI 전원이 한 번씩 등장하면 라운드(turnNo 1씩 증가)', () => {
    const a = msg(2, 'a1', 'ai')
    const b = msg(3, 'a2', 'ai')
    const c = msg(4, 'a3', 'ai')
    const marks = computeRoundMarks([a, b, c], 3)
    expect(marks.size).toBe(1)
    expect(marks.get(c.id)).toBe(1)
  })

  it('자동: 같은 AI 재등장은 전원 집합 기준(a1,a3,a1,a2 → a2에서 1라운드)', () => {
    const a = msg(2, 'a1', 'ai')
    const b = msg(3, 'a3', 'ai')
    const c = msg(4, 'a1', 'ai') // 재등장 — 아직 a2 미등장
    const d = msg(5, 'a2', 'ai') // 전원(a1,a3,a2) 완성
    const marks = computeRoundMarks([a, b, c, d], 3)
    expect(marks.size).toBe(1)
    expect(marks.has(c.id)).toBe(false) // 미완 시점
    expect(marks.get(d.id)).toBe(1)
  })

  it('사람 턴 + 자동 한 바퀴 → 라운드 1·2', () => {
    const h0 = msg(1, 'h', 'human')
    const h1 = msg(1, 'a1', 'ai')
    const x = msg(2, 'a1', 'ai')
    const y = msg(3, 'a2', 'ai')
    const marks = computeRoundMarks([h0, h1, x, y], 2)
    expect(marks.get(h1.id)).toBe(1) // 사람 턴 종료
    expect(marks.get(y.id)).toBe(2) // 자동 전원(a1,a2) 종료
  })

  it('AI 1명 자동 → 매 발언이 1라운드', () => {
    const a = msg(2, 'a1', 'ai')
    const b = msg(3, 'a1', 'ai')
    const marks = computeRoundMarks([a, b], 1)
    expect(marks.get(a.id)).toBe(1)
    expect(marks.get(b.id)).toBe(2)
  })

  it('미완 자동 바퀴(전원 미등장) → 종료선 없음', () => {
    const a = msg(2, 'a1', 'ai')
    const b = msg(3, 'a2', 'ai') // 3명 중 2명만
    expect(computeRoundMarks([a, b], 3).size).toBe(0)
  })

  it('사람 입력이 진행 중이던 미완 자동 바퀴를 리셋', () => {
    const x = msg(2, 'a1', 'ai') // 자동 1명(3AI 중 미완)
    const h0 = msg(3, 'h', 'human')
    const h1 = msg(3, 'a1', 'ai')
    const h2 = msg(3, 'a2', 'ai')
    const h3 = msg(3, 'a3', 'ai')
    const marks = computeRoundMarks([x, h0, h1, h2, h3], 3)
    expect(marks.has(x.id)).toBe(false) // 자동 미완 → 마크 없음(리셋)
    expect(marks.get(h3.id)).toBe(1) // 사람 턴 = 라운드 1
  })

  it('[회귀] 라이브 로그 자동 시퀀스 — 전원 한 바퀴마다 정확히 라운드(런타임 비교 기준)', () => {
    // 2026-06-05 라이브 자동 발언 순서(사람턴=라운드1 제외). E=Exaone P=Phi4 Q=Qwen
    const auto = ['E', 'P', 'E', 'P', 'E', 'P', 'Q', 'P', 'E', 'Q', 'E', 'Q', 'P', 'E', 'Q', 'E', 'Q', 'P', 'E', 'Q']
    const hist = [
      msg(1, 'h', 'human'), msg(1, 'Q', 'ai'), msg(1, 'E', 'ai'), msg(1, 'P', 'ai'), // 라운드1 사람턴
      ...auto.map((by, i) => msg(2 + i, by, 'ai')),
    ]
    const marks = computeRoundMarks(hist, 3)
    const rounds = hist.filter((m) => marks.has(m.id)).map((m) => ({ turnNo: m.turnNo, r: marks.get(m.id) }))
    // 로직상 라운드는 5개(1=사람턴, 2~5=전원 한 바퀴마다). 라이브 화면엔 라운드4가 turnNo14 직후에 떠야 했음.
    expect(rounds.map((x) => x.r)).toEqual([1, 2, 3, 4, 5])
    expect(rounds[3].turnNo).toBe(14) // 라운드4 = 13번째 자동(Phi4) 직후 — 라이브에서 누락된 그 위치
  })
})
