// End-to-end tests for the server: start it in a child process against a fresh
// temp data dir and drive the HTTP API.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(here, 'index.js')

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class CookieJar {
  constructor() {
    this.map = new Map()
  }
  store(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      if (i > 0) this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1))
    }
  }
  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

let base = ''
let child = null
let admin = null
let adminJar = new CookieJar()
let member = null
let memberJar = new CookieJar()
let captureFile = ''

async function api(jar, method, url, body) {
  const headers = {}
  if (jar.header()) headers.cookie = jar.header()
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD') headers['x-lumen'] = '1'
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  jar.store(res)
  return res
}

async function waitFor(url, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const r = await fetch(url)
      if (r.status < 500) return r
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  throw new Error('server did not start')
}

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'))
  captureFile = path.join(dataDir, 'mail.capture')
  child = spawn(process.execPath, [indexPath], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LUMEN_ALLOW_FILE_REMOTES: '1', MAIL_LOG_CODES: '1', MAIL_CAPTURE_FILE: captureFile },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitFor(`${base}/api/info`)
})

after(() => {
  child?.kill()
})

async function inviteMember(email, name) {
  let res = await api(adminJar, 'POST', '/api/admin/invites', { email, role: 'member' })
  assert.equal(res.status, 200)
  const url = (await res.json()).url
  const token = url.split('/invite/')[1]
  const jar = new CookieJar()
  res = await api(jar, 'POST', `/api/invites/${token}/accept`, { name, password: 'password123', email })
  assert.equal(res.status, 200)
  return { jar, user: (await res.json()).user }
}

function clearCapture() {
  try {
    fs.writeFileSync(captureFile, '')
  } catch {
    /* not created yet */
  }
}

function captured() {
  try {
    return fs
      .readFileSync(captureFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

function lastCode(email) {
  const lines = captured()
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].to === email && lines[i].code) return lines[i].code
  }
  return null
}

test('info → setup → info shows user and seeded files', async () => {
  let res = await fetch(`${base}/api/info`)
  let info = await res.json()
  assert.equal(info.mode, 'server')
  assert.equal(info.needsSetup, true)
  assert.equal(info.user, null)

  res = await api(adminJar, 'POST', '/api/setup', { email: 'admin@example.com', name: 'Ada', password: 'password123' })
  assert.equal(res.status, 200)
  admin = (await res.json()).user
  assert.equal(admin.role, 'admin')
  assert.ok(admin.handle)

  res = await api(adminJar, 'GET', '/api/info')
  info = await res.json()
  assert.equal(info.needsSetup, false)
  assert.equal(info.user.handle, admin.handle)

  res = await api(adminJar, 'GET', '/api/files')
  const paths = (await res.json()).files.map((f) => f.path)
  for (const p of ['lumen.json', '.gitattributes', 'lists/inbox.md', 'calendars/personal.md', 'docs/welcome.md']) {
    assert.ok(paths.includes(p), `seeded ${p}`)
  }
})

test('CSRF: PUT without X-Lumen is rejected', async () => {
  const res = await fetch(`${base}/api/files`, {
    method: 'PUT',
    headers: { cookie: adminJar.header(), 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'lists/x.md', text: 'hi', sha: null }),
  })
  assert.equal(res.status, 403)
})

