import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { checkToken } from './api.js'
import { githubRepo } from './repo.js'
import { gitBlob, runMirror } from '../mirror/run.js'
import { createStore } from '../store/records.js'
import { createUnits } from '../store/units.js'


// GitHub's REST API, as far as Lumen uses it, for one repository and these tokens
const TOKENS = { good: { push: true, pull: true }, readonly: { push: false, pull: true } }

function fakeGitHub({ empty = true } = {}) {
  const objects = new Map() // tree sha → Map path → text; commit sha → { tree, parent }
  const refs = new Map()
  let n = 0
  const id = (p) => `${p}${++n}`
  const reply = (status, body) => new Response(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body), { status })
  const commitFiles = (files, parent, branch = 'main') => {
    const tree = id('t')
    objects.set(tree, files)
    const c = id('c')
    objects.set(c, { tree, parent })
    refs.set(branch, c)
    return c
  }
  if (!empty) commitFiles(new Map([['README.md', '# hi\n']]), null)

  async function fetchImpl(url, { method = 'GET', headers = {}, body } = {}) {
    const u = new URL(url)
    const data = body ? JSON.parse(body) : null
    const p = u.pathname
    const token = headers.Authorization?.replace(/^Bearer /, '')
    if (token && !TOKENS[token]) return reply(401, { message: 'Bad credentials' })
    if (!token) return reply(404, { message: 'Not Found' })
    if (p === '/repositories/7' || p === '/repos/ada/data') return reply(200, { id: 7, full_name: 'ada/data', private: true, default_branch: 'main', permissions: TOKENS[token] })
    if (p.startsWith('/repos/') && !p.startsWith('/repos/ada/data/')) return reply(404, { message: 'Not Found' })
    const r = '/repos/ada/data'
    if (p === `${r}/git/refs` && method === 'GET') return refs.size ? reply(200, []) : reply(409, { message: 'Git Repository is empty.' })
    let m = /^\/repos\/ada\/data\/git\/ref\/heads\/(.+)$/.exec(p)
    if (m) return !refs.size ? reply(409, { message: 'Git Repository is empty.' }) : refs.has(m[1]) ? reply(200, { object: { sha: refs.get(m[1]) } }) : reply(404, { message: 'Not Found' })
    m = /^\/repos\/ada\/data\/git\/commits\/(.+)$/.exec(p)
    if (m && method === 'GET') return reply(200, { tree: { sha: objects.get(m[1]).tree } })
    m = /^\/repos\/ada\/data\/git\/trees\/(.+)$/.exec(p)
    if (m) return reply(200, { truncated: false, tree: [...objects.get(m[1])].map(([path, t]) => ({ path, type: 'blob', sha: gitBlob(t) })) })
    m = /^\/repos\/ada\/data\/contents\/(.+)$/.exec(p)
    if (m && method === 'PUT') {
      if (refs.size) return reply(422, { message: 'exists' })
      commitFiles(new Map([[decodeURIComponent(m[1]), Buffer.from(data.content, 'base64').toString('utf8')]]), null)
      return reply(201, {})
    }
    if (m) {
      const files = objects.get(objects.get(u.searchParams.get('ref')).tree)
      const t = files.get(decodeURIComponent(m[1]))
      return t == null ? reply(404, { message: 'Not Found' }) : reply(200, t)
    }
    if (p === `${r}/git/trees` && method === 'POST') {
      const files = new Map(data.base_tree ? objects.get(data.base_tree) : [])
      for (const e of data.tree) {
        if (e.sha === null) {
          if (!files.has(e.path)) return reply(422, { message: 'GitRPC::BadObjectState' })
          files.delete(e.path)
        } else files.set(e.path, e.content)
      }
      const tree = id('t')
      objects.set(tree, files)
      return reply(201, { sha: tree })
    }
    if (p === `${r}/git/commits` && method === 'POST') {
      const c = id('c')
      objects.set(c, { tree: data.tree, parent: data.parents[0] || null, message: data.message })
      return reply(201, { sha: c })
    }
    m = /^\/repos\/ada\/data\/git\/refs\/heads\/(.+)$/.exec(p)
    if (m && method === 'PATCH') {
      if (objects.get(data.sha).parent !== refs.get(m[1])) return reply(422, { message: 'Update is not a fast forward' })
      refs.set(m[1], data.sha)
      return reply(200, {})
    }
    if (p === `${r}/git/refs` && method === 'POST') {
      const b = data.ref.replace('refs/heads/', '')
      if (refs.has(b)) return reply(422, { message: 'Reference already exists' })
      refs.set(b, data.sha)
      return reply(201, {})
    }
    return reply(404, { message: `no route ${method} ${p}` })
  }
  return {
    fetchImpl,
    files: (b = 'main') => objects.get(objects.get(refs.get(b)).tree),
    // someone else pushing to the branch
    push(change, b = 'main') {
      const files = new Map(objects.get(objects.get(refs.get(b)).tree))
      for (const [k, v] of Object.entries(change)) files.set(k, v)
      commitFiles(files, refs.get(b), b)
    },
  }
}

