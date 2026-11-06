// The workspace store: every file as local text + the remote sha it was based on,
// with an operation queue per file so edits are optimistic, debounced, and
// re-applied (rebased) onto newer remote versions after a conflict.
//
// It also keeps this browser's copy of the workspace (lib/offlineCache.js): when
// the server can't be reached, the app opens from the copy, edits queue up, and
// once the server answers again it catches up (remote changes in, queued edits
// out, rebased).
//
// Spaces (docs/CANDLES.md): `tree` holds every file the person can reach, at
// its path in their tree (their candle at the top, workspaces/<slug>/…,
// shared/<owner>/…). `files` and `paths` are the current space only, with
// paths inside it, so the rest of the app works in any space as it did in the
// one workspace. edit/createFile/… take those paths; the *At versions take a
// path in the tree, for what is the person's wherever they are (preferences,
// plugins, plugin data).

import { create } from 'zustand'
import { rebaseText } from '../../../shared/merge.js'
import { createEmitter } from '../lib/emitter.js'
import { readCopy, writeCopy } from '../lib/offlineCache.js'
import { ConflictError, AuthError, OfflineError, RefusedError } from '../storage/errors.js'

const LIST_RE = /^lists\/[^/]+\.md$/
const CALENDAR_RE = /^calendars\/[^/]+\.md$/
const PLUGIN_RE = /^plugins\/[^/]+\/manifest\.json$/
const IDEAS_RE = /^ideas\/[^/]+\.canvas$/
const SPACE_RE = /^(workspaces|shared)\/[^/]+\//

const problems = createEmitter()

/** Subscribe to human-readable problems (for toasts). Returns an unsubscribe. */
export function onProblem(fn) {
  problems.on('problem', fn)
  return () => problems.off('problem', fn)
}

/** A file by its path in the open space; in your candle, other spaces' too (their tree paths) */
export const fileAt = (path) => getState().tree[prefix + path]

/** A calendar's file, in this space or (from your candle) another one */
export const isCalendarPath = (path) => /^((workspaces|shared)\/[^/]+\/)?calendars\//.test(path)

/** May this path in the tree be changed? (not when it's shared with you to view only) */
export const canEdit = (path) => !readOnly.has(path)

/** The space a path in the tree belongs to: 'workspaces/<slug>/', 'shared/<owner>/' or '' (the candle) */
export const spaceOf = (path) => SPACE_RE.exec(path)?.[0] || ''

// Mutable module state (deliberately outside the reactive store).
let backend = null
let unsubRemote = null
let offline = false
let connected = false // the server has answered since the workspace opened
let reconnectTimer = null
let copyTimer = null
let saveError = null
let lastSaved = null
let prefix = '' // the current space's place in the tree
let readOnly = new Set() // paths in the tree shared with you to view only
const VIEW_ONLY = 'You can view this, not change it.'
const queues = new Map() // path in the tree → { base, ops, inflight, deleted, conflicts, timer, retryTimer, retryDelay }

const inSpace = (path, pre = prefix) => (pre ? path.startsWith(pre) : !SPACE_RE.test(path))
const toFull = (rel) => prefix + rel

// the current space's part of the tree, with paths inside it
function viewOf(tree, treePaths, pre) {
  const files = {}
  for (const [p, f] of Object.entries(tree)) if (inSpace(p, pre)) files[p.slice(pre.length)] = f
  return { files, paths: treePaths.filter((p) => inSpace(p, pre)).map((p) => p.slice(pre.length)) }
}

function isDirty(q) {
  return !!q.inflight || q.ops.length > 0 || q.deleted
}

function localText(q) {
  let text = q.base ? q.base.text : ''
  for (const op of q.ops) text = op.type === 'text' ? op.text : op.run(text)
  return text
}

