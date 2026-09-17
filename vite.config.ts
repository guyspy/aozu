import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { defineConfig } from 'vite'

const buildId = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${buildId}-[hash].js`,
        chunkFileNames: `assets/[name]-${buildId}-[hash].js`,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
