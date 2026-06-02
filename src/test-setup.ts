// Vitest 전역 셋업 — @testing-library/jest-dom 매처(toBeInTheDocument 등) 등록.
// M1(헤드리스 메커닉)에선 미사용이나, S6(UI/RTL) 테스트에서 사용.
import '@testing-library/jest-dom/vitest'