async function editAt(path, op, { create = false } = {}) {
  if (readOnly.has(path)) {
    problems.emit('problem', { message: VIEW_ONLY })
    const f = getState().tree[path]
    return { text: f?.text ?? '', sha: f?.sha ?? null }
  }
  let q = queues.get(path)
  if (!q) {
    const file = getState().tree[path]
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
}

async function setTextAt(path, newText) {
  if (readOnly.has(path)) return problems.emit('problem', { message: VIEW_ONLY })
  const q = ensureQueue(path)
  if (!q.base) throw new Error(`File not loaded: ${path}`)
  const prev = localText(q)
  if (newText === prev) return
  q.ops.push({ type: 'text', base: prev, text: newText })
  setFile(path, newText, q.base.sha)
  scheduleWrite(path, q)
  updateSaving()
}

async function createAt(path, text) {
  const q = ensureQueue(path)
  if (q.base) throw new Error(`File already exists: ${path}`)
  q.base = { text: '', sha: null }
  q.ops.push({ type: 'text', base: '', text })
  setFile(path, text, null)
  scheduleWrite(path, q)
  updateSaving()
  return { sha: null }
}

async function removeAt(path) {
  if (readOnly.has(path)) return problems.emit('problem', { message: VIEW_ONLY })
  const q = ensureQueue(path)
  if (!q.base) throw new Error(`File not loaded: ${path}`)
  q.ops = []
  q.deleted = true
  removePath(path)
  scheduleWrite(path, q)
  updateSaving()
}

async function ensureAt(path) {
  const file = getState().tree[path]
  if (file) return file
  if (offline) return null
  let result
  try {
    result = await backend.readMany([path])
  } catch (e) {
    if (e instanceof OfflineError) return null
    throw e
  }
  const got = result[path]
  if (got) setFile(path, got.text, got.sha)
  return got || null
}

export const useWorkspace = create((set, get) => ({
  status: 'idle',
  error: null,
  files: {},
  paths: [],
  tree: {},
  treePaths: [],
  prefix: '',
  saving: { state: 'saved', pending: 0, error: null, lastSaved: null },
  user: null,
  mode: null,

  initWorkspace({ backend: b, user: u, mode: m, space = '' }) {
    backend = b
    queues.clear()
    unsubRemote?.()
    unsubRemote = null
    offline = false
    connected = false
    clearTimeout(reconnectTimer)
    saveError = null
    lastSaved = null
    prefix = space
    setupLifecycle()
    set({
      status: 'idle',
      error: null,
      files: {},
      paths: [],
      tree: {},
      treePaths: [],
      prefix,
      saving: { state: 'saved', pending: 0, error: null, lastSaved: null },
      user: u,
      mode: m,
    })
  },

  /** `offline`: the server didn't answer a moment ago; open the copy without asking it again */
  async load({ offline: knownOffline = false } = {}) {
    set({ status: 'loading', error: null })
    try {
      if (knownOffline) throw new OfflineError()
      const list = await backend.list()
      const treePaths = list.map((f) => f.path)
      const handle = get().user?.handle
      const core = treePaths.filter((p) => isCore(p, handle))
      const loaded = await backend.readMany(core)
      const tree = {}
      for (const p of core) {
        const f = loaded[p]
        if (f) tree[p] = { text: f.text, sha: f.sha }
      }
      set({ status: 'ready', tree, treePaths, ...viewOf(tree, treePaths, prefix), error: null })
      goOnline()
      restorePending()
      if (queues.size) get().flushNow()
      saveCopySoon()
      fillCopy()
    } catch (e) {
      // no answer from the server: open this browser's copy, if there is one
      const copy = e instanceof OfflineError ? await readCopy(scopeKey()) : null
      if (!copy) return set({ status: 'error', error: e.message || 'Failed to load the workspace' })
      offline = true
      const tree = copy.files || {}
      const treePaths = copy.paths || []
      set({ status: 'ready', tree, treePaths, ...viewOf(tree, treePaths, prefix), error: null })
      restorePending()
      updateSaving()
      reconnectSoon()
    }
  },

  /** Paths in the tree that are shared with you to view only */
  setReadOnly(paths) {
    readOnly = new Set(paths)
  },

  /** Shows another space: `pre` is its place in the tree ('' for the candle) */
  setSpace(pre) {
    prefix = pre || ''
    set({ prefix, ...viewOf(get().tree, get().treePaths, prefix) })
  },

  // paths inside the current space
  edit: (path, op, opts) => editAt(toFull(path), op, opts),
  setText: (path, text) => setTextAt(toFull(path), text),
  createFile: (path, text) => createAt(toFull(path), text),
  removeFile: (path) => removeAt(toFull(path)),
  ensure: (path) => ensureAt(toFull(path)),

  // paths in the whole tree
  editAt,
  setTextAt,
  createAt,
  removeAt,
  ensureAt,

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
    const file = getState().tree[path]
    q = makeQueue(file ? { text: file.text, sha: file.sha } : null)
    queues.set(path, q)
  }
  return q
}

// a file of the tree changed: the tree, and the current space if it's in it
function setFile(path, text, sha) {
  const s = getState()
  const file = { text, sha }
  const patch = { tree: { ...s.tree, [path]: file } }
  if (!s.treePaths.includes(path)) patch.treePaths = [...s.treePaths, path]
  if (inSpace(path)) {
    const rel = path.slice(prefix.length)
    patch.files = { ...s.files, [rel]: file }
    if (!s.paths.includes(rel)) patch.paths = [...s.paths, rel]
  }
  setState(patch)
  saveCopySoon()
}

function removePath(path) {
  const s = getState()
  const tree = { ...s.tree }
  delete tree[path]
  const patch = { tree, treePaths: s.treePaths.filter((p) => p !== path) }
  if (inSpace(path)) {
    const rel = path.slice(prefix.length)
    const files = { ...s.files }
    delete files[rel]
    Object.assign(patch, { files, paths: s.paths.filter((p) => p !== rel) })
  }
  setState(patch)
  saveCopySoon()
}

// ---------- this browser's copy ----------

// every file as the server last confirmed it; edits not sent yet stay in the
// pending list (persistPending), so a copy never passes them off as saved
function saveCopySoon() {
  if (getState().status !== 'ready') return
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    const files = {}
    for (const [p, f] of Object.entries(getState().tree)) {
      const base = queues.get(p)?.base ?? f
      if (base?.sha) files[p] = { text: base.text, sha: base.sha }
    }
    const paths = getState().treePaths.filter((p) => !queues.get(p)?.deleted)
    writeCopy(scopeKey(), { paths, files })
    if (offline) persistPending()
  }, 1500)
}

