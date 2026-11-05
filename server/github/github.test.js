import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { appConfig, appJwt, createGitHubApp } from './app.js'
import { githubRepo } from './repo.js'
import { gitBlob, runMirror } from '../mirror/run.js'
import { createStore } from '../store/records.js'
import { createUnits } from '../store/units.js'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' })

// GitHub, as far as the App and the Git Data API go, for one repository
function fakeGitHub({ empty = true } = {}) {
  const calls = []
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
    calls.push({ method, path: u.pathname + u.search, auth: headers.Authorization, body: data })
    const p = u.pathname
    if (u.host === 'github.com' && p === '/login/oauth/access_token') return reply(200, data.code === 'good' ? { access_token: 'user-token' } : { error: 'bad_verification_code' })
    if (p === '/user/installations') return reply(200, { installations: [{ id: 41 }] })
    if (p === '/user/installations/41/repositories') return reply(200, { repositories: [{ id: 7, full_name: 'ada/data', private: true, default_branch: 'main' }] })
    if (p === '/applications/client-1/token') return reply(204)
    if (p === '/app/installations/41/access_tokens') return reply(201, { token: `inst-${n++}`, expires_at: new Date(Date.now() + 3600000).toISOString() })
    if (p === '/repositories/7') return reply(200, { id: 7, full_name: 'ada/data', private: true, default_branch: 'main' })
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
    calls,
    files: (b = 'main') => objects.get(objects.get(refs.get(b)).tree),
    // someone else pushing to the branch
    push(change, b = 'main') {
      const files = new Map(objects.get(objects.get(refs.get(b)).tree))
      for (const [k, v] of Object.entries(change)) files.set(k, v)
      commitFiles(files, refs.get(b), b)
    },
  }
}

const config = { id: '123', slug: 'lumen-sync', clientId: 'client-1', clientSecret: 'secret-1', privateKey: pem }

test('the App is configured from the environment, or not at all', () => {
  assert.equal(appConfig({}), null)
  assert.equal(appConfig({ GITHUB_APP_ID: '1', GITHUB_APP_SLUG: 's', GITHUB_APP_CLIENT_ID: 'c' }), null)
  const c = appConfig({ GITHUB_APP_ID: '1', GITHUB_APP_SLUG: 's', GITHUB_APP_CLIENT_ID: 'c', GITHUB_APP_CLIENT_SECRET: 'x', GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, '\\n') })
  assert.equal(c.privateKey, pem.trim())
})

test('the App’s JWT is signed with its key and short-lived', () => {
  const now = Date.parse('2026-11-05T10:00:00Z')
  const [h, b, s] = appJwt('123', pem, now).split('.')
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url')))
  const body = JSON.parse(Buffer.from(b, 'base64url'))
  assert.equal(body.iss, '123')
  assert.equal(body.exp - body.iat, 600)
})

test('connecting lists the repositories the person can reach, and checks the installation', async () => {
  const gh = fakeGitHub()
  const app = createGitHubApp(config, { callbackUrl: 'https://lumen.test/api/github/callback', fetchImpl: gh.fetchImpl })
  assert.match(app.installUrl('st'), /^https:\/\/github\.com\/apps\/lumen-sync\/installations\/new\?state=st$/)
  assert.deepEqual(await app.reposFor('good', '41'), [{ id: 7, fullName: 'ada/data', private: true, defaultBranch: 'main', installationId: 41 }])
  await assert.rejects(app.reposFor('good', '99'), /isn’t one your GitHub account can reach/)
  await assert.rejects(app.reposFor('bad'), /didn’t confirm/)
  // the user token is handed back, with the App's client credentials
  const revoke = gh.calls.find((c) => c.path === '/applications/client-1/token')
  assert.equal(revoke.method, 'DELETE')
  assert.equal(revoke.auth, `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`)
})

test('installation tokens open one repository and are reused until near expiry', async () => {
  const gh = fakeGitHub()
  const app = createGitHubApp(config, { fetchImpl: gh.fetchImpl })
  const a = await app.installationToken(41, 7)
  assert.equal(await app.installationToken(41, 7), a)
  const asks = gh.calls.filter((c) => c.path === '/app/installations/41/access_tokens')
  assert.equal(asks.length, 1)
  assert.deepEqual(asks[0].body, { repository_ids: [7], permissions: { contents: 'write', metadata: 'read' } })
  assert.match(asks[0].auth, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
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
    const app = createGitHubApp(config, { fetchImpl: gh.fetchImpl })
    const repo = githubRepo({ repoId: 7, token: () => app.installationToken(41, 7), fetchImpl: gh.fetchImpl })
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
    r = await runMirror(ctx, conn, githubRepo({ repoId: 7, token: () => app.installationToken(41, 7), fetchImpl: racing }))
    assert.match(gh.files().get('lists/launch.md'), /- \[x\] Pricing/)
    assert.equal(gh.files().get('notes.txt'), 'meanwhile\n')
  })
}
