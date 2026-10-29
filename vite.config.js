import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tests (`npm test`): *.test.ts neben dem Code, Node-Umgebung; .claude/ = Arbeitskopien von Claude Code
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