// the files not loaded at the start (docs, plugin data) come in quietly, so the
// copy has them too
async function fillCopy() {
  const missing = getState().treePaths.filter((p) => !getState().tree[p])
  for (let i = 0; i < missing.length && !offline; i += 100) {
    let got
    try {
      got = await backend.readMany(missing.slice(i, i + 100))
    } catch {
      return
    }
    const tree = { ...getState().tree }
    for (const [p, f] of Object.entries(got)) if (f && !tree[p]) tree[p] = { text: f.text, sha: f.sha }
    setState({ tree, ...viewOf(tree, getState().treePaths, prefix) })
  }
  saveCopySoon()
}

// ---------- the connection ----------

function goOnline() {
  offline = false
  connected = true
  clearTimeout(reconnectTimer)
  backend.start()
  unsubRemote ||= backend.subscribe(handleRemoteChange)
}

function reconnectSoon() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(reconnect, 15000)
}

// opened from the copy: once the server answers, take in what changed there
// meanwhile, then send what was queued here
async function reconnect() {
  if (connected || !backend) return
  let list
  try {
    list = await backend.list()
  } catch (e) {
    if (e instanceof AuthError) return problems.emit('problem', { message: 'Sign in again to send your changes. They are kept in this browser.' })
    return reconnectSoon()
  }
  const remote = new Map(list.map((f) => [f.path, f.sha]))
  const changes = []
  for (const [p, sha] of remote) {
    const have = queues.get(p)?.base?.sha ?? getState().tree[p]?.sha ?? null
    if (have !== sha) changes.push({ path: p, sha, deleted: false })
  }
  for (const [p, f] of Object.entries(getState().tree)) if (f.sha && !remote.has(p)) changes.push({ path: p, sha: null, deleted: true })
  goOnline()
  const treePaths = [...new Set([...getState().treePaths.filter((p) => remote.has(p) || queues.has(p)), ...remote.keys()])]
  setState({ treePaths, ...viewOf(getState().tree, treePaths, prefix) })
  await handleRemoteChange(changes)
  await getState().flushNow()
  updateSaving()
  fillCopy()
}

// what the app needs at the start, in every space (a path in the tree)
function isCore(full, handle) {
  const path = full.replace(SPACE_RE, '')
  if (path === 'lumen.json') return true
  if (LIST_RE.test(path) || CALENDAR_RE.test(path) || PLUGIN_RE.test(path) || IDEAS_RE.test(path)) return true
  if (handle && full === `users/${handle}/settings.json`) return true
  return false
}

function updateSaving() {
  let pending = 0
  for (const q of queues.values()) if (isDirty(q)) pending++
  const state = offline ? 'offline' : pending > 0 ? (saveError ? 'error' : 'saving') : 'saved'
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
  const delay = 400
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
      q.ops = q.ops.slice(opsCount)
      if (typeof result.text === 'string' && result.text !== text) {
        // the server settled the file (ids added, formatting); carry on from its version
        setFile(path, rebaseOnto(q, { text: result.text, sha: result.sha }), result.sha)
      } else q.base = { text, sha: result.sha }
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
    } else if (e instanceof RefusedError) {
      // the server won't take it: put its version back and say why
      queues.delete(path)
      if (q.base?.sha) setFile(path, q.base.text, q.base.sha)
      else removePath(path)
      offline = false
      updateSaving()
      problems.emit('problem', { message: e.message })
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
    if (!c.deleted && c.sha && (c.sha === q?.base?.sha || (!q && c.sha === getState().tree[c.path]?.sha))) continue
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
    if (!connected) return reconnect()
    offline = false
    for (const [path, q] of queues) if (isDirty(q)) doWrite(path, q)
    updateSaving()
  })
}
