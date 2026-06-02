// Vitest 전역 셋업 — @testing-library/jest-dom 매처(toBeInTheDocument 등) 등록 + RTL 자동 cleanup.
// globals:false라 RTL이 afterEach cleanup을 자동 등록하지 못함 → 명시적으로 등록(렌더 DOM 누적 방지).
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
