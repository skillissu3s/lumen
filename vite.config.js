import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// The landing page (index.html) and the app (app.html) are two separate entries.
// `base: './'` + hash routing means the built files run from any static host,
// including a GitHub Pages sub-path.
export default defineConfig({
  root: 'client',
  base: './',
  plugins: [
    react(),
    {
      name: 'lumen-catalog',
      // After a build, ship the plugin catalog alongside the app so GitHub mode
      // can install plugins with no server.
      closeBundle() {
        const src = path.join(here, 'plugins')
        if (!fs.existsSync(src)) return
        const dest = path.join(here, 'dist', 'catalog')
        fs.cpSync(src, dest, { recursive: true })
      },
    },
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.join(here, 'client', 'index.html'),
        app: path.join(here, 'client', 'app.html'),
      },
    },
  },
  // bundle every dependency up front: a re-bundle mid-session can leave two
  // copies of React in the dev server's cache
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'zustand', 'zustand/vanilla', 'lucide-react', 'markdown-it', 'dompurify', 'diff-match-patch'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'http://localhost:3000', ws: true },
      '/catalog': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
})
