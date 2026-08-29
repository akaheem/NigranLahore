import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.jsx'],
    include: ['tests/unit/**/*.test.{js,jsx}', 'tests/component/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
    clearMocks: true,
  },
})
