// Runs the server (node --watch) and the Vite dev server side by side, prefixing
// each line with where it came from. Ctrl-C stops both.
import { spawn } from 'node:child_process'

const forward = (label) => (data) => {
  for (const line of data.toString().split(/\r?\n/)) {
    if (line.trim() !== '') process.stdout.write(`[${label}] ${line}\n`)
  }
}

const server = spawn(process.execPath, ['--watch', '--disable-warning=ExperimentalWarning', 'server/index.js'], {
  env: { ...process.env, PORT: '3000', DATA_DIR: './data' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

server.stdout.on('data', forward('server'))
server.stderr.on('data', forward('server'))
web.stdout.on('data', forward('web'))
web.stderr.on('data', forward('web'))

const children = [server, web]
const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