test('files: create, update, stale-sha 409, delete', async () => {
  const text0 = `---\nname: Test\nowner: ${admin.handle}\n---\n- [ ] hi\n`
  let res = await api(adminJar, 'PUT', '/api/files', { path: 'lists/test.md', text: text0, sha: null })
  assert.equal(res.status, 200)
  const sha0 = (await res.json()).sha
  assert.ok(sha0)

  const text1 = text0 + '- [ ] more\n'
  res = await api(adminJar, 'PUT', '/api/files', { path: 'lists/test.md', text: text1, sha: sha0 })
  assert.equal(res.status, 200)
  const sha1 = (await res.json()).sha
  assert.notEqual(sha1, sha0)

  res = await api(adminJar, 'PUT', '/api/files', { path: 'lists/test.md', text: text1, sha: sha0 })
  assert.equal(res.status, 409)
  const conflict = await res.json()
  assert.equal(conflict.current.sha, sha1)

  res = await api(adminJar, 'DELETE', '/api/files', { path: 'lists/test.md', sha: sha1 })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('access control between admin and member', async () => {
  const invite = await inviteMember('member@example.com', 'Bob')
  member = invite.user
  memberJar = invite.jar
  assert.equal(member.role, 'member')

  const privateText = `---\nname: Private\nowner: ${admin.handle}\n---\n- [ ] secret\n`
  let res = await api(adminJar, 'PUT', '/api/files', { path: 'lists/private.md', text: privateText, sha: null })
  assert.equal(res.status, 200)
  const privateSha = (await res.json()).sha

  res = await api(memberJar, 'GET', '/api/files')
  const memberPaths = (await res.json()).files.map((f) => f.path)
  assert.ok(!memberPaths.includes('lists/private.md'), 'private list not listed')

  res = await api(memberJar, 'POST', '/api/files/read', { paths: ['lists/private.md'] })
  assert.equal((await res.json()).files['lists/private.md'], null, 'private list unreadable')

  // a write with a stale sha must not answer with the private text
  res = await api(memberJar, 'PUT', '/api/files', { path: 'lists/private.md', text: 'x', sha: 'stale' })
  assert.equal(res.status, 404, 'no 409 (with the current text) for a file you cannot read')
  assert.ok(!(await res.text()).includes('secret'))

  const sharedText = `---\nname: Private\nshare: [${member.handle}]\nowner: ${admin.handle}\n---\n- [ ] secret\n`
  res = await api(adminJar, 'PUT', '/api/files', { path: 'lists/private.md', text: sharedText, sha: privateSha })
  assert.equal(res.status, 200)
  const sharedSha = (await res.json()).sha

  res = await api(memberJar, 'POST', '/api/files/read', { paths: ['lists/private.md'] })
  assert.equal((await res.json()).files['lists/private.md'].sha, sharedSha)

  const memberEdit = sharedText + '- [ ] done\n'
  res = await api(memberJar, 'PUT', '/api/files', { path: 'lists/private.md', text: memberEdit, sha: sharedSha })
  assert.equal(res.status, 200)
  const afterEditSha = (await res.json()).sha

  const tryShare = `---\nname: Private\nshare: everyone\nowner: ${admin.handle}\n---\n- [ ] secret\n`
  res = await api(memberJar, 'PUT', '/api/files', { path: 'lists/private.md', text: tryShare, sha: afterEditSha })
  assert.equal(res.status, 403, 'member cannot change share')

  res = await api(memberJar, 'PUT', '/api/files', { path: 'plugins/x/manifest.json', text: '{}', sha: null })
  assert.equal(res.status, 403, 'member cannot write plugin code')

  res = await api(memberJar, 'PUT', '/api/files', { path: 'lists/mine.md', text: `---\nname: Mine\nowner: ${member.handle}\n---\n`, sha: null })
  assert.equal(res.status, 200, 'member creates own list')

  res = await api(memberJar, 'PUT', '/api/files', { path: 'lists/forged.md', text: `---\nname: Forged\nowner: ${admin.handle}\n---\n`, sha: null })
  assert.equal(res.status, 403, 'member cannot own a file for someone else')
})

test('chat: post, edit, permissions, delete, DM isolation', async () => {
  let res = await api(adminJar, 'POST', '/api/chat/messages', { channel: 'general', text: 'Hello team' })
  assert.equal(res.status, 200)
  const m1 = (await res.json()).message
  assert.ok(m1.id)
  assert.equal(m1.from, admin.handle)

  res = await api(memberJar, 'GET', '/api/chat/messages?channel=general')
  assert.equal(res.status, 200)
  let messages = (await res.json()).messages
  assert.ok(messages.some((m) => m.id === m1.id))

  res = await api(adminJar, 'PATCH', '/api/chat/messages', { channel: 'general', id: m1.id, text: 'Hello team!' })
  assert.equal(res.status, 200)
  const edited = (await res.json()).message
  assert.equal(edited.edited, true)
  assert.equal(edited.text, 'Hello team!')

  res = await api(memberJar, 'PATCH', '/api/chat/messages', { channel: 'general', id: m1.id, text: 'nope' })
  assert.equal(res.status, 403, 'cannot edit another’s message')

  res = await api(memberJar, 'POST', '/api/chat/messages', { channel: 'general', text: 'hi' })
  const m2 = (await res.json()).message
  res = await api(memberJar, 'DELETE', '/api/chat/messages', { channel: 'general', id: m2.id })
  assert.equal(res.status, 200)

  res = await api(adminJar, 'GET', '/api/chat/messages?channel=general')
  messages = (await res.json()).messages
  const deleted = messages.find((m) => m.id === m2.id)
  assert.ok(deleted && deleted.deleted === true && deleted.text === '')

  const carol = await inviteMember('carol@example.com', 'Carol')

  res = await api(adminJar, 'POST', '/api/chat/channels', { dm: member.handle })
  assert.equal(res.status, 200)
  const dm = (await res.json()).channel
  assert.equal(dm.dm, true)

  res = await api(adminJar, 'POST', '/api/chat/messages', { channel: dm.id, text: 'secret' })
  assert.equal(res.status, 200)

  res = await api(memberJar, 'GET', `/api/chat/messages?channel=${dm.id}`)
  assert.ok((await res.json()).messages.length > 0, 'member sees the DM')

  res = await api(carol.jar, 'GET', `/api/chat/messages?channel=${dm.id}`)
  assert.equal(res.status, 404, 'outsider gets 404 on the DM')

  res = await api(carol.jar, 'GET', '/api/chat/channels')
  const carolChannels = (await res.json()).channels.map((c) => c.id)
  assert.ok(!carolChannels.includes(dm.id), 'outsider does not see the DM channel')
})

test('git sync to a local bare repo', { skip: !hasGit }, async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-bare-'))
  execFileSync('git', ['init', '--bare', bare])
  const remote = bare.replace(/\\/g, '/')

  let res = await api(adminJar, 'PUT', '/api/admin/sync', { remote, branch: 'main', enabled: true })
  assert.equal(res.status, 200)

  res = await api(adminJar, 'PUT', '/api/files', { path: 'lists/sync.md', text: `---\nname: Sync\nowner: ${admin.handle}\n---\n- [ ] synced\n`, sha: null })
  assert.equal(res.status, 200)

  res = await api(adminJar, 'POST', '/api/admin/sync/now')
  assert.equal(res.status, 200)
  const status = (await res.json()).status
  assert.equal(status.state, 'idle')

  const log = execFileSync('git', ['--git-dir', bare, 'log', '--oneline', '--all'], { encoding: 'utf8' })
  assert.match(log, /Lumen:/)
})

test('mail codes: info shows mail on; passwordless member login works', async () => {
  let res = await fetch(`${base}/api/info`)
  assert.equal((await res.json()).mail, true)

  await inviteMember('pw@example.com', 'Pw')
  const jar = new CookieJar()

  clearCapture()
  res = await api(jar, 'POST', '/api/login/code', { email: 'pw@example.com' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { sent: true })

  const code = lastCode('pw@example.com')
  assert.ok(code, 'a login code was emailed')

  res = await api(jar, 'POST', '/api/login/code/verify', { email: 'pw@example.com', code })
  assert.equal(res.status, 200)
  const user = (await res.json()).user
  assert.equal(user.role, 'member')

  res = await api(jar, 'GET', '/api/me')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).user.email, 'pw@example.com')
})

