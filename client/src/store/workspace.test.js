import test from 'node:test'
import assert from 'node:assert/strict'
import { useWorkspace, onProblem } from './workspace.js'
import { ConflictError } from '../storage/errors.js'
import { updateItem as editItem } from '../../../shared/items.js'

let shaN = 0
const sha = () => `sha${++shaN}`

class FakeBackend {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files).map(([p, t]) => [p, { text: t, sha: sha() }]))
    this.writes = []
    this.writeImpl = null
    this.handler = null
  }
  get kind() {
    return 'server'
  }
  async list() {
    return [...this.files].map(([path, f]) => ({ path, sha: f.sha }))
  }
  async readMany(paths) {
    const out = {}
    for (const p of paths) {
      const f = this.files.get(p)
      out[p] = f ? { text: f.text, sha: f.sha } : null
    }
    return out
  }
  async write(path, text, baseSha) {
    this.writes.push({ path, text, baseSha })
    if (this.writeImpl) return this.writeImpl(path, text, baseSha)
    const s = sha()
    this.files.set(path, { text, sha: s })
    return { sha: s }
  }
  async remove(path) {
    this.files.delete(path)
    return { deleted: true }
  }
  subscribe(fn) {
    this.handler = fn
    return () => {}
  }
  async emit(changes) {
    await this.handler?.(changes)
  }
  start() {}
  stop() {}
}

const user = { handle: 'nikhil' }
const INBOX = 'lists/inbox.md'
const s = () => useWorkspace.getState()

async function loaded(files, opts = {}) {
  const backend = new FakeBackend(files)
  s().initWorkspace({ backend, user, mode: opts.mode || 'server' })
  await s().load()
  return backend
}

test('optimistic edit is visible at once', async () => {
  await loaded({ [INBOX]: '- [ ] Buy milk 🆔 a\n' })
  s().edit(INBOX, (t) => t.replace('- [ ] Buy milk', '- [x] Buy milk'))
  assert.match(s().files[INBOX].text, /- \[x\] Buy milk/)
})

test('two quick edits coalesce into one write', async () => {
  const backend = await loaded({ [INBOX]: '- [ ] Buy milk 🆔 a\n' })
  s().edit(INBOX, (t) => t.replace('[ ]', '[x]'))
  s().edit(INBOX, (t) => t.replace('milk', 'milk and eggs'))
  await s().flushNow()
  const writes = backend.writes.filter((w) => w.path === INBOX)
  assert.equal(writes.length, 1)
  assert.match(writes[0].text, /\[x\] Buy milk and eggs/)
})

test('conflict re-applies our ops on the newer remote text', async () => {
  const backend = await loaded({ [INBOX]: '- [ ] Buy milk 🆔 a\n' })
  const remoteText = '- [ ] Buy milk 🆔 a\n- [ ] Call mom 🆔 b\n'
  let calls = 0
  backend.writeImpl = (path, text) => {
    calls++
    if (calls === 1) {
      backend.files.set(path, { text: remoteText, sha: 'remote' })
      throw new ConflictError({ text: remoteText, sha: 'remote' })
    }
    const s2 = sha()
    backend.files.set(path, { text, sha: s2 })
    return { sha: s2 }
  }
  s().edit(INBOX, (t) => t.replace('- [ ] Buy milk', '- [x] Buy milk'))
  await s().flushNow()
  assert.match(s().files[INBOX].text, /- \[x\] Buy milk/)
  assert.match(s().files[INBOX].text, /- \[ \] Call mom/)
})

test('an op that throws on rebase is dropped and reported', async () => {
  const problems = []
  const unsub = onProblem((p) => problems.push(p.message))
  const backend = await loaded({ [INBOX]: '- [ ] Buy milk 🆔 a\n' })
  const remoteText = '- [ ] Something else 🆔 z\n'
  backend.writeImpl = (path) => {
    backend.files.set(path, { text: remoteText, sha: 'remote' })
    throw new ConflictError({ text: remoteText, sha: 'remote' })
  }
  s().edit(INBOX, (t) => editItem(t, 'a', { status: 'x' }).text)
  await s().flushNow()
  assert.equal(s().files[INBOX].text, remoteText)
  assert.ok(problems.some((m) => /gone/i.test(m)))
  unsub()
})

