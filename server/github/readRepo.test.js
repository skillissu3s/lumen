import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRepo, readRepo } from './readRepo.js'

// a GitHub that knows one repository
function fakeGitHub(files, { requireToken = false } = {}) {
  const shas = Object.fromEntries(Object.keys(files).map((p, i) => [p, `sha${i}`]))
  const seen = []
  const fetchImpl = async (url, { headers }) => {
    seen.push({ url, auth: headers.Authorization || null })
    const json = (status, body) => ({ status, ok: status < 300, json: async () => body })
    if (requireToken && !headers.Authorization) return json(404, {})
    const path = url.replace('https://api.github.com/repos/you/lumen-data', '')
    if (path === '') return json(200, { default_branch: 'main' })
    if (path.startsWith('/git/trees/main')) return json(200, { tree: [...Object.keys(files).map((p) => ({ type: 'blob', path: p, size: files[p].length, sha: shas[p] })), { type: 'tree', path: 'lists' }] })
    const m = /\/git\/blobs\/(.+)$/.exec(path)
    if (m) {
      const p = Object.keys(shas).find((k) => shas[k] === m[1])
      return json(200, { encoding: 'base64', content: Buffer.from(files[p]).toString('base64') })
    }
    return json(404, {})
  }
  return { fetchImpl, seen }
}

test('repository names in the forms people paste', () => {
  assert.deepEqual(parseRepo('you/lumen-data'), { owner: 'you', name: 'lumen-data' })
  assert.deepEqual(parseRepo('https://github.com/you/lumen-data.git'), { owner: 'you', name: 'lumen-data' })
  assert.deepEqual(parseRepo(' https://github.com/you/lumen-data/ '), { owner: 'you', name: 'lumen-data' })
  assert.equal(parseRepo('lumen-data'), null)
})

test('reads every file it is asked to keep, from the default branch', async () => {
  const { fetchImpl } = fakeGitHub({ 'lumen.json': '{"name":"Home"}', 'lists/inbox.md': '- [ ] Milk\n', 'photo.png': 'xx' })
  const out = await readRepo({ repo: 'you/lumen-data', keep: (p) => !p.endsWith('.png'), fetchImpl })
  assert.equal(out.ref, 'main')
  assert.deepEqual(Object.fromEntries(out.files), { 'lumen.json': '{"name":"Home"}', 'lists/inbox.md': '- [ ] Milk\n' })
})

test('a private repository: the token is sent, and a missing one is explained', async () => {
  const gh = fakeGitHub({ 'lumen.json': '{}' }, { requireToken: true })
  await assert.rejects(readRepo({ repo: 'you/lumen-data', fetchImpl: gh.fetchImpl }), /add a token/)
  const out = await readRepo({ repo: 'you/lumen-data', token: 'secret', fetchImpl: gh.fetchImpl })
  assert.equal(out.files.length, 1)
  assert.ok(gh.seen.filter((s) => s.auth).every((s) => s.auth === 'Bearer secret'))
})
