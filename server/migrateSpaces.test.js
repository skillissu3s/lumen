// The one-time move to spaces, end to end: a database from before spaces (one
// workspace, files private to their owner or shared), then the new server on it.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-migrate-'))
let base = ''
let child = null

// written with today's store and units, all rows outside any space, as before spaces
const fixture = `
import { db } from './db.js'
import { createUser } from './auth.js'
import { createStore } from './store/records.js'
import { createUnits } from './store/units.js'
const admin = await createUser({ email: 'admin@example.com', name: 'Ada', password: 'password123', role: 'admin' })
const bob = await createUser({ email: 'bob@example.com', name: 'Bob', password: 'password123', role: 'member' })
const store = createStore(db)
const people = {
  idOf: (h) => db.prepare('SELECT id FROM users WHERE handle = ?').get(h)?.id ?? 'handle:' + h,
  handleOf: (id) => db.prepare('SELECT handle FROM users WHERE id = ?').get(id)?.handle ?? id,
}
const u = createUnits(store, people)
u.save('lumen.json', JSON.stringify({ version: 1, name: 'Old Team', inbox: 'inbox', plugins: { focus: { enabled: true } } }))
u.save('lists/mine.md', '---\\nname: Mine\\nowner: ada\\n---\\n\\n- [ ] only Ada\\n')
u.save('lists/team.md', '---\\nname: Team\\nowner: ada\\nshare: everyone\\n---\\n\\n- [ ] for all\\n')
u.save('lists/pair.md', '---\\nname: Pair\\nowner: ada\\nshare: [bob]\\n---\\n\\n- [ ] Ada and Bob\\n')
u.save('docs/notes.md', '---\\ntitle: Notes\\nowner: bob\\n---\\n\\nBob only.\\n')
u.save('plugins/focus/manifest.json', '{"id":"focus"}')
u.save('users/bob/settings.json', '{"theme":"dark"}')
u.save('chat/channels.json', JSON.stringify([{ id: 'general', name: 'general', members: 'everyone' }, { id: 'dm-ada-bob', dm: true, members: ['ada', 'bob'] }]))
u.save('chat/general/2026-11.jsonl', '{"id":"m1","at":"2026-11-01T10:00:00.000Z","from":"ada","text":"hello"}\\n')
u.save('chat/dm-ada-bob/2026-11.jsonl', '{"id":"d1","at":"2026-11-01T11:00:00.000Z","from":"bob","text":"just us"}\\n')
`

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })
}

async function start() {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, MAIL_LOG_CODES: '', SMTP_URL: '', SMTP_HOST: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('server did not start')
}
const stop = () => new Promise((resolve) => (child.once('exit', resolve), child.kill()))

async function signIn(email) {
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lumen': '1' }, body: JSON.stringify({ email, password: 'password123' }) })
  assert.equal(res.status, 200)
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}
const get = async (cookie, url) => (await fetch(base + url, { headers: { cookie } })).json()
const read = async (cookie, p) => (await (await fetch(`${base}/api/files/read`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-lumen': '1' }, body: JSON.stringify({ paths: [p] }) })).json()).files[p]

before(async () => {
  const script = path.join(here, `.fixture-${process.pid}.mjs`)
  fs.writeFileSync(script, fixture)
  try {
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', script], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'inherit' })
  } finally {
    fs.rmSync(script, { force: true })
  }
  await start()
})

after(async () => {
  await stop()
})

test('private things move to their owner’s candle; shared ones stay in the workspace, for its members', async () => {
  const ada = await signIn('admin@example.com')
  const bob = await signIn('bob@example.com')
  const { spaces } = await get(ada, '/api/spaces')
  const ws = spaces.find((s) => s.kind === 'workspace')
  assert.equal(ws.name, 'Old Team')
  assert.equal(ws.role, 'owner')
  const w = ws.prefix

  const adaFiles = (await get(ada, '/api/files')).files.map((f) => f.path)
  const bobFiles = (await get(bob, '/api/files')).files.map((f) => f.path)

  // Ada's private list is in her candle; Bob never sees it
  assert.ok(adaFiles.includes('lists/mine.md'))
  assert.ok(!bobFiles.some((p) => p.endsWith('lists/mine.md')))
  // Bob's private doc and settings are in his candle
  assert.ok(bobFiles.includes('docs/notes.md'))
  assert.ok(bobFiles.includes('users/bob/settings.json'))
  assert.ok(!adaFiles.some((p) => p.endsWith('docs/notes.md')))

  // what was shared stays in the workspace, for everyone in it, without its old list
  for (const name of ['team', 'pair']) {
    assert.ok(adaFiles.includes(`${w}lists/${name}.md`))
    assert.ok(bobFiles.includes(`${w}lists/${name}.md`))
    assert.doesNotMatch((await read(bob, `${w}lists/${name}.md`)).text, /share:/)
  }

  // plugins: installed in each candle now, not in the workspace
  for (const files of [adaFiles, bobFiles]) assert.ok(files.includes('plugins/focus/manifest.json'))
  assert.ok(!adaFiles.includes(`${w}plugins/focus/manifest.json`))
  assert.deepEqual(JSON.parse((await read(bob, 'lumen.json')).text).plugins, { focus: { enabled: true } })
  assert.deepEqual(Object.keys(JSON.parse((await read(ada, `${w}lumen.json`)).text).plugins || {}), [])

  // each candle got an inbox and a calendar of its own; the workspace keeps (or gets) one
  for (const files of [adaFiles, bobFiles]) assert.ok(files.includes('lists/inbox.md') && files.includes('calendars/personal.md'))
  assert.ok(adaFiles.includes(`${w}lists/inbox.md`))

  // chat stayed with the workspace
  const channels = await get(bob, `/api/chat/channels?space=${ws.id}`)
  assert.ok(channels.channels.some((c) => c.id === 'general'))
  const messages = await get(bob, `/api/chat/messages?space=${ws.id}&channel=general`)
  assert.ok(messages.messages.some((m) => m.text === 'hello'))

  // direct messages moved out of the workspace, to their own place
  assert.ok(!channels.channels.some((c) => c.dm && c.space !== 'dm'))
  const dm = channels.channels.find((c) => c.dm)
  assert.equal(dm.space, 'dm')
  const said = await get(ada, `/api/chat/messages?space=dm&channel=${dm.id}`)
  assert.deepEqual(said.messages.map((m) => m.text), ['just us'])
})

test('a second start changes nothing', async () => {
  const ada = await signIn('admin@example.com')
  const byPath = (a, b) => (a.path < b.path ? -1 : 1)
  const first = (await get(ada, '/api/files')).files.sort(byPath)
  await stop()
  await start()
  const again = await signIn('admin@example.com')
  assert.deepEqual((await get(again, '/api/files')).files.sort(byPath), first)
})
