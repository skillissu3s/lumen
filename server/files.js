// What people make, kept in the database and handed out as files. The rest of
// the server (and through it the app) still thinks in files: list, read, write
// and delete text files, each with its git blob sha as its version. Underneath,
// every file is stored as rows (store/units.js) and rendered back on the way out.
//
// Files live in spaces (docs/CANDLES.md): a person's candle, or a workspace.
// `space(id)` is one space's files. One space is the *home*: on the desktop the
// person's candle, on a server the workspace everyone shared before spaces. The
// module-level functions (list, read, write…) work on the home space, and only
// the home space has a folder: a workspace folder from before is imported into
// it on first start, and while git sync is on the folder is its working copy,
// written after every change, whose outside edits are taken back by rescan().
//
// Every change is announced as events.emit('change', changes, { space, by,
// external }), with paths inside that space; view.js turns them into each
// person's paths.

import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { MAX_FILE_BYTES } from './config.js'
import { metaOf } from './access.js'
import { db, setSetting } from './db.js'
import { createStore } from './store/records.js'
import { createUnits } from './store/units.js'
import * as spaces from './spaces.js'

export const events = new EventEmitter()
events.setMaxListeners(100)

export const store = createStore(db)

// owners are user ids in the database and handles in files
export const people = {
  idOf(handle) {
    const row = db.prepare('SELECT id FROM users WHERE handle = ?').get(handle)
    return row ? row.id : `handle:${handle}`
  },
  handleOf(id) {
    if (id.startsWith('handle:')) return id.slice(7)
    return db.prepare('SELECT handle FROM users WHERE id = ?').get(id)?.handle ?? id
  },
}

export const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')

const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|canvas|js|mjs|css|html|svg|ics|csv|yml|yaml)$/i
const IGNORED = /(^|\/)(\.git|node_modules|\.obsidian|\.trash|\.DS_Store)(\/|$)/

/** A path from a client, made safe: relative, forward slashes, no `..`, a text type */
export function cleanPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!s || s.length > 400) return null
  const parts = s.split('/')
  if (parts.some((x) => !x || x === '.' || x === '..' || /[\0<>:"|?*]/.test(x))) return null
  // git's merge rules: at the top, or a workspace's in a person's tree
  const attrs = parts[parts.length - 1] === '.gitattributes'
  if (IGNORED.test(s) && !attrs) return null
  if (!TEXT_EXT.test(s) && !attrs) return null
  return parts.join('/')
}

const entryOf = (p, text) => {
  const buf = Buffer.from(text, 'utf8')
  return { sha: gitSha(buf), size: buf.length, meta: metaOf(p, text) }
}

export class ConflictError extends Error {
  constructor(current) {
    super('The file changed since you loaded it')
    this.status = 409
    this.current = current
  }
}

// one write at a time per file, so a check-then-write can't interleave
const locks = new Map()
async function locked(key, fn) {
  const prev = locks.get(key) || Promise.resolve()
  let release
  const next = new Promise((r) => (release = r))
  locks.set(key, prev.then(() => next))
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === next) locks.delete(key)
  }
}

// ---------- spaces ----------

let homeId = null
const opened = new Map() // space id → its files

/** The files of one space */
export function space(id) {
  if (!id) throw new Error('No space.')
  return opened.get(id) || opened.set(id, openSpace(id)).get(id)
}

