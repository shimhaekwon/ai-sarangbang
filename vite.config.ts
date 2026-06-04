/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 빌드/런타임(Vite) + 단위 테스트(Vitest) 단일 설정. [226] §2 — environment: jsdom.
export default defineConfig({
  plugins: [react()],
  // [P1] CORS 우회([224] §3 A2) — 브라우저는 동일출처 /ollama 호출, Vite가 localhost:11434로 프록시(키 없음, 우회 전용).
  // [228 C1/D-8] dev + preview 모두 프록시(로비 /api/tags·/api/chat). prod 서빙은 별도 프록시 필요(prod 미지원 명시).
  server: {
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