test('a token is kept only if it can write to the repository', async () => {
  const { fetchImpl } = fakeGitHub()
  assert.deepEqual(await checkToken('ada/data', 'good', { fetchImpl }), { id: 7, fullName: 'ada/data', private: true, defaultBranch: 'main' })
  assert.deepEqual((await checkToken('https://github.com/ada/data.git', ' good ', { fetchImpl })).id, 7)
  await assert.rejects(checkToken('ada/data', 'readonly', { fetchImpl }), /not write/)
  assert.equal((await checkToken('ada/data', 'readonly', { fetchImpl, write: false })).id, 7)
  await assert.rejects(checkToken('ada/data', 'typo', { fetchImpl }), /didn’t accept that token/)
  await assert.rejects(checkToken('ada/other', 'good', { fetchImpl }), /can’t see the repository/)
  await assert.rejects(checkToken('not a repo', 'good', { fetchImpl }), /owner\/name/)
  await assert.rejects(checkToken('ada/data', '', { fetchImpl }), /Add a token/)
})

function world() {
  const store = createStore(new DatabaseSync(':memory:'))
  const people = { idOf: (h) => `u_${h}`, handleOf: (id) => id.replace(/^u_/, '') }
  const units = createUnits(store, people)
  const ctx = { store, units, app: { name: 'Lumen', version: 'test' }, source: { id: 'srv_test', label: 'test' }, clock: () => Date.now() }
  return { units, ctx }
}
const board = (cards) => `---\nid: b_launch00000\nname: Launch\nowner: ada\nkanban-plugin: board\n---\n\n## To do\n\n${cards}\n`

for (const empty of [true, false]) {
  test(`a mirror run writes to ${empty ? 'an empty' : 'an existing'} repository through the Git Data API`, async () => {
    const gh = fakeGitHub({ empty })
    const repo = githubRepo({ repoId: 7, token: async () => 'good', fetchImpl: gh.fetchImpl })
    const { units, ctx } = world()
    units.save('lists/launch.md', board('- [ ] Pricing 🆔 aaaaaa'))
    const conn = { owner: 'u_ada', ownerHandle: 'ada', admin: true, scope: 'workspace', branch: 'main', prefix: '', repoId: 7, allowPublic: false, cursor: 0, index: null }
    let r = await runMirror(ctx, conn, repo)
    Object.assign(conn, { cursor: r.cursor, index: r.index })
    assert.equal(gh.files().get('lists/launch.md'), units.render('lists/launch.md'))
    assert.ok(gh.files().has('.sync/manifest.json'))
    assert.equal(gh.files().has('README.md'), !empty)
    // files come back as their text, JSON or not
    const head = await repo.head('main')
    assert.equal(await repo.read('.sync/manifest.json', head.commit), gh.files().get('.sync/manifest.json'))
    assert.equal(await repo.read('nope.md', head.commit), null)
    // and a full pass over our own mirror reads its manifest without pausing
    r = await runMirror(ctx, conn, repo, { full: true })
    assert.equal(r.commit, null)

    // someone pushes between our read and our ref update: the run starts again
    units.save('lists/launch.md', board('- [x] Pricing 🆔 aaaaaa'))
    const orig = gh.fetchImpl
    let pushed = false
    const racing = async (url, opts) => {
      if (!pushed && opts?.method === 'POST' && url.endsWith('/git/commits')) {
        pushed = true
        gh.push({ 'notes.txt': 'meanwhile\n' })
      }
      return orig(url, opts)
    }
    r = await runMirror(ctx, conn, githubRepo({ repoId: 7, token: async () => 'good', fetchImpl: racing }))
    assert.match(gh.files().get('lists/launch.md'), /- \[x\] Pricing/)
    assert.equal(gh.files().get('notes.txt'), 'meanwhile\n')
  })
}