function openSpace(id) {
  // a candle's person owns everything in it, whatever a file says
  const owner = spaces.isCandle(id) ? spaces.get(id)?.owner_id || id.slice(2) : null
  const units = createUnits(store, people, { space: id, owner })
  const index = new Map() // path → { sha, size, meta }
  let indexed = false
  const isHome = () => id === homeId
  const emit = (changes, opts = {}) => events.emit('change', changes, { ...opts, space: id })

  function refresh(p) {
    const text = units.render(p)
    if (text == null) index.delete(p)
    else index.set(p, entryOf(p, text))
    return text
  }
  function reindex() {
    index.clear()
    for (const p of units.paths()) refresh(p)
    indexed = true
  }
  const ready = () => indexed || reindex()

  async function read(p) {
    const text = units.render(p)
    return text == null ? null : { text, sha: entryOf(p, text).sha }
  }

  /**
   * Stores `text` if the file is still at `baseSha` (null: it must not exist;
   * undefined: don't check). `check(currentText|null)` may throw to refuse.
   * Returns { sha, text }: the file as the database now renders it, which may
   * differ from `text` (ids added, formatting settled).
   */
  function write(p, text, { baseSha, check, by } = {}) {
    return locked(`${id}:${p}`, async () => {
      ready()
      if (Buffer.byteLength(String(text), 'utf8') > MAX_FILE_BYTES) throw Object.assign(new Error('That file is too large.'), { status: 413 })
      const cur = await read(p)
      if (baseSha !== undefined && (cur?.sha ?? null) !== baseSha) throw new ConflictError(cur)
      if (check) await check(cur)
      const out = units.save(p, String(text))
      refresh(p)
      const sha = index.get(p)?.sha ?? null
      if (cur?.sha === sha) return { sha, text: out, unchanged: true }
      if (isHome() && mirror && out != null) await writeToFolder(p, out)
      emit([{ path: p, sha, deleted: false }], { by })
      return { sha, text: out }
    })
  }

  /** Adds `text` to the end of the file (chat logs) */
  function append(p, text, { by } = {}) {
    return locked(`${id}:${p}`, async () => {
      ready()
      const cur = await read(p)
      const out = units.save(p, `${cur?.text ?? ''}${text}`)
      const entry = refresh(p) == null ? null : index.get(p)
      if (isHome() && mirror && out != null) await writeToFolder(p, out)
      emit([{ path: p, sha: entry?.sha ?? null, deleted: false }], { by })
      return entry
    })
  }

  function remove(p, { baseSha, check, by } = {}) {
    return locked(`${id}:${p}`, async () => {
      ready()
      const cur = await read(p)
      if (!cur) return { deleted: false }
      if (baseSha !== undefined && cur.sha !== baseSha) throw new ConflictError(cur)
      if (check) await check(cur)
      units.remove(p)
      index.delete(p)
      if (isHome() && mirror) await removeFromFolder(p)
      emit([{ path: p, sha: null, deleted: true }], { by })
      return { deleted: true }
    })
  }

  /**
   * Files from elsewhere ([[path, text]]: a folder, a GitHub repository) into
   * this space, in one transaction. Records are matched by id, so bringing in
   * the same files again adds nothing twice. Paths that aren't workspace files
   * are skipped. Returns how many files were taken in.
   */
  function importTexts(entries, { quiet = false } = {}) {
    ready()
    const texts = entries.filter(([p, text]) => cleanPath(p) === p && Buffer.byteLength(text, 'utf8') <= MAX_FILE_BYTES)
    const changes = []
    store.tx(() => {
      for (const [p, text] of texts) {
        const before = index.get(p)?.sha
        units.save(p, text)
        const after = refresh(p) == null ? null : index.get(p).sha
        if (after !== before) changes.push({ path: p, sha: after, deleted: after == null })
      }
    })
    if (changes.length && !quiet) emit(changes, { external: true })
    return texts.length
  }

  /** Re-renders everything and announces what changed (after edits that bypassed this module) */
  function settle({ external = true } = {}) {
    const before = new Map(index)
    reindex()
    const changes = []
    for (const [p, e] of index) if (before.get(p)?.sha !== e.sha) changes.push({ path: p, sha: e.sha, deleted: false })
    for (const p of before.keys()) if (!index.has(p)) changes.push({ path: p, sha: null, deleted: true })
    if (changes.length) emit(changes, { external })
    return changes
  }

  return {
    id,
    units,
    list: () => (ready(), [...index.entries()].map(([p, e]) => ({ path: p, sha: e.sha, size: e.size, meta: e.meta }))),
    info: (p) => (ready(), index.get(p) || null),
    read,
    write,
    append,
    remove,
    importTexts,
    settle,
    reindex,
    refresh,
    ready,
  }
}

export const home = () => {
  if (!homeId) throw new Error('The home space isn’t open yet.')
  return space(homeId)
}
export const homeSpaceId = () => homeId

// the home space's files, as before spaces
export const list = () => home().list()
export const info = (p) => home().info(p)
export const read = (p) => home().read(p)
export const write = (p, text, opts) => home().write(p, text, opts)
export const append = (p, text, opts) => home().append(p, text, opts)
export const remove = (p, opts) => home().remove(p, opts)
export const importTexts = (entries, opts) => home().importTexts(entries, opts)

// ---------- the home folder ----------

let root = null
let mirror = false // the folder is git sync's working copy
const exported = new Map() // path → sha last written to the folder
let watcher = null
let rescanTimer = null

export const workspaceRoot = () => root

const abs = (p) => path.join(root, ...p.split('/'))

async function walk(dir, rel = '') {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (IGNORED.test(r)) continue
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), r)))
    else if (e.isFile() && cleanPath(r)) out.push(r)
  }
  return out
}

