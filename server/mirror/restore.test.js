import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../store/records.js'
import { createUnits } from '../store/units.js'
import { fakeRepo } from './fakeRepo.js'
import { Paused, runMirror } from './run.js'
import { countKinds, planRestore, readMirror } from './restore.js'

function server(id) {
  const store = createStore(new DatabaseSync(':memory:'))
  const people = { idOf: (h) => `u_${h}`, handleOf: (x) => x.replace(/^u_/, '') }
  const units = createUnits(store, people)
  return { store, units, ctx: { store, units, app: { name: 'Lumen', version: 'test' }, source: { id, label: id }, clock: () => Date.now() } }
}
const conn = (extra) => ({ owner: 'u_ada', ownerHandle: 'ada', admin: true, scope: 'workspace', branch: 'main', prefix: '', repoId: 7, allowPublic: false, cursor: 0, index: null, ...extra })
const board = (name, cards) => `---\nid: b_${name.toLowerCase()}00000\nname: ${name}\nowner: ada\nkanban-plugin: board\n---\n\n## To do\n\n${cards}\n`

async function mirrored() {
  const a = server('srv_a')
  a.units.save('lists/launch.md', board('Launch', '- [ ] Pricing 🆔 aaaaaa'))
  a.units.save('docs/plan.md', '---\nid: d_plan000001\ntitle: Plan\nowner: ada\n---\n\nHello.\n')
  a.units.save('lumen.json', '{"name":"Home"}')
  const gh = fakeRepo()
  const r = await runMirror(a.ctx, conn(), gh)
  return { a, gh, r }
}

test('a mirror restores into an empty database as it was', async () => {
  const { a, gh } = await mirrored()
  gh.push({ 'notes.txt': 'mine\n' })
  const b = server('srv_b')
  const m = await readMirror(gh, { branch: 'main', keep: (p) => !p.endsWith('.txt') })
  assert.equal(m.legacy, false)
  assert.deepEqual(m.skipped, [])
  const plan = planRestore(m.files, { units: b.units, store: b.store })
  assert.equal(plan.take.length, 3)
  for (const [p, text] of plan.take) b.units.save(p, text)
  for (const p of a.units.paths()) assert.equal(b.units.render(p), a.units.render(p))
  assert.deepEqual(countKinds(plan.take.map(([p]) => p), b.units), { board: 1, doc: 1, workspace: 1 })

  // the new server may not write to the old one's mirror, unless it takes it over;
  // then the first run finds nothing to change
  await assert.rejects(runMirror(b.ctx, conn(), gh), Paused)
  const before = gh.commitCount()
  const r = await runMirror(b.ctx, conn({ adopt: true }), gh)
  assert.deepEqual([r.written, r.removed], [[], []])
  // only .sync changed (the manifest names the new server)
  assert.equal(gh.commitCount(), before + 1)
  assert.equal(JSON.parse(gh.files().get('.sync/manifest.json')).source.id, 'srv_b')
})

test('into a database with data: nothing is deleted, and changes made here are kept', async () => {
  const { a, gh, r } = await mirrored()
  // after the mirror: the board changes here, the doc is edited on GitHub
  a.units.save('lists/launch.md', board('Launch', '- [x] Pricing 🆔 aaaaaa'))
  a.units.save('lists/home.md', board('Home', '- [ ] Milk 🆔 bbbbbb'))
  gh.push({ 'docs/plan.md': '---\nid: d_plan000001\ntitle: Plan\nowner: ada\n---\n\nHello from GitHub.\n' })
  const m = await readMirror(gh, { branch: 'main' })
  const since = JSON.parse(gh.files().get('.sync/manifest.json')).cursor
  const plan = planRestore(m.files, { units: a.units, store: a.store, since })
  assert.deepEqual(plan.take.map(([p]) => p), ['docs/plan.md'])
  assert.deepEqual(plan.kept, ['lists/launch.md'])
  assert.deepEqual(plan.same, ['lumen.json'])
  assert.equal(planRestore(m.files, { units: a.units, store: a.store, since, repoWins: true }).take.length, 2)
  // from another database nothing tells what changed here, so both are kept
  assert.deepEqual(planRestore(m.files, { units: a.units, store: a.store }).kept, ['docs/plan.md', 'lists/launch.md'])
  assert.equal(r.index.size, 3)
})

test('a repository from before the protocol is read whole, as legacy', async () => {
  const gh = fakeRepo()
  gh.push({ 'lists/launch.md': board('Launch', '- [ ] Pricing'), 'README.md': '# x\n', 'photo.png': 'binary' })
  const m = await readMirror(gh, { branch: 'main', keep: (p) => /\.(md|json)$/.test(p) })
  assert.equal(m.legacy, true)
  assert.deepEqual(m.files.map(([p]) => p).sort(), ['README.md', 'lists/launch.md'])
})

test('a mirror of another app, or from a newer Lumen, is refused', async () => {
  const other = fakeRepo()
  other.push({ '.sync/manifest.json': JSON.stringify({ protocol: 'repo-sync/0.1', profile: 'notes/1' }) })
  await assert.rejects(readMirror(other, { branch: 'main' }), /another app/)
  const newer = fakeRepo()
  newer.push({ '.sync/manifest.json': JSON.stringify({ protocol: 'repo-sync/0.1', profile: 'lumen/2' }) })
  await assert.rejects(readMirror(newer, { branch: 'main' }), /newer version/)
  await assert.rejects(readMirror(fakeRepo(), { branch: 'main' }), /nothing in it/)
})
