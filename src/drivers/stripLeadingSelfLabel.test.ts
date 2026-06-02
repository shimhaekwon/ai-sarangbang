import { describe, it, expect } from 'vitest'
import { stripLeadingSelfLabel } from './stripLeadingSelfLabel'
import type { AgentDriver } from './AgentDriver'
import type { SpeakContext } from '../core/types'

function fixedDriver(tokens: string[]): AgentDriver {
  return {
    // eslint-disable-next-line require-yield
    async *speak() {
      for (const t of tokens) yield t
    },
  }
}
function ctx(name: string): SpeakContext {
  return { participant: { id: 'x', name, kind: 'ai', seat: 1 }, publicHistory: [], roster: [{ id: 'x', name }] }
}
async function run(tokens: string[], name: string): Promise<string> {
  const d = stripLeadingSelfLabel(fixedDriver(tokens))
  let out = ''
  for await (const t of d.speak(ctx(name), new AbortController().signal)) out += t
  return out
}

describe('stripLeadingSelfLabel — 이름 메아리 제거', () => {
  it('[이름] 단일 제거', async () => {
    expect(await run(['[Qwen3] ', '안녕하세요'], 'Qwen3')).toBe('안녕하세요')
  })
  it('[이름] 중복 제거', async () => {
    expect(await run(['[Qwen3] [Qwen3] ', '안녕'], 'Qwen3')).toBe('안녕')
  })
  it('이름: 콜론형 제거', async () => {
    expect(await run(['Qwen3: ', '안녕'], 'Qwen3')).toBe('안녕')
  })
  it('이름 공백형 제거', async () => {
    expect(await run(['Qwen3 ', '안녕'], 'Qwen3')).toBe('안녕')
  })
  it('토큰 쪼개진 라벨도 제거', async () => {
    expect(await run(['[Qw', 'en3', '] ', '안녕'], 'Qwen3')).toBe('안녕')
  })
  it('라벨 없으면 그대로', async () => {
    expect(await run(['안녕', '하세요'], 'Qwen3')).toBe('안녕하세요')
  })
  it('이름이 본문 일부면 보존(공백/콜론 경계 없음)', async () => {
    expect(await run(['Qwen3은 ', '모델'], 'Qwen3')).toBe('Qwen3은 모델')
  })
  it('짧은 응답(라벨+본문 1토큰)도 제거', async () => {
    expect(await run(['[Qwen3] 네'], 'Qwen3')).toBe('네')
  })
})
