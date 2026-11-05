import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from '../store/records.js'
import { createUnits } from '../store/units.js'
import { fakeRepo } from './fakeRepo.js'
import { Paused, parseIndex, runMirror } from './run.js'

function world() {
  const store = createStore(new DatabaseSync(':memory:'))
  const ids = { ada: 'u_ada', bob: 'u_bob' }
  const people = { idOf: (h) => ids[h] || `handle:${h}`, handleOf: (id) => Object.keys(ids).find((h) => ids[h] === id) || id.replace(/^handle:/, '') }
  let n = 0
  const units = createUnits(store, people, { makeId: (len) => String(++n).padStart(len, '0') })
  const ctx = { store, units, app: { name: 'Lumen', version: 'test' }, source: { id: 'srv_test', label: 'test' }, clock: () => Date.parse('2026-11-05T10:00:00Z') }
  return { store, units, ctx }
}

const board = (name, owner, cards) => `---\nid: b_${name.toLowerCase()}00000\nname: ${name}\nowner: ${owner}\nkanban-plugin: board\n---\n\n## To do\n\n${cards.join('\n')}\n`

// a connection as the worker keeps it between runs
function connect(conn) {
  const state = { owner: 'u_ada', ownerHandle: 'ada', admin: true, scope: 'workspace', branch: 'main', prefix: '', repoId: 7, allowPublic: false, cursor: 0, index: null, ...conn }
  return {
    state,
    async run(ctx, gh, opts) {
      const r = await runMirror(ctx, state, gh, opts)
      Object.assign(state, { cursor: r.cursor, index: r.index })
      return r
    },
  }
}

test('the first run writes every file, the index and the manifest', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  units.save('docs/plan.md', '---\nid: d_plan000001\ntitle: Plan\nowner: ada\n---\n\nHello.\n')
  const gh = fakeRepo()
  const c = connect()
  const r = await c.run(ctx, gh)
  assert.deepEqual(r.written.sort(), ['docs/plan.md', 'lists/launch.md'])
  const files = gh.files()
  assert.equal(files.get('lists/launch.md'), units.render('lists/launch.md'))
  const index = parseIndex(files.get('.sync/index.jsonl'))
  assert.deepEqual([...index.keys()], ['docs/plan.md', 'lists/launch.md'])
  assert.equal(index.get('lists/launch.md').id, 'b_launch00000')
  const manifest = JSON.parse(files.get('.sync/manifest.json'))
  assert.equal(manifest.profile, 'lumen/1')
  assert.equal(manifest.source.id, 'srv_test')
  assert.equal(manifest.counts.board, 1)
  assert.match(gh.lastMessage(), /^Sync: 2 files/)
  assert.match(gh.lastMessage(), /Sync-Cursor: 0\.\.\d+/)
})

test('a run with nothing new commits nothing', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  const gh = fakeRepo()
  const c = connect()
  await c.run(ctx, gh)
  const commits = gh.commitCount()
  const again = await c.run(ctx, gh)
  assert.equal(again.commit, null)
  const full = await c.run(ctx, gh, { full: true })
  assert.equal(full.commit, null)
  assert.equal(gh.commitCount(), commits)
})

test('ticking one card rewrites one file (plus .sync)', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  units.save('lists/home.md', board('Home', 'ada', ['- [ ] Milk 🆔 bbbbbb']))
  const gh = fakeRepo()
  const c = connect()
  await c.run(ctx, gh)
  units.save('lists/home.md', units.render('lists/home.md').replace('- [ ] Milk', '- [x] Milk'))
  const r = await c.run(ctx, gh)
  assert.deepEqual(r.written, ['lists/home.md'])
  assert.match(gh.files().get('lists/home.md'), /- \[x\] Milk/)
})

test('a file added by hand to the repository is never touched', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  const gh = fakeRepo()
  const c = connect()
  await c.run(ctx, gh)
  gh.push({ 'notes.txt': 'mine\n', 'README.md': '# My data\n' })
  units.save('lists/launch.md', units.render('lists/launch.md').replace('Pricing', 'Pricing page'))
  await c.run(ctx, gh)
  await c.run(ctx, gh, { full: true })
  assert.equal(gh.files().get('notes.txt'), 'mine\n')
  assert.equal(gh.files().get('README.md'), '# My data\n')
})

