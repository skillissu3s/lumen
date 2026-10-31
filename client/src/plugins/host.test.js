import test from 'node:test'
import assert from 'node:assert/strict'
import { useWorkspace } from '../store/workspace.js'
import { useSession } from '../store/session.js'
import { dispatch, validateStorageName } from './host.js'

let shaN = 0
const sha = () => `sha${++shaN}`

class FakeBackend {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files).map(([p, t]) => [p, { text: t, sha: sha() }]))
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
  async write(path, text) {
    const s = sha()
    this.files.set(path, { text, sha: s })
    return { sha: s }
  }
  async remove(path) {
    this.files.delete(path)
    return { deleted: true }
  }
  subscribe() {
    return () => {}
  }
  start() {}
  stop() {}
}

const user = { handle: 'nikhil', name: 'Nikhil' }
const rec = (granted = [], manifest = {}) => ({
  id: 'focus-forest',
  manifest: { id: 'focus-forest', name: 'Focus Forest', statusBar: false, ...manifest },
  granted,
})

async function loaded(files) {
  const backend = new FakeBackend(files)
  useSession.setState({ user, mode: 'server' })
  useWorkspace.getState().initWorkspace({ backend, user, mode: 'server' })
  await useWorkspace.getState().load()
}

test('tasks.list is denied without tasks:read', async () => {
  await loaded({ 'lists/inbox.md': '- [ ] Buy milk 🆔 a\n' })
  await assert.rejects(() => dispatch(rec(), 'tasks.list', { filter: {} }), /Permission tasks:read not granted/)
})

test('storage names are validated', () => {
  assert.throws(() => validateStorageName('../evil.txt'), /\.\./)
  assert.throws(() => validateStorageName('a/../../b.txt'), /\.\./)
  assert.throws(() => validateStorageName('photo.png'), /text/)
  assert.throws(() => validateStorageName('/abs.txt'), /relative/)
  assert.throws(() => validateStorageName(`${'x'.repeat(201)}.txt`), /200/)
  assert.equal(validateStorageName('days/2026-10-31.json'), 'days/2026-10-31.json')
})

test('storage get/set round-trips through the workspace', async () => {
  await loaded({})
  await dispatch(rec(['storage']), 'storage.set', { key: 'settings', value: { a: 1 } })
  const got = await dispatch(rec(['storage']), 'storage.get', { key: 'settings' })
  assert.deepEqual(got, { a: 1 })
  assert.ok(useWorkspace.getState().files['data/plugins/focus-forest/nikhil/settings.json'])
})

test('ui.setStatus requires statusBar in the manifest', async () => {
  await loaded({})
  await assert.rejects(() => dispatch(rec(['storage']), 'ui.setStatus', { text: 'hi' }), /statusBar/)
})

test('tasks.list returns plain items once granted', async () => {
  await loaded({ 'lists/inbox.md': '- [ ] Buy milk 🆔 a\n' })
  const items = await dispatch(rec(['tasks:read']), 'tasks.list', { filter: { open: true } })
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Buy milk')
  assert.equal(items[0].list.name, 'inbox')
})

test('calendar.list requires calendar:read', async () => {
  await loaded({})
  await assert.rejects(() => dispatch(rec(), 'calendar.list', { from: '2026-11-01', to: '2026-11-07' }), /Permission calendar:read not granted/)
})
