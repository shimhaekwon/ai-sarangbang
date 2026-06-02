// UI 한글 리터럴 0 게이트([226] §2 · [221] §6) — src/ui 코드/JSX는 한글 리터럴 금지(모두 i18n 경유).
// 주석의 한글 설명은 허용(코드만 검사). 시연 데이터는 src/app(여기 비대상).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UI_DIR = dirname(fileURLToPath(import.meta.url))
const HANGUL = /[가-힣㄰-㆏]/

function uiSourceFiles(): string[] {
  return readdirSync(UI_DIR)
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
    .map((f) => join(UI_DIR, f))
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('UI 한글 리터럴 0([226] §2)', () => {
  it('대상 파일 존재(빈 통과 방지)', () => {
    expect(uiSourceFiles().length).toBeGreaterThanOrEqual(6)
  })

  it('src/ui 코드/JSX에 한글 리터럴 없음(모두 i18n 경유)', () => {
    for (const file of uiSourceFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'))
      const m = HANGUL.exec(code)
      const around = m ? code.slice(Math.max(0, m.index - 25), m.index + 25) : ''
      expect(m, `${file} 한글 리터럴 발견 → "${around}"`).toBeNull()
    }
  })
})
