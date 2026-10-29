import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3001,
    strictPort: true,
    host: false,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    // Vite 8 / Rolldown: 'esbuild' braucht extra Install, 'oxc' ist neuer Default.
    minify: 'oxc',
    sourcemap: false,
  },
})
