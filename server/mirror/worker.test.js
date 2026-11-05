import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../store/records.js'
import { createUnits } from '../store/units.js'
import { fakeRepo } from './fakeRepo.js'
import { createWorker } from './worker.js'

const MIN = 60000
const board = (cards) => `---\nid: b_launch00000\nname: Launch\nowner: ada\nkanban-plugin: board\n---\n\n## To do\n\n${cards}\n`

function world() {
  const db = new DatabaseSync(':memory:')
  const store = createStore(db)
  const people = { idOf: (h) => `u_${h}`, handleOf: (id) => id.replace(/^u_/, '') }
  const units = createUnits(store, people)
  const events = new EventEmitter()
  let now = Date.parse('2026-11-05T10:00:00Z')
  const clock = () => now
  const gh = fakeRepo()
  let repo = gh
  const worker = createWorker(
    { db, store, units, events, clock, users: { get: (id) => ({ handle: id.slice(2), role: 'admin' }) }, source: { id: 'srv_test', label: 'test' }, app: { name: 'Lumen', version: 'test' } },
    () => repo,
  )
  const save = (text) => {
    units.save('lists/launch.md', text)
    events.emit('change', [{ path: 'lists/launch.md', deleted: false }])
  }
  return { worker, gh, units, save, later: (ms) => (now += ms), now: () => now, use: (r) => (repo = r) }
}

const connect = (worker, mode, schedule) =>
  worker.create('u_ada', { installationId: 41, repo: { id: 7, fullName: 'ada/data' }, branch: 'main', prefix: '', scope: 'owner', mode, schedule })

test('a new connection runs on the next tick and keeps its place', async () => {
  const w = world()
  w.save(board('- [ ] Pricing 🆔 aaaaaa'))
  const c = connect(w.worker, 'manual', null)
  await w.worker.tick()
  const after = w.worker.get(c.id)
  assert.ok(after.last_commit)
  assert.ok(after.cursor > 0)
  assert.equal(after.next_run_at, null)
  assert.ok(w.gh.files().has('lists/launch.md'))
  assert.equal(w.worker.runs(c.id)[0].written, 1)
})

test('after changes: waits for a quiet spell, then runs once', async (t) => {
  const w = world()
  w.worker.start()
  t.after(() => w.worker.stop())
  w.save(board('- [ ] Pricing 🆔 aaaaaa'))
  const c = connect(w.worker, 'after-changes', { quiet: 10, max: 60 })
  await w.worker.tick()
  const commits = w.gh.commitCount()
  w.save(board('- [x] Pricing 🆔 aaaaaa'))
  assert.equal(w.worker.get(c.id).next_run_at, w.now() + 10 * MIN)
  w.later(5 * MIN)
  await w.worker.tick()
  assert.equal(w.gh.commitCount(), commits)
  w.later(6 * MIN)
  await w.worker.tick()
  assert.equal(w.gh.commitCount(), commits + 1)
  assert.equal(w.worker.get(c.id).next_run_at, null)
})

test('daily: the next run is tomorrow’s slot', async () => {
  const w = world()
  w.save(board('- [ ] Pricing 🆔 aaaaaa'))
  const c = connect(w.worker, 'daily', { at: '03:00', tz: 'UTC' })
  await w.worker.tick()
  const next = w.worker.get(c.id).next_run_at
  assert.ok(next >= Date.parse('2026-11-06T03:00:00Z') && next < Date.parse('2026-11-06T03:02:00Z'))
})

test('a failed run backs off; GitHub losing the repository pauses it until resumed', async () => {
  const w = world()
  w.save(board('- [ ] Pricing 🆔 aaaaaa'))
  const c = connect(w.worker, 'manual', null)
  const broken = (status) => ({ ...w.gh, repo: async () => Promise.reject(Object.assign(new Error(`GitHub answered ${status}.`), { status })) })
  w.use(broken(502))
  await w.worker.tick()
  let after = w.worker.get(c.id)
  assert.equal(after.failures, 1)
  assert.equal(after.next_run_at, w.now() + MIN)
  assert.match(after.last_error, /502/)
  w.use(broken(404))
  w.later(MIN)
  await w.worker.tick()
  after = w.worker.get(c.id)
  assert.match(after.paused, /can no longer reach/)
  assert.equal(after.next_run_at, null)
  w.use(w.gh)
  w.worker.update(c.id, { resume: true })
  await w.worker.tick()
  after = w.worker.get(c.id)
  assert.equal(after.paused, null)
  assert.equal(after.failures, 0)
  assert.ok(after.last_commit)
})

test('a new branch starts the mirror afresh there', async () => {
  const w = world()
  w.save(board('- [ ] Pricing 🆔 aaaaaa'))
  const c = connect(w.worker, 'manual', null)
  await w.worker.tick()
  w.worker.update(c.id, { branch: 'lumen' })
  await w.worker.tick()
  assert.ok(w.gh.files('lumen').has('lists/launch.md'))
})

test('two runs of one connection at once are one run', async () => {
  const w = world()
  w.save(board('- [ ] Pricing 🆔 aaaaaa'))
  const c = connect(w.worker, 'manual', null)
  const [a, b] = await Promise.all([w.worker.run(c.id), w.worker.run(c.id)])
  assert.equal(a.last_commit, b.last_commit)
  assert.equal(w.worker.runs(c.id).length, 1)
})