test('remote change with no pending ops replaces text', async () => {
  const backend = await loaded({ [INBOX]: '- [ ] Buy milk 🆔 a\n' })
  const newText = '- [ ] Buy milk 🆔 a\n- [ ] New task 🆔 n\n'
  backend.files.set(INBOX, { text: newText, sha: 'fresh' })
  await backend.emit([{ path: INBOX, sha: 'fresh', deleted: false }])
  assert.equal(s().files[INBOX].text, newText)
})

test('text op rebases onto a newer doc version', async () => {
  const backend = await loaded({ [INBOX]: '- [ ] x 🆔 a\n', 'docs/note.md': 'one\ntwo\nthree\n' })
  await s().ensure('docs/note.md')
  s().setText('docs/note.md', 'one\nTWO\nthree\n')
  const remote = 'one\ntwo\nthree\nfour\n'
  let calls = 0
  backend.writeImpl = (path, text) => {
    calls++
    if (path === 'docs/note.md' && calls === 1) {
      backend.files.set(path, { text: remote, sha: 'remote' })
      throw new ConflictError({ text: remote, sha: 'remote' })
    }
    const s2 = sha()
    backend.files.set(path, { text, sha: s2 })
    return { sha: s2 }
  }
  await s().flushNow()
  assert.equal(s().files['docs/note.md'].text, 'one\nTWO\nthree\nfour\n')
})

test('a second conflict still re-applies edits by item id (operations are kept)', async () => {
  const LIST = '- [ ] A 🆔 a\n- [ ] B 🆔 b\n'
  const backend = await loaded({ [INBOX]: LIST })
  let round = 0
  backend.writeImpl = async (path, text) => {
    round++
    // two other devices add lines before our write gets through
    if (round <= 2) {
      const cur = backend.files.get(path)
      const theirs = { text: `${cur.text}- [ ] Remote ${round} 🆔 r${round}\n`, sha: sha() }
      backend.files.set(path, theirs)
      throw new ConflictError({ text: theirs.text, sha: theirs.sha })
    }
    const s2 = sha()
    backend.files.set(path, { text, sha: s2 })
    return { sha: s2 }
  }
  await s().edit(INBOX, (t) => editItem(t, 'a', { status: 'x' }, { today: '2026-11-01' }).text)
  await s().flushNow()
  const final = backend.files.get(INBOX).text
  assert.match(final, /- \[x\] A ✅ 2026-11-01 🆔 a/)
  assert.match(final, /Remote 1/)
  assert.match(final, /Remote 2/)
})

test('a remote notice during an in-flight write waits for it, and our own echo is ignored', async () => {
  const backend = await loaded({ [INBOX]: '- [ ] A 🆔 a\n' })
  let release
  let reads = 0
  const readMany = backend.readMany.bind(backend)
  backend.readMany = async (p) => {
    reads++
    return readMany(p)
  }
  backend.writeImpl = (path, text) =>
    new Promise((resolve) => {
      release = () => {
        const s2 = sha()
        backend.files.set(path, { text, sha: s2 })
        resolve({ sha: s2 })
        return s2
      }
    })
  await s().edit(INBOX, (t) => editItem(t, 'a', { status: 'x' }, { today: '2026-11-01' }).text)
  const flushing = s().flushNow()
  await new Promise((r) => setTimeout(r, 0))
  const written = release()
  await backend.emit([{ path: INBOX, sha: written, deleted: false }])
  await flushing
  await backend.emit([{ path: INBOX, sha: written, deleted: false }])
  assert.equal(reads, 0, 'our own write is not fetched again')
  assert.match(s().files[INBOX].text, /\[x\] A/)
  assert.equal(s().saving.state, 'saved')
})
