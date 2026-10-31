import test from 'node:test'
import assert from 'node:assert/strict'
import { validateManifest } from './manifest.js'

const valid = {
  id: 'focus-forest',
  name: 'Focus Forest',
  version: '1.0.0',
  description: 'Grow a tree.',
  author: 'Lumen',
  entry: 'index.html',
  files: ['index.html', 'main.js', 'style.css'],
  icon: 'trees',
  permissions: ['storage', 'tasks:read'],
  background: true,
  view: { title: 'Focus', icon: 'trees' },
  commands: [{ id: 'start', title: 'Start a focus session' }],
  statusBar: true,
  minLumen: '0.1.0',
}

test('accepts a valid manifest', () => {
  const r = validateManifest(valid)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
  assert.equal(r.manifest.id, 'focus-forest')
})

test('rejects a non-object', () => {
  assert.equal(validateManifest(null).ok, false)
  assert.equal(validateManifest([]).ok, false)
  assert.equal(validateManifest('x').ok, false)
})

test('rejects a bad id', () => {
  assert.equal(validateManifest({ ...valid, id: 'Focus Forest' }).ok, false)
  assert.equal(validateManifest({ ...valid, id: 'focus_forest' }).ok, false)
  assert.equal(validateManifest({ ...valid, id: '' }).ok, false)
})

test('requires name, version and entry', () => {
  assert.equal(validateManifest({ ...valid, name: '' }).ok, false)
  assert.equal(validateManifest({ ...valid, version: '' }).ok, false)
  assert.equal(validateManifest({ ...valid, entry: '' }).ok, false)
})

test('requires the entry to be listed in files', () => {
  const r = validateManifest({ ...valid, files: ['main.js', 'style.css'] })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /entry/.test(e)))
})

test('rejects unknown permissions', () => {
  const r = validateManifest({ ...valid, permissions: ['tasks:read', 'read-your-mind'] })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /unknown permission/.test(e)))
})

test('rejects too many files', () => {
  const files = Array.from({ length: 51 }, (_, i) => `f${i}.js`)
  files[0] = 'index.html'
  const r = validateManifest({ ...valid, files })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /50/.test(e)))
})

test('rejects a non-string icon', () => {
  assert.equal(validateManifest({ ...valid, icon: 42 }).ok, false)
  assert.equal(validateManifest({ ...valid, view: { icon: {} } }).ok, false)
})
