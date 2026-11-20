// Names and usernames: chosen when an account is made, and an
// account the server made for someone (ADMIN_EMAIL) asks for them first.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let base = ''
let server = null
let out = ''

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

async function call(cookie, method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json', 'x-lumen': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(json?.error || String(res.status)), { status: res.status })
  return { json, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }
}

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-names-')), ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD: 'password123', ADMIN_NAME: '', MAIL_LOG_CODES: '1', SMTP_URL: '', SMTP_HOST: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  server.stdout.on('data', (d) => (out += d))
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
})

after(() => server?.kill())

test('an account made for you asks for your name and username first, and the new name names your candle', async () => {
  const step = (await call('', 'POST', '/api/login', { email: 'owner@example.com', password: 'password123' })).json
  assert.ok(step.needsCode)
  let code = null
  for (let i = 0; i < 50 && !code; i++) {
    code = /Your Lumen code: (\d{6})/.exec(out)?.[1]
    if (!code) await sleep(100)
  }
  const { json, cookie } = await call('', 'POST', '/api/login/verify', { challenge: step.challenge, code })
  assert.equal(json.user.needsProfile, true)
  assert.equal(json.user.name, 'Admin')
  assert.equal((await call(cookie, 'GET', '/api/spaces')).json.spaces.find((s) => s.kind === 'candle').name, 'Admin’s candle')

  const done = (await call(cookie, 'PATCH', '/api/me', { name: 'Nikhil', handle: 'nikhil' })).json.user
  assert.equal(done.needsProfile, undefined)
  assert.equal(done.handle, 'nikhil')
  assert.equal((await call(cookie, 'GET', '/api/spaces')).json.spaces.find((s) => s.kind === 'candle').name, 'Nikhil’s candle')
  // asked once: a restart doesn't ask again
  assert.equal((await call(cookie, 'GET', '/api/me')).json.user.needsProfile, undefined)

  // someone invited picks their own username, and a taken one is refused
  const link = (await call(cookie, 'POST', '/api/admin/invites', { role: 'member' })).json.url.split('/invite/')[1]
  await assert.rejects(call('', 'POST', `/api/invites/${link}/accept`, { name: 'Sam', handle: 'nikhil', email: 'sam@example.com', password: 'password123' }), /taken/)
  const sam = (await call('', 'POST', `/api/invites/${link}/accept`, { name: 'Sam Lee', handle: 'sam', email: 'sam@example.com', password: 'password123' })).json.user
  assert.equal(sam.handle, 'sam')
  assert.equal(sam.needsProfile, undefined)
})
