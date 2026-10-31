// The workspace store: every file as local text + the remote sha it was based on,
// with an operation queue per file so edits are optimistic, debounced, and
// re-applied (rebased) onto newer remote versions after a conflict.

import { create } from 'zustand'
import { rebaseText } from '../../../shared/merge.js'
import { seedFiles } from '../../../shared/seed.js'
import { createEmitter } from '../lib/emitter.js'
import { ConflictError, AuthError } from '../storage/errors.js'

const LIST_RE = /^lists\/[^/]+\.md$/
const CALENDAR_RE = /^calendars\/[^/]+\.md$/
const PLUGIN_RE = /^plugins\/[^/]+\/manifest\.json$/
const IDEAS_RE = /^ideas\/[^/]+\.canvas$/

const problems = createEmitter()

/** Subscribe to human-readable problems (for toasts). Returns an unsubscribe. */
export function onProblem(fn) {
  problems.on('problem', fn)
  return () => problems.off('problem', fn)
}

// Mutable module state (deliberately outside the reactive store).
let backend = null
let unsubRemote = null
let offline = false
let saveError = null
let lastSaved = null
const queues = new Map() // path → { base, ops, inflight, deleted, conflicts, timer, retryTimer, retryDelay }

function isDirty(q) {
  return !!q.inflight || q.ops.length > 0 || q.deleted
}

function localText(q) {
  let text = q.base ? q.base.text : ''
  for (const op of q.ops) text = op.type === 'text' ? op.text : op.run(text)
  return text
}

export const useWorkspace = create((set, get) => ({
  status: 'idle',
  error: null,
  files: {},
  paths: [],
  saving: { state: 'saved', pending: 0, error: null, lastSaved: null },
  user: null,
  mode: null,

  initWorkspace({ backend: b, user: u, mode: m }) {
    backend = b
    queues.clear()
    unsubRemote?.()
    unsubRemote = null
    offline = false
    saveError = null
    lastSaved = null
    setupLifecycle()
    set({
      status: 'idle',
      error: null,
      files: {},
      paths: [],
      saving: { state: 'saved', pending: 0, error: null, lastSaved: null },
      user: u,
      mode: m,
    })
  },

  async load() {
    set({ status: 'loading', error: null })
    try {
      let list = await backend.list()
      let paths = list.map((f) => f.path)
      if (get().mode === 'github' && !paths.includes('lumen.json')) {
        const seed = seedFiles({ handle: get().user?.handle, chat: false })
        for (const [p, text] of Object.entries(seed)) await backend.write(p, text, null)
        list = await backend.list()
        paths = list.map((f) => f.path)
      }
      const handle = get().user?.handle
      const core = paths.filter((p) => isCore(p, handle))
      const loaded = await backend.readMany(core)
      const files = {}
      for (const p of core) {
        const f = loaded[p]
        if (f) files[p] = { text: f.text, sha: f.sha }
      }
      set({ status: 'ready', files, paths, error: null })
      backend.start()
      unsubRemote = backend.subscribe(handleRemoteChange)
      restorePending()
      if (queues.size) get().flushNow()
    } catch (e) {
      set({ status: 'error', error: e.message || 'Failed to load the workspace' })
    }
  },

  async edit(path, op, { create = false } = {}) {
    let q = queues.get(path)
    if (!q) {
      const file = get().files[path]
      if (file) q = makeQueue({ text: file.text, sha: file.sha })
      else if (create) q = makeQueue({ text: '', sha: null })
      else throw new Error(`File not loaded: ${path}`)
      queues.set(path, q)
    } else if (!q.base && create) {
      q.base = { text: '', sha: null }
    }
    if (!q.base) throw new Error(`File not loaded: ${path}`)
    const newText = op(localText(q))
    if (newText === localText(q)) return { text: newText, sha: q.base.sha }
    q.ops.push({ type: 'fn', run: op })
    setFile(path, newText, q.base.sha)
    scheduleWrite(path, q)
    updateSaving()
    return { text: newText, sha: q.base.sha }
  },

  async setText(path, newText) {
    const q = ensureQueue(path)
    if (!q.base) throw new Error(`File not loaded: ${path}`)
    const prev = localText(q)
    if (newText === prev) return
    q.ops.push({ type: 'text', base: prev, text: newText })
    setFile(path, newText, q.base.sha)
    scheduleWrite(path, q)
    updateSaving()
  },

  async createFile(path, text) {
    const q = ensureQueue(path)
    if (q.base) throw new Error(`File already exists: ${path}`)
    q.base = { text: '', sha: null }
    q.ops.push({ type: 'text', base: '', text })
    setFile(path, text, null)
    scheduleWrite(path, q)
    updateSaving()
    return { sha: null }
  },

  async removeFile(path) {
    const q = ensureQueue(path)
    if (!q.base) throw new Error(`File not loaded: ${path}`)
    q.ops = []
    q.deleted = true
    removePath(path)
    scheduleWrite(path, q)
    updateSaving()
  },

  async ensure(path) {
    const file = get().files[path]
    if (file) return file
    const result = await backend.readMany([path])
    const got = result[path]
    if (got) setFile(path, got.text, got.sha)
    return got || null
  },

  flushNow() {
    for (const q of queues.values()) {
      if (q.timer) {
        clearTimeout(q.timer)
        q.timer = null
      }
      if (q.retryTimer) {
        clearTimeout(q.retryTimer)
        q.retryTimer = null
      }
    }
    return Promise.all([...queues].map(([path, q]) => doWrite(path, q)))
  },
}))

