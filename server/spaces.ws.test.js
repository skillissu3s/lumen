// Live updates across spaces: what someone may see changes while they're
// connected (a share given, lowered, taken back; joining and leaving a
// workspace) and their socket says so, in their own paths.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
let base = ''
let child = null
let ada = ''
let bob = ''

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })
}

const call = async (cookie, method, url, body) => {
  const res = await fetch(base + url, { method, headers: { cookie, 'content-type': 'application/json', 'x-lumen': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, body: await res.json().catch(() => null), cookies }
}

// a socket that collects file notices, and waits for the one we expect
function listen(cookie) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie } })
  const seen = []
  const waiting = []
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type !== 'files') return
    seen.push(...msg.changes)
    for (const w of [...waiting]) if (seen.some(w.match)) waiting.splice(waiting.indexOf(w), 1) && w.resolve()
  })
  return {
    open: new Promise((r) => ws.once('open', r)),
    until(match, ms = 4000) {
      if (seen.some(match)) return Promise.resolve()
      return new Promise((resolve, reject) => {
        waiting.push({ match, resolve })
        setTimeout(() => reject(new Error('no such notice')), ms)
      })
    },
    clear: () => seen.splice(0),
    close: () => ws.close(),
  }
}

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-ws-'))
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, MAIL_LOG_CODES: '', SMTP_URL: '', SMTP_HOST: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  ada = (await call('', 'POST', '/api/setup', { email: 'ada@example.com', name: 'Ada', password: 'password123' })).cookies
  const inv = await call(ada, 'POST', '/api/admin/invites', { email: 'bob@example.com', role: 'member' })
  const token = inv.body.url.split('/invite/')[1]
  bob = (await call('', 'POST', `/api/invites/${token}/accept`, { name: 'Bob', password: 'password123', email: 'bob@example.com' })).cookies
})

after(() => child?.kill())

test('a share given, lowered and taken back reaches the other person’s socket', async () => {
  const sock = listen(bob)
  await sock.open
  const at = 'shared/ada/lists/plan.md'
  let r = await call(ada, 'PUT', '/api/files', { path: 'lists/plan.md', text: '---\nname: Plan\nshare: [bob]\n---\n\n- [ ] one\n', sha: null })
  await sock.until((c) => c.path === at && !c.deleted)
  // an edit by Ada arrives too
  r = await call(ada, 'PUT', '/api/files', { path: 'lists/plan.md', text: '---\nname: Plan\nshare: [bob]\n---\n\n- [ ] one\n- [ ] two\n', sha: r.body.sha })
  await sock.until((c) => c.path === at && c.sha === r.body.sha)
  // lowered to view: still there, but Bob's edits are refused
  r = await call(ada, 'PUT', '/api/files', { path: 'lists/plan.md', text: '---\nname: Plan\nshare: [bob:view]\n---\n\n- [ ] one\n- [ ] two\n', sha: r.body.sha })
  await sock.until((c) => c.path === at && c.sha === r.body.sha)
  const tried = await call(bob, 'PUT', '/api/files', { path: at, text: '---\nname: Plan\nshare: [bob:view]\n---\n\n- [ ] mine\n', sha: r.body.sha })
  assert.equal(tried.status, 403)
  // taken back: it goes
  r = await call(ada, 'PUT', '/api/files', { path: 'lists/plan.md', text: '---\nname: Plan\n---\n\n- [ ] one\n- [ ] two\n', sha: r.body.sha })
  await sock.until((c) => c.path === at && c.deleted)
  sock.close()
})

test('joining a workspace brings its files; being removed takes them away', async () => {
  const sock = listen(bob)
  await sock.open
  const ws = (await call(ada, 'POST', '/api/spaces', { name: 'Crew' })).body.space
  const { token } = (await call(ada, 'POST', `/api/spaces/${ws.id}/invites`, {})).body
  assert.equal((await call(bob, 'POST', `/api/join/${token}`)).status, 200)
  await sock.until((c) => c.path === 'workspaces/crew/lists/inbox.md' && !c.deleted)
  // a change by Ada in the workspace reaches Bob at his path for it
  const r = await call(ada, 'PUT', '/api/files', { path: 'workspaces/crew/lists/todo.md', text: '---\nname: Todo\n---\n\n- [ ] go\n', sha: null })
  await sock.until((c) => c.path === 'workspaces/crew/lists/todo.md' && c.sha === r.body.sha)
  const bobId = (await call(bob, 'GET', '/api/me')).body.user.id
  assert.equal((await call(ada, 'DELETE', `/api/spaces/${ws.id}/members/${bobId}`)).status, 200)
  await sock.until((c) => c.path === 'workspaces/crew/lists/todo.md' && c.deleted)
  sock.clear()
  // and nothing more of it arrives
  await call(ada, 'PUT', '/api/files', { path: 'workspaces/crew/lists/later.md', text: '---\nname: Later\n---\n', sha: null })
  await assert.rejects(sock.until((c) => c.path.includes('crew'), 600), /no such notice/)
  sock.close()
})