test('if the branch moves during a run, the run starts again from the new head', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  const gh = fakeRepo()
  const c = connect()
  await c.run(ctx, gh)
  units.save('lists/launch.md', units.render('lists/launch.md').replace('Pricing', 'Pricing page'))
  const commit = gh.commit
  let once = true
  gh.commit = async (args) => {
    if (once) {
      once = false
      gh.push({ 'notes.txt': 'pushed meanwhile\n' })
    }
    return commit(args)
  }
  await c.run(ctx, gh)
  assert.match(gh.files().get('lists/launch.md'), /Pricing page/)
  assert.equal(gh.files().get('notes.txt'), 'pushed meanwhile\n')
})

test('deleting a board removes its file; renaming moves it in one commit', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  units.save('lists/home.md', board('Home', 'ada', ['- [ ] Milk 🆔 bbbbbb']))
  const gh = fakeRepo()
  const c = connect()
  await c.run(ctx, gh)
  units.remove('lists/home.md')
  // a rename: the same board (same id) at a new path
  const text = units.render('lists/launch.md')
  units.remove('lists/launch.md')
  units.save('lists/big-launch.md', text)
  const r = await c.run(ctx, gh)
  assert.deepEqual(r.removed.sort(), ['lists/home.md', 'lists/launch.md'])
  assert.deepEqual(r.written, ['lists/big-launch.md'])
  assert.deepEqual([...gh.files().keys()].filter((p) => !p.startsWith('.sync/')), ['lists/big-launch.md'])
  assert.deepEqual([...parseIndex(gh.files().get('.sync/index.jsonl')).keys()], ['lists/big-launch.md'])
})

test('a person’s mirror holds what they own, not others’ files or chat', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  units.save('lists/bobs.md', board('Bobs', 'bob', ['- [ ] Secret 🆔 cccccc']))
  units.save('chat/general/2026-11.jsonl', '{"id":"m1","at":"2026-11-05T09:00:00.000Z","from":"ada","text":"hi"}\n')
  units.save('lumen.json', '{"name":"Home"}')
  const gh = fakeRepo()
  await connect({ owner: 'u_bob', ownerHandle: 'bob', admin: false, scope: 'owner' }).run(ctx, gh)
  assert.deepEqual([...gh.files().keys()].filter((p) => !p.startsWith('.sync/')), ['lists/bobs.md'])
  const gh2 = fakeRepo()
  await connect({ scope: 'owner' }).run(ctx, gh2)
  assert.deepEqual([...gh2.files().keys()].filter((p) => !p.startsWith('.sync/')).sort(), ['lists/launch.md', 'lumen.json'])
})

test('a public repository, another repository, or another server’s mirror pauses the connection', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  await assert.rejects(connect().run(ctx, fakeRepo({ isPrivate: false })), (e) => e instanceof Paused && /public/.test(e.message))
  await assert.rejects(connect({ repoId: 8 }).run(ctx, fakeRepo()), (e) => e instanceof Paused && /not the one/.test(e.message))
  const theirs = fakeRepo()
  theirs.push({ '.sync/manifest.json': JSON.stringify({ source: { id: 'srv_other' } }) })
  await assert.rejects(connect().run(ctx, theirs), (e) => e instanceof Paused && /another Lumen server/.test(e.message))
  // allowed public, and our own mirror again (a database restored from it), are fine
  await connect({ allowPublic: true }).run(ctx, fakeRepo({ isPrivate: false }))
})

test('an edit made on GitHub is reported, and the full pass puts the database’s version back', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  const gh = fakeRepo()
  const c = connect()
  await c.run(ctx, gh)
  gh.push({ 'lists/launch.md': 'edited on github\n' })
  const r = await c.run(ctx, gh, { full: true })
  assert.deepEqual(r.drift, ['lists/launch.md'])
  assert.equal(gh.files().get('lists/launch.md'), units.render('lists/launch.md'))
})

test('a mirror in a folder of a shared repository', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  const gh = fakeRepo()
  gh.push({ 'src/app.js': 'code\n' })
  await connect({ prefix: 'lumen' }).run(ctx, gh)
  assert.deepEqual([...gh.files().keys()].sort(), ['lumen/.sync/index.jsonl', 'lumen/.sync/manifest.json', 'lumen/lists/launch.md', 'src/app.js'])
})

test('a mirror written by a newer Lumen is left alone', async () => {
  const { units, ctx } = world()
  units.save('lists/launch.md', board('Launch', 'ada', ['- [ ] Pricing 🆔 aaaaaa']))
  const gh = fakeRepo()
  gh.push({ '.sync/manifest.json': JSON.stringify({ source: { id: 'srv_test' }, profile: 'lumen/2' }) })
  await assert.rejects(connect().run(ctx, gh), (e) => e instanceof Paused && /newer version/.test(e.message))
})