const getState = () => useWorkspace.getState()
const setState = (patch) => useWorkspace.setState(patch)

function makeQueue(base) {
  return { base, ops: [], inflight: null, deleted: false, conflicts: 0, timer: null, retryTimer: null, retryDelay: null }
}

function ensureQueue(path) {
  let q = queues.get(path)
  if (!q) {
    const file = getState().files[path]
    q = makeQueue(file ? { text: file.text, sha: file.sha } : null)
    queues.set(path, q)
  }
  return q
}

function setFile(path, text, sha) {
  const files = { ...getState().files, [path]: { text, sha } }
  const paths = getState().paths.includes(path) ? getState().paths : [...getState().paths, path]
  setState({ files, paths })
}

function removePath(path) {
  const files = { ...getState().files }
  delete files[path]
  setState({ files, paths: getState().paths.filter((p) => p !== path) })
}

function isCore(path, handle) {
  if (path === 'lumen.json') return true
  if (LIST_RE.test(path) || CALENDAR_RE.test(path) || PLUGIN_RE.test(path) || IDEAS_RE.test(path)) return true
  if (handle && path === `users/${handle}/settings.json`) return true
  return false
}

function updateSaving() {
  let pending = 0
  for (const q of queues.values()) if (isDirty(q)) pending++
  const state = pending > 0 ? (offline ? 'offline' : saveError ? 'error' : 'saving') : 'saved'
  // everything is saved: nothing to replay after a reload
  if (!pending && typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(`lumen.pending.${scopeKey()}`)
    } catch {
      /* storage unavailable */
    }
  }
  setState({ saving: { state, pending, error: saveError, lastSaved } })
}

// Re-apply pending ops on top of a newer remote version. Function ops that no
// longer apply (their item is gone) are dropped and reported; text ops rebase.
// Operations stay operations (an edit by item id applies again exactly on the
// next conflict too); a text op is rebased and re-based on what precedes it.
function rebaseOnto(q, current) {
  const ops = q.ops
  q.ops = []
  q.base = current
  let text = current.text
  for (const op of ops) {
    if (op.type === 'text') {
      const before = text
      text = rebaseText(op.base, op.text, text).text
      q.ops.push({ type: 'text', base: before, text })
    } else {
      try {
        text = op.run(text)
        q.ops.push(op)
      } catch (e) {
        problems.emit('problem', { message: e.message || 'An item changed elsewhere and no longer exists' })
      }
    }
  }
  return text
}

function scheduleWrite(path, q) {
  if (q.inflight) return
  if (q.timer) clearTimeout(q.timer)
  const delay = getState().mode === 'github' ? 1500 : 400
  q.timer = setTimeout(() => {
    q.timer = null
    doWrite(path, q)
  }, delay)
}

function scheduleRetry(path, q) {
  if (q.retryTimer) return
  q.retryDelay = Math.min((q.retryDelay || 1000) * 2, 30000)
  q.retryTimer = setTimeout(() => {
    q.retryTimer = null
    doWrite(path, q)
  }, q.retryDelay)
}

async function doWrite(path, q) {
  try {
    await writeOnce(path, q)
  } finally {
    const c = q.recheck
    q.recheck = null
    if (c && !q.inflight && (c.deleted || c.sha !== q.base?.sha)) await handleRemoteChange([c])
  }
}

