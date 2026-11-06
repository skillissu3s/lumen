// Many people at once (docs/CANDLES.md, phase 6): three people, each with the
// app's own store in a process of their own (testPerson.js), editing a
// workspace board, a board shared from one person's candle, and a workspace
// doc at the same time; then losing access in the middle of editing.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, fork } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let base = ''
let server = null
const people = {}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })
}

async function call(cookie, method, url, body) {
  const res = await fetch(base + url, { method, headers: { cookie: cookie || '', 'content-type': 'application/json', 'x-lumen': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const set = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const json = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(json?.error || String(res.status)), { status: res.status })
  return { json, cookie: set }
}

// a person: their cookie, their account, and their app in a process of its own
async function person(name, cookie) {
  const me = (await call(cookie, 'GET', '/api/me')).json.user
  const child = fork(path.join(here, 'testPerson.js'), [], { env: { ...process.env, LUMEN_BASE: base, LUMEN_COOKIE: cookie, LUMEN_USER: JSON.stringify(me) }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const waiting = new Map()
  let n = 0
  await new Promise((resolve) => child.once('message', resolve))
  child.on('message', (m) => {
    const w = waiting.get(m.seq)
    if (!w) return
    waiting.delete(m.seq)
    m.ok ? w.resolve(m.value) : w.reject(new Error(m.error))
  })
  const send = (cmd, args = {}) =>
    new Promise((resolve, reject) => {
      const id = ++n
      // a command that never answers fails the test with its name, rather than hanging it
      const timer = setTimeout(() => waiting.has(id) && (waiting.delete(id), reject(new Error(`${name}: ${cmd} ${JSON.stringify(args)} didn’t answer`))), 20000)
      waiting.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      child.send({ seq: id, cmd, args })
    })
  return { name, cookie, me, child, send }
}

async function until(fn, what, ms = 15000) {
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
    last = await fn().catch((e) => e)
    if (last === true) return
    await sleep(150)
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`)
}

const PLAN = 'workspaces/crew/lists/plan.md'
const NOTES = 'workspaces/crew/docs/notes.md'
const ours = (p) => (p.name === 'ada' ? 'lists/ours.md' : 'shared/ada/lists/ours.md')
const read = async (cookie, p) => (await call(cookie, 'POST', '/api/files/read', { paths: [p] })).json.files[p]
const count = (text, needle) => text.split(needle).length - 1

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-multi-'))
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(here, 'index.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, MAIL_LOG_CODES: '', SMTP_URL: '', SMTP_HOST: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break
    } catch {
      /* not up yet */
    }
    await sleep(100)
  }
  const ada = (await call('', 'POST', '/api/setup', { email: 'ada@example.com', name: 'Ada', password: 'password123' })).cookie
  const join = async (who) => {
    const inv = (await call(ada, 'POST', '/api/admin/invites', { role: 'member' })).json
    return (await call('', 'POST', `/api/invites/${inv.url.split('/invite/')[1]}/accept`, { name: who, email: `${who.toLowerCase()}@example.com`, password: 'password123' })).cookie
  }
  const bob = await join('Bob')
  const carol = await join('Carol')
  // a workspace for the three of them
  const ws = (await call(ada, 'POST', '/api/spaces', { name: 'Crew' })).json.space
  const link = (await call(ada, 'POST', `/api/spaces/${ws.id}/invites`, {})).json.token
  await call(bob, 'POST', `/api/join/${link}`)
  await call(carol, 'POST', `/api/join/${link}`)
  // a board in it, a board Ada shares from her candle with both, and a doc
  await call(ada, 'PUT', '/api/files', { path: PLAN, text: '---\nname: Plan\n---\n\n- [ ] one 🆔 t1\n- [ ] two 🆔 t2\n- [ ] three 🆔 t3\n', sha: null })
  await call(ada, 'PUT', '/api/files', { path: 'lists/ours.md', text: '---\nname: Ours\nshare: [bob, carol]\n---\n\n- [ ] milk 🆔 o1\n- [ ] eggs 🆔 o2\n- [ ] tea 🆔 o3\n', sha: null })
  await call(ada, 'PUT', '/api/files', { path: NOTES, text: '---\ntitle: Notes\n---\n\nStart here.\n', sha: null })
  people.ada = await person('ada', ada)
  people.bob = await person('bob', bob)
  people.carol = await person('carol', carol)
  people.crew = ws
  for (const p of [people.ada, people.bob, people.carol]) assert.equal(await p.send('load'), 'ready')
})

after(() => {
  for (const p of [people.ada, people.bob, people.carol]) p?.child.kill()
  server?.kill()
})

test('three people editing the same board, shared board and doc at once: every edit lands once, and everyone ends up with the same', async () => {
  const all = [people.ada, people.bob, people.carol]
  // everything at once: no one waits for anyone
  await Promise.all(
    all.flatMap((p, k) => [
      ...[1, 2, 3, 4, 5].map((i) => p.send('add', { path: PLAN, title: `${p.name} plan ${i}` })),
      ...[1, 2, 3].map((i) => p.send('add', { path: ours(p), title: `${p.name} buys ${i}` })),
      p.send('tick', { path: PLAN, id: `t${k + 1}` }),
      p.send('tick', { path: ours(p), id: `o${k + 1}` }),
      ...[1, 2, 3].map((i) => p.send('type', { path: NOTES, line: `${p.name} note ${i}` })),
    ]),
  )
  await Promise.all(all.map((p) => p.send('flush')))

  // the server has each edit exactly once
  await until(async () => {
    const states = await Promise.all(all.map((p) => p.send('state', { paths: [PLAN, ours(p), NOTES] })))
    return states.every((s) => s.pending === 0)
  }, 'everyone to finish saving')
  const plan = (await read(people.ada.cookie, PLAN)).text
  const shared = (await read(people.ada.cookie, 'lists/ours.md')).text
  const notes = (await read(people.ada.cookie, NOTES)).text
  for (const p of all) {
    for (const i of [1, 2, 3, 4, 5]) assert.equal(count(plan, `${p.name} plan ${i}`), 1, `${p.name} plan ${i}`)
    for (const i of [1, 2, 3]) assert.equal(count(shared, `${p.name} buys ${i}`), 1, `${p.name} buys ${i}`)
    for (const i of [1, 2, 3]) assert.equal(count(notes, `${p.name} note ${i}`), 1, `${p.name} note ${i}`)
  }
  for (const id of ['t1', 't2', 't3']) assert.match(plan, new RegExp(`- \\[x\\] [a-z]+ .*🆔 ${id}`))
  for (const id of ['o1', 'o2', 'o3']) assert.match(shared, new RegExp(`- \\[x\\] [a-z]+ .*🆔 ${id}`))
  assert.equal(count(notes, 'Start here.'), 1)

  // and everyone's app shows exactly what the server has
  await until(async () => {
    const states = await Promise.all(all.map((p) => p.send('state', { paths: [PLAN, ours(p), NOTES] })))
    return states.every((s, k) => s.files[PLAN] === plan && s.files[ours(all[k])] === shared && s.files[NOTES] === notes)
  }, 'everyone to see the same')
  for (const p of all) assert.deepEqual((await p.send('state', { paths: [] })).problems, [], `${p.name} saw no problems`)
})

test('lowered to view: an edit is refused, said so, and the owner’s version stays', async () => {
  const { ada, bob } = people
  const before = await read(ada.cookie, 'lists/ours.md')
  await call(ada.cookie, 'PUT', '/api/files', { path: 'lists/ours.md', text: before.text.replace('share: [bob, carol]', 'share: [bob:view, carol]'), sha: before.sha })
  const at = 'shared/ada/lists/ours.md'
  await until(async () => /bob:view/.test((await bob.send('state', { paths: [at] })).files[at]), 'Bob to see the change')
  await bob.send('add', { path: at, title: 'bob sneaks in' })
  await bob.send('flush')
  await until(async () => {
    const s = await bob.send('state', { paths: [at] })
    return s.pending === 0 && s.problems.includes('You can view this, not change it.') && !s.files[at].includes('bob sneaks in')
  }, 'Bob’s edit to be refused and undone')
  assert.ok(!(await read(ada.cookie, 'lists/ours.md')).text.includes('bob sneaks in'))
})

test('a share taken back while an edit is on its way: the edit goes nowhere, and the board goes from the app', async () => {
  const { ada, carol } = people
  const at = 'shared/ada/lists/ours.md'
  // Carol's edit is queued (writes wait a moment) when Ada stops sharing with her
  await carol.send('add', { path: at, title: 'carol too late' })
  const cur = await read(ada.cookie, 'lists/ours.md')
  await call(ada.cookie, 'PUT', '/api/files', { path: 'lists/ours.md', text: cur.text.replace('share: [bob:view, carol]', 'share: [bob:view]'), sha: cur.sha })
  await carol.send('flush')
  await until(async () => {
    const s = await carol.send('state', { paths: [at] })
    return s.pending === 0 && !s.has[at]
  }, 'Carol’s copy of the board to go')
  assert.ok(!(await read(ada.cookie, 'lists/ours.md')).text.includes('carol too late'))
  assert.ok((await carol.send('state', { paths: [] })).problems.includes('You no longer have access to this, so your change wasn’t saved.'))
})

test('removed from a workspace while an edit is on its way: the edit goes nowhere, and the workspace goes from the app', async () => {
  const { ada, bob } = people
  await bob.send('add', { path: PLAN, title: 'bob after leaving' })
  await call(ada.cookie, 'DELETE', `/api/spaces/${people.crew.id}/members/${bob.me.id}`)
  await bob.send('flush')
  await until(async () => {
    const s = await bob.send('state', { paths: [PLAN, NOTES] })
    return s.pending === 0 && !s.has[PLAN] && !s.has[NOTES]
  }, 'the workspace to go from Bob’s app')
  assert.ok(!(await read(ada.cookie, PLAN)).text.includes('bob after leaving'))
  assert.ok((await bob.send('state', { paths: [] })).problems.includes('You no longer have access to this, so your change wasn’t saved.'))
})
