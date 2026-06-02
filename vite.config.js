/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 빌드/런타임(Vite) + 단위 테스트(Vitest) 단일 설정. [226] §2 — environment: jsdom.
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test-setup.ts'],
        globals: false,
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
});