async function writeOnce(path, q) {
  if (q.inflight || !isDirty(q)) return
  const deleted = q.deleted
  const text = deleted ? null : localText(q)
  const baseSha = q.base ? q.base.sha : null
  const opsCount = q.ops.length
  q.inflight = true
  updateSaving()
  try {
    const result = deleted ? await backend.remove(path, baseSha) : await backend.write(path, text, baseSha)
    q.inflight = null
    if (deleted) {
      queues.delete(path)
      removePath(path)
    } else {
      q.base = { text, sha: result.sha }
      q.ops = q.ops.slice(opsCount)
    }
    q.conflicts = 0
    offline = false
    saveError = null
    lastSaved = Date.now()
    updateSaving()
    if (isDirty(q)) scheduleWrite(path, q)
  } catch (e) {
    q.inflight = null
    if (e instanceof ConflictError) {
      q.conflicts += 1
      if (q.conflicts > 5) {
        saveError = e.message
        offline = false
        updateSaving()
        problems.emit('problem', { message: `Could not save changes to ${path}` })
        return
      }
      const current = e.current || { text: '', sha: null }
      if (deleted) {
        q.base = current
      } else {
        const newText = rebaseOnto(q, current)
        setFile(path, newText, q.base.sha)
      }
      updateSaving()
      await writeOnce(path, q)
    } else if (e instanceof AuthError) {
      saveError = e.message
      offline = false
      updateSaving()
      problems.emit('problem', { message: e.message })
    } else {
      offline = true
      saveError = null
      persistPending()
      updateSaving()
      scheduleRetry(path, q)
    }
  }
}

async function handleRemoteChange(changes) {
  for (const c of changes) {
    const q = queues.get(c.path)
    // our own write coming back, or a version we already have
    if (!c.deleted && c.sha && (c.sha === q?.base?.sha || (!q && c.sha === getState().files[c.path]?.sha))) continue
    // a write is on its way: look again once it has landed (doWrite does)
    if (q?.inflight) {
      q.recheck = c
      continue
    }
    const dirty = q && (q.ops.length || q.deleted)
    if (c.deleted) {
      if (dirty) {
        if (q.deleted) continue
        rebaseOnto(q, { text: '', sha: null })
        const text = localText(q)
        if (text !== '') {
          setFile(c.path, text, null)
          scheduleWrite(c.path, q)
        } else {
          queues.delete(c.path)
          removePath(c.path)
        }
      } else {
        queues.delete(c.path)
        removePath(c.path)
      }
      continue
    }
    if (!dirty) {
      const res = await backend.readMany([c.path])
      const f = res[c.path]
      if (f) {
        if (q) q.base = { text: f.text, sha: f.sha }
        setFile(c.path, f.text, f.sha)
      } else {
        removePath(c.path)
      }
      continue
    }
    const res = await backend.readMany([c.path])
    const f = res[c.path]
    if (!f) {
      removePath(c.path)
      continue
    }
    rebaseOnto(q, { text: f.text, sha: f.sha })
    setFile(c.path, localText(q), f.sha)
    scheduleWrite(c.path, q)
  }
}

function scopeKey() {
  return `${getState().mode || 'unknown'}:${getState().user?.handle || 'anon'}`
}

function persistPending() {
  if (typeof localStorage === 'undefined') return
  const map = {}
  for (const [path, q] of queues) {
    if (!q.base || q.deleted || !q.ops.length) continue
    map[path] = { base: q.base.text, text: localText(q) }
  }
  try {
    localStorage.setItem(`lumen.pending.${scopeKey()}`, JSON.stringify(map))
  } catch {
    /* storage unavailable */
  }
}

function restorePending() {
  if (typeof localStorage === 'undefined') return
  const key = `lumen.pending.${scopeKey()}`
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(key) || 'null')
    localStorage.removeItem(key)
  } catch {
    return
  }
  if (!saved) return
  for (const [path, entry] of Object.entries(saved)) {
    if (entry == null) continue
    const q = ensureQueue(path)
    const pending = typeof entry === 'string' ? { base: q.base?.text ?? '', text: entry } : entry
    let text = pending.text
    if (q.base) {
      text = rebaseText(pending.base, pending.text, q.base.text).text
      if (text === q.base.text) continue
      q.ops.push({ type: 'text', base: q.base.text, text })
      setFile(path, text, q.base.sha)
    } else {
      q.base = { text: '', sha: null }
      q.ops.push({ type: 'text', base: '', text })
      setFile(path, text, null)
    }
    scheduleWrite(path, q)
  }
}

function setupLifecycle() {
  if (setupLifecycle.done) return
  setupLifecycle.done = true
  if (typeof window === 'undefined') return
  window.addEventListener('beforeunload', () => {
    persistPending()
    getState().flushNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') getState().flushNow()
  })
  window.addEventListener('online', () => {
    offline = false
    for (const [path, q] of queues) if (isDirty(q)) doWrite(path, q)
    updateSaving()
  })
}
