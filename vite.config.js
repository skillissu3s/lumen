import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
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
    {
      name: 'lumen-offline',
      // The files the service worker keeps for opening offline (everything the
      // app is built from, not the plugin catalog), and a stamp in sw.js so each
      // build installs afresh.
      apply: 'build',
      closeBundle() {
        const dist = path.join(here, 'dist')
        const sw = path.join(dist, 'sw.js')
        if (!fs.existsSync(sw)) return
        const files = []
        const walk = (dir, rel = '') => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) walk(path.join(dir, e.name), r)
            else files.push(r)
          }
        }
        for (const dir of ['assets', 'fonts']) if (fs.existsSync(path.join(dist, dir))) walk(path.join(dist, dir), dir)
        files.push('index.html', 'favicon.svg', 'manifest.webmanifest')
        files.sort()
        fs.writeFileSync(path.join(dist, 'sw-assets.json'), `${JSON.stringify(files)}\n`)
        const stamp = crypto.createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 12)
        fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__LUMEN_BUILD__', stamp))
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
