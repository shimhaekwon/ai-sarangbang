// core 순수성 게이트([224] §1·§6 · [226] DoD) — src/core는 React/DOM 미의존(멀티유저 서버 이식·단위 테스트 가능성의 토대).
// eslint no-restricted-imports의 Vitest 등가물 — 설정 없이 회귀를 즉시 차단.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CORE_DIR = dirname(fileURLToPath(import.meta.url))

function coreSourceFiles(): string[] {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-helpers.ts')
    .map((f) => join(CORE_DIR, f))
}

describe('core 순수성([224] §1 · DoD)', () => {
  it('대상 파일이 존재(가드 자체가 빈 통과되지 않도록)', () => {
    expect(coreSourceFiles().length).toBeGreaterThanOrEqual(4)
  })

  it('react/react-dom import 0', () => {
    for (const file of coreSourceFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from\s+['"]react(-dom)?['"]/)
    }
  })

  it('DOM 전역(document/window) 미사용', () => {
    for (const file of coreSourceFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(document|window)\b/)
    }
  })
})