async function writeToFolder(p, text) {
  const buf = Buffer.from(text, 'utf8')
  const sha = gitSha(buf)
  try {
    if (gitSha(await fs.readFile(abs(p))) === sha) {
      exported.set(p, sha)
      return
    }
  } catch {
    /* not there yet */
  }
  await fs.mkdir(path.dirname(abs(p)), { recursive: true })
  const tmp = `${abs(p)}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, abs(p))
  exported.set(p, sha)
}

async function removeFromFolder(p) {
  exported.delete(p)
  await fs.rm(abs(p), { force: true })
  // tidy up folders left empty
  let dir = path.dirname(abs(p))
  while (dir.startsWith(root) && dir !== root) {
    try {
      await fs.rmdir(dir)
    } catch {
      break
    }
    dir = path.dirname(dir)
  }
}

/** Every file of `dir` into the home space (see importTexts) */
export async function importFolder(dir, { quiet = false } = {}) {
  const entries = []
  for (const p of await walk(dir)) entries.push([p, await fs.readFile(path.join(dir, ...p.split('/')), 'utf8')])
  return importTexts(entries, { quiet })
}

/**
 * The folder becomes git sync's working copy (on) or is left alone (off).
 * Turning it on writes everything the home space holds into the folder, after
 * taking in any file there that it doesn't have yet.
 */
export async function setMirror(on) {
  if (on && mirror) return
  mirror = !!on && !!root
  if (!mirror) {
    watcher?.close()
    watcher = null
    return
  }
  const h = home()
  const there = await walk(root)
  const missing = there.filter((p) => !h.info(p))
  if (missing.length) {
    const texts = await Promise.all(missing.map(async (p) => [p, await fs.readFile(abs(p), 'utf8')]))
    store.tx(() => {
      for (const [p, text] of texts) {
        h.units.save(p, text)
        h.refresh(p)
      }
    })
  }
  for (const f of h.list()) await writeToFolder(f.path, h.units.render(f.path))
  watch()
}

/** While the folder is a mirror: takes in what changed there (a git pull, another editor) */
export async function rescan({ quiet = false } = {}) {
  if (!root || !mirror) return []
  const h = home()
  const paths = await walk(root)
  const seen = new Set(paths)
  const changes = []
  for (const p of paths) {
    const buf = await fs.readFile(abs(p))
    if (exported.get(p) === gitSha(buf)) continue
    const before = h.info(p)?.sha
    const text = h.units.save(p, buf.toString('utf8'))
    h.refresh(p)
    // the folder gets the settled form back, so it matches the database
    if (text != null) await writeToFolder(p, text)
    const after = h.info(p)?.sha ?? null
    if (after !== before) changes.push({ path: p, sha: after, deleted: after == null })
  }
  for (const p of [...exported.keys()]) {
    if (seen.has(p)) continue
    h.units.remove(p)
    h.refresh(p)
    exported.delete(p)
    changes.push({ path: p, sha: null, deleted: true })
  }
  if (changes.length && !quiet) events.emit('change', changes, { external: true, space: homeId })
  return changes
}

function watch() {
  watcher?.close()
  watcher = null
  try {
    watcher = fss.watch(root, { recursive: true }, (type, name) => {
      if (!name) return
      const rel = String(name).replace(/\\/g, '/')
      if (IGNORED.test(rel) || rel.endsWith('.tmp')) return
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(() => rescan().catch(() => {}), 400)
    })
    watcher.on('error', () => {})
  } catch {
    // no recursive watching here: outside edits show up on the next rescan (git sync)
  }
}

/**
 * Opens the home space (`homeId`) and its folder: `dir` is where a workspace
 * was kept before the database. If the database holds nothing yet, that
 * folder is imported into the home space.
 */
export async function openWorkspace(dir, id) {
  homeId = id
  root = path.resolve(dir)
  await fs.mkdir(root, { recursive: true })
  const h = home()
  h.reindex()
  if (store.isEmpty()) {
    const n = await importFolder(root, { quiet: true })
    if (n) setSetting('store.imported', { dir: root, files: n, at: new Date().toISOString() })
  }
  await setMirror(false)
  events.emit('opened', root)
  return root
}

export function closeWorkspace() {
  watcher?.close()
  watcher = null
}

/** Forgets what was rendered (after a migration rewrote rows underneath) */
export function reopenAll() {
  for (const s of opened.values()) s.reindex()
}

/**
 * Someone's handle changed. Owners are user ids, so what they own renders with
 * the new handle by itself (and files named after it, like
 * users/<handle>/settings.json, move); the places that keep handles as text
 * follow here: sharing lists, channel members and creators, message authors.
 * `apply` changes the account, in the same transaction.
 */
export async function renameHandle(from, to, apply) {
  // sharing lists hold `handle` or `handle:view`; channel members bare handles
  const rename = (list) => {
    if (!Array.isArray(list)) return null
    const swap = (entry) => {
      const [h, ...rest] = String(entry).split(':')
      return h === from ? [to, ...rest].join(':') : entry
    }
    const next = list.map(swap)
    return next.some((e, i) => e !== list[i]) ? next : null
  }
  store.tx(() => {
    apply()
    for (const type of ['board', 'calendar', 'doc', 'idea_board']) {
      for (const r of store.all(type)) {
        const share = rename(r.share)
        if (share) store.write(type, { id: r.id, share })
      }
    }
    for (const c of store.all('channel')) {
      const members = rename(c.members)
      if (members || c.created_by === from) store.write('channel', { id: c.id, ...(members ? { members } : {}), ...(c.created_by === from ? { created_by: to } : {}) })
    }
    for (const m of store.where('message', 'author', from)) store.write('message', { id: m.id, author: to })
  })
  const changes = []
  for (const s of opened.values()) {
    const moved = s.settle()
    if (s.id === homeId && mirror) for (const c of moved) await (c.deleted ? removeFromFolder(c.path) : writeToFolder(c.path, s.units.render(c.path)))
    changes.push(...moved)
  }
  events.emit('renamed', { from, to })
  return changes
}
