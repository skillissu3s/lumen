// The server's first workspace (its home) once deleted stays deleted: starting
// again doesn't make a new, empty "Workspace" in its place.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-home-'))
let base = ''
let server = null

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

async function start() {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_EMAIL: '', ADMIN_PASSWORD: '', MAIL_LOG_CODES: '', SMTP_URL: '', SMTP_HOST: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
}

async function stop() {
  server.kill()
  await new Promise((r) => server.once('exit', r))
}

// the session's cookie is named after the port, which changes with every start
async function call(token, method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie: `lumen_session=${token}`, 'content-type': 'application/json', 'x-lumen': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || String(res.status))
  return { json, token: /lumen_session(?:_\d+)?=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1] }
}

after(() => server?.kill())

test('a deleted home workspace isn’t made again when the server starts', async () => {
  await start()
  const { token } = await call('', 'POST', '/api/setup', { email: 'ada@example.com', name: 'Ada', handle: 'ada', password: 'password123' })
  const mine = await call(token, 'POST', '/api/spaces', { name: 'Mobile Games' })
  const home = (await call(token, 'GET', '/api/spaces')).json.spaces.find((s) => s.home)
  await call(token, 'DELETE', `/api/spaces/${home.id}`)

  await stop()
  await start()
  const after = (await call(token, 'GET', '/api/spaces')).json.spaces
  assert.deepEqual(after.filter((s) => s.kind === 'workspace').map((s) => s.id), [mine.json.space.id])

  // and someone joining the server later isn't put in it
  const inv = (await call(token, 'POST', '/api/admin/invites', { role: 'member' })).json
  const bob = await call('', 'POST', `/api/invites/${inv.url.split('/invite/')[1]}/accept`, { name: 'Bob', handle: 'bob', email: 'bob@example.com', password: 'password123' })
  assert.deepEqual((await call(bob.token, 'GET', '/api/spaces')).json.spaces.map((s) => s.kind), ['candle'])
})
