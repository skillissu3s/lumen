// End to end: a Lumen server ("the cloud") and a desktop app's embedded server,
// each in its own process with its own data, kept in step by sync/replica.js.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

async function up(url) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${url}/api/info`)).ok) return
    } catch {
      /* not yet */
    }
    await sleep(100)
  }
  throw new Error(`${url} didn't start`)
}

// the cloud: a plain Lumen server
let cloud = { url: '', dir: '', child: null, cookie: '' }
function startCloud() {
  cloud.child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(cloud.port), HOST: '127.0.0.1', DATA_DIR: cloud.dir, LUMEN_DESKTOP: '', MAIL_LOG_CODES: '' },
    stdio: 'ignore',
  })
  return up(cloud.url)
}

// the desktop app's server, which prints the local session token once it's up
let desk = { url: '', dir: '', child: null, cookie: '' }
function startDesk() {
  const code = `const server = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server', 'index.js')).href)})
await server.listening
const { desktopSessionToken } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server', 'desktop.js')).href)})
console.log('TOKEN ' + desktopSessionToken())`
  desk.child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], {
    env: { ...process.env, PORT: String(desk.port), HOST: '127.0.0.1', DATA_DIR: desk.dir, WORKSPACE_DIR: path.join(desk.dir, 'workspace'), LUMEN_DESKTOP: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve, reject) => {
    let out = ''
    desk.child.stdout.on('data', (d) => {
      out += d
      const m = /TOKEN (\S+)/.exec(out)
      if (m) {
        desk.cookie = `lumen_session=${m[1]}`
        resolve()
      }
    })
    desk.child.on('exit', () => reject(new Error('the desktop server stopped')))
  })
}

async function api(side, method, url, body) {
  const res = await fetch(side.url + url, {
    method,
    headers: { 'X-Lumen': '1', ...(side.cookie ? { cookie: side.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const c = /lumen_session=[^;]+/.exec(res.headers.get('set-cookie') || '')
  if (c) side.cookie = c[0]
  const json = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(json?.error || res.status), { status: res.status })
  return json
}

const paths = async (side) => (await api(side, 'GET', '/api/files')).files.map((f) => f.path).sort()
const read = async (side, p) => (await api(side, 'POST', '/api/files/read', { paths: [p] })).files[p]
const syncNow = () => api(desk, 'POST', '/api/desktop/cloud/sync')

async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${what}`)
}

before(async () => {
  cloud.port = await freePort()
  cloud.url = `http://127.0.0.1:${cloud.port}`
  cloud.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-cloud-'))
  desk.port = await freePort()
  desk.url = `http://127.0.0.1:${desk.port}`
  desk.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-desk-'))
  await startCloud()
  await api(cloud, 'POST', '/api/setup', { email: 'ada@example.com', name: 'Ada', password: 'correct horse battery' })
  await startDesk()
})

after(() => {
  cloud.child?.kill()
  desk.child?.kill()
})

test('a fresh desktop app signs in and takes the account’s data', async () => {
  assert.equal((await api(desk, 'GET', '/api/info')).desktopChoice, true)
  await assert.rejects(api(desk, 'POST', '/api/desktop/cloud/login', { server: cloud.url, email: 'ada@example.com', password: 'wrong password' }), /match an account/)
  const r = await api(desk, 'POST', '/api/desktop/cloud/login', { server: cloud.url, email: 'ada@example.com', password: 'correct horse battery' })
  assert.equal(r.user.handle, 'ada')
  assert.equal(r.hasOwnData, false)
  const linked = await api(desk, 'POST', '/api/desktop/cloud/link', { keep: 'server' })
  assert.equal(linked.linked, true)
  assert.equal(linked.state, 'idle')
  assert.deepEqual(await paths(desk), await paths(cloud))
  const info = await api(desk, 'GET', '/api/info')
  assert.equal(info.desktopChoice, undefined)
  assert.equal(info.user.handle, 'ada')
})

test('a board made on the desktop reaches the server by itself', async () => {
  await api(desk, 'PUT', '/api/files', { path: 'lists/desk.md', text: '---\nname: From the desk\nowner: ada\n---\n- [ ] Made offline-capable\n', sha: null })
  await until(async () => (await paths(cloud)).includes('lists/desk.md'), 'the board on the server')
  assert.match((await read(cloud, 'lists/desk.md')).text, /Made offline-capable/)
})

test('a change on the server reaches the desktop', async () => {
  await api(cloud, 'PUT', '/api/files', { path: 'lists/cloud.md', text: '---\nname: From the cloud\nowner: ada\n---\n- [ ] Typed in a browser\n', sha: null })
  await syncNow()
  assert.match((await read(desk, 'lists/cloud.md')).text, /Typed in a browser/)
})

test('the same board changed in both places keeps both changes', async () => {
  const d = await read(desk, 'lists/desk.md')
  const c = await read(cloud, 'lists/desk.md')
  await api(desk, 'PUT', '/api/files', { path: 'lists/desk.md', text: d.text.replace('- [ ] Made offline-capable', '- [x] Made offline-capable'), sha: d.sha })
  // (a new card under the existing one, as the app adds it)
  await api(cloud, 'PUT', '/api/files', { path: 'lists/desk.md', text: c.text.replace(/(- \[ \] Made offline-capable.*\n)/, '$1- [ ] Added on the web\n'), sha: c.sha })
  await syncNow()
  await syncNow()
  for (const side of [desk, cloud]) {
    const text = (await read(side, 'lists/desk.md')).text
    assert.match(text, /- \[x\] Made offline-capable/)
    assert.match(text, /Added on the web/)
  }
})

test('offline: changes wait on the desktop and go when the server is back', async () => {
  cloud.child.kill()
  await sleep(300)
  await api(desk, 'PUT', '/api/files', { path: 'lists/offline.md', text: '---\nname: Offline\nowner: ada\n---\n- [ ] Written on a plane\n', sha: null })
  const st = await syncNow()
  assert.equal(st.state, 'offline')
  await startCloud()
  await api(cloud, 'POST', '/api/login', { email: 'ada@example.com', password: 'correct horse battery' })
  await until(async () => (await syncNow()).state === 'idle' && (await paths(cloud)).includes('lists/offline.md'), 'the offline board on the server')
  assert.match((await read(cloud, 'lists/offline.md')).text, /Written on a plane/)
})

test('deleting on one side deletes on the other', async () => {
  const d = await read(desk, 'lists/cloud.md')
  await api(desk, 'DELETE', '/api/files', { path: 'lists/cloud.md', sha: d.sha })
  await syncNow()
  assert.ok(!(await paths(cloud)).includes('lists/cloud.md'))
})

test('signing out leaves this computer its copy', async () => {
  const before = await paths(desk)
  const st = await api(desk, 'POST', '/api/desktop/cloud/logout')
  assert.equal(st.linked, false)
  assert.deepEqual(await paths(desk), before)
})