test('mail codes: five wrong tries kill a code', async () => {
  const jar = new CookieJar()
  clearCapture()
  let res = await api(jar, 'POST', '/api/login/code', { email: 'pw@example.com' })
  assert.equal(res.status, 200)
  const code = lastCode('pw@example.com')
  assert.ok(code, 'a login code was emailed')

  for (let i = 0; i < 5; i++) {
    res = await api(jar, 'POST', '/api/login/code/verify', { email: 'pw@example.com', code: '000000' })
    assert.equal(res.status, 400)
  }

  res = await api(jar, 'POST', '/api/login/code/verify', { email: 'pw@example.com', code })
  assert.equal(res.status, 400, 'code is dead after 5 wrong tries')
})

test('mail codes: unknown email says sent but sends nothing; admin has no login code', async () => {
  clearCapture()
  let res = await api(new CookieJar(), 'POST', '/api/login/code', { email: 'nobody@example.com' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { sent: true })
  assert.equal(captured().length, 0, 'no email for an unknown account')

  res = await api(new CookieJar(), 'POST', '/api/login/code', { email: 'admin@example.com' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { sent: true })
  assert.equal(captured().length, 0, 'no login code for an admin')
})

test('mail codes: admin two-step login', async () => {
  const jar = new CookieJar()
  clearCapture()
  let res = await api(jar, 'POST', '/api/login', { email: 'admin@example.com', password: 'password123' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.needsCode, true)
  assert.equal(body.email, 'ad…@example.com')
  assert.ok(body.challenge)

  res = await api(jar, 'GET', '/api/me')
  assert.equal(res.status, 401, 'no cookie until the code is verified')

  const code = lastCode('admin@example.com')
  assert.ok(code, 'an admin code was emailed')

  res = await api(jar, 'POST', '/api/login/verify', { challenge: body.challenge, code: '000000' })
  assert.equal(res.status, 400)

  res = await api(jar, 'POST', '/api/login/verify', { challenge: body.challenge, code })
  assert.equal(res.status, 200)
  const user = (await res.json()).user
  assert.equal(user.role, 'admin')

  res = await api(jar, 'GET', '/api/me')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).user.handle, admin.handle)
})

test('mail codes: forgot/reset ends sessions and sets a new password', async () => {
  const reset = await inviteMember('reset@example.com', 'Reset')
  const jar = new CookieJar()

  clearCapture()
  let res = await api(jar, 'POST', '/api/password/forgot', { email: 'reset@example.com' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { sent: true })

  const code = lastCode('reset@example.com')
  assert.ok(code, 'a reset code was emailed')

  res = await api(jar, 'POST', '/api/password/reset', { email: 'reset@example.com', code, password: 'newpassword1' })
  assert.equal(res.status, 200)
  const user = (await res.json()).user
  assert.equal(user.role, 'member')

  res = await api(reset.jar, 'GET', '/api/me')
  assert.equal(res.status, 401, 'old sessions are ended')

  res = await api(jar, 'GET', '/api/me')
  assert.equal(res.status, 200, 'reset signs the member in')

  res = await api(new CookieJar(), 'POST', '/api/login', { email: 'reset@example.com', password: 'newpassword1' })
  assert.equal(res.status, 200)
})

test('mail codes: invite with an email is emailed', async () => {
  clearCapture()
  const res = await api(adminJar, 'POST', '/api/admin/invites', { email: 'invited@example.com', role: 'member' })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.emailed, true)
  const mails = captured()
  assert.ok(mails.some((m) => m.to === 'invited@example.com' && /invited you to/.test(m.subject)))
})

test('mail codes: rate limit returns 429', async () => {
  await inviteMember('limited@example.com', 'Limited')
  let res
  for (let i = 0; i < 5; i++) {
    res = await api(new CookieJar(), 'POST', '/api/login/code', { email: 'limited@example.com' })
    assert.equal(res.status, 200)
  }
  res = await api(new CookieJar(), 'POST', '/api/login/code', { email: 'limited@example.com' })
  assert.equal(res.status, 429)
})

test('login: wrong password 401, then rate limited', async () => {
  let res = await api(new CookieJar(), 'POST', '/api/login', { email: 'admin@example.com', password: 'wrongpass' })
  assert.equal(res.status, 401)

  let last
  for (let i = 0; i < 10; i++) {
    last = await api(new CookieJar(), 'POST', '/api/login', { email: 'admin@example.com', password: 'wrongpass' })
  }
  assert.equal(last.status, 429)
})
