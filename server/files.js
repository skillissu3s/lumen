// The workspace, kept in the database. The rest of the server (and through it
// the app) still thinks in files: list, read, write and delete text files, each
// with its git blob sha as its version. Underneath, every file is stored as rows
// (store/units.js) and rendered back on the way out, so nothing is kept as a
// file on disk.
//
// The folder still matters in two places: a workspace folder from before is
// imported into the database on first start (and left where it was, as a
// backup), and while git sync is on the folder is its working copy: a mirror
// of the database, written after every change, whose outside edits (a git pull)
// are taken back in by rescan().

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

export const events = new EventEmitter()
events.setMaxListeners(100)

export const store = createStore(db)

// owners are user ids in the database and handles in files
const people = {
  idOf(handle) {
    const row = db.prepare('SELECT id FROM users WHERE handle = ?').get(handle)
    return row ? row.id : `handle:${handle}`
  },
  handleOf(id) {
    if (id.startsWith('handle:')) return id.slice(7)
    return db.prepare('SELECT handle FROM users WHERE id = ?').get(id)?.handle ?? id
  },
}
const units = createUnits(store, people)

let root = null
let mirror = false // the folder is git sync's working copy
const index = new Map() // path → { sha, size, meta }
const exported = new Map() // path → sha last written to the folder
let watcher = null
let rescanTimer = null

export const workspaceRoot = () => root

export const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')

const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|canvas|js|mjs|css|html|svg|ics|csv|yml|yaml)$/i
const IGNORED = /(^|\/)(\.git|node_modules|\.obsidian|\.trash|\.DS_Store)(\/|$)/

/** A path from a client, made safe: relative, forward slashes, no `..`, a text type */
export function cleanPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!s || s.length > 400) return null
  const parts = s.split('/')
  if (parts.some((x) => !x || x === '.' || x === '..' || /[\0<>:"|?*]/.test(x))) return null
  if (IGNORED.test(s) && s !== '.gitattributes') return null
  if (!TEXT_EXT.test(s) && s !== '.gitattributes') return null
  return parts.join('/')
}

const entryOf = (p, text) => {
  const buf = Buffer.from(text, 'utf8')
  return { sha: gitSha(buf), size: buf.length, meta: metaOf(p, text) }
}

function refresh(p) {
  const text = units.render(p)
  if (text == null) index.delete(p)
  else index.set(p, entryOf(p, text))
  return text
}

function reindex() {
  index.clear()
  for (const p of units.paths()) refresh(p)
}

export const list = () => [...index.entries()].map(([p, e]) => ({ path: p, sha: e.sha, size: e.size, meta: e.meta }))
export const info = (p) => index.get(p) || null

export async function read(p) {
  const text = units.render(p)
  return text == null ? null : { text, sha: entryOf(p, text).sha }
}

export class ConflictError extends Error {
  constructor(current) {
    super('The file changed since you loaded it')
    this.status = 409
    this.current = current
  }
}

// ---------- the folder ----------

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

/**
 * Files from elsewhere ([[path, text]]: a folder, a GitHub repository) into the
 * database, in one transaction. Records are matched by id, so bringing in the
 * same files again adds nothing twice. Paths that aren't workspace files are
 * skipped. Returns how many files were taken in.
 */
export function importTexts(entries, { quiet = false } = {}) {
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
  if (changes.length && !quiet) events.emit('change', changes, { external: true })
  return texts.length
}

/** Every file of `dir` into the database (see importTexts) */
export async function importFolder(dir, { quiet = false } = {}) {
  const entries = []
  for (const p of await walk(dir)) entries.push([p, await fs.readFile(path.join(dir, ...p.split('/')), 'utf8')])
  return importTexts(entries, { quiet })
}

/**
 * The folder becomes git sync's working copy (on) or is left alone (off).
 * Turning it on writes everything the database holds into the folder, after
 * taking in any file there that the database doesn't have yet.
 */
export async function setMirror(on) {
  if (on && mirror) return
  mirror = !!on && !!root
  if (!mirror) {
    watcher?.close()
    watcher = null
    return
  }
  const there = await walk(root)
  const missing = there.filter((p) => !index.has(p))
  if (missing.length) {
    const texts = await Promise.all(missing.map(async (p) => [p, await fs.readFile(abs(p), 'utf8')]))
    store.tx(() => {
      for (const [p, text] of texts) {
        units.save(p, text)
        refresh(p)
      }
    })
  }
  for (const [p] of index) await writeToFolder(p, units.render(p))
  watch()
}

/** While the folder is a mirror: takes in what changed there (a git pull, another editor) */
export async function rescan({ quiet = false } = {}) {
  if (!root || !mirror) return []
  const paths = await walk(root)
  const seen = new Set(paths)
  const changes = []
  for (const p of paths) {
    const buf = await fs.readFile(abs(p))
    if (exported.get(p) === gitSha(buf)) continue
    const before = index.get(p)?.sha
    const text = units.save(p, buf.toString('utf8'))
    refresh(p)
    // the folder gets the settled form back, so it matches the database
    if (text != null) await writeToFolder(p, text)
    const after = index.get(p)?.sha ?? null
    if (after !== before) changes.push({ path: p, sha: after, deleted: after == null })
  }
  for (const p of [...exported.keys()]) {
    if (seen.has(p)) continue
    units.remove(p)
    index.delete(p)
    exported.delete(p)
    changes.push({ path: p, sha: null, deleted: true })
  }
  if (changes.length && !quiet) events.emit('change', changes, { external: true })
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
 * Opens the workspace: `dir` is the folder a workspace was kept in before the
 * database. If the database holds nothing yet, that folder is imported.
 */
export async function openWorkspace(dir) {
  root = path.resolve(dir)
  await fs.mkdir(root, { recursive: true })
  reindex()
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

// ---------- writing ----------

// one write at a time per file, so a check-then-write can't interleave
const locks = new Map()
async function locked(p, fn) {
  const prev = locks.get(p) || Promise.resolve()
  let release
  const next = new Promise((r) => (release = r))
  locks.set(p, prev.then(() => next))
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(p) === next) locks.delete(p)
  }
}

/**
 * Stores `text` if the file is still at `baseSha` (null: it must not exist;
 * undefined: don't check). `check(currentText|null)` may throw to refuse.
 * Returns { sha, text }: the file as the database now renders it, which may
 * differ from `text` (ids added, formatting settled).
 */
export function write(p, text, { baseSha, check, by } = {}) {
  return locked(p, async () => {
    if (Buffer.byteLength(String(text), 'utf8') > MAX_FILE_BYTES) throw Object.assign(new Error('That file is too large.'), { status: 413 })
    const cur = await read(p)
    if (baseSha !== undefined && (cur?.sha ?? null) !== baseSha) throw new ConflictError(cur)
    if (check) await check(cur)
    const out = units.save(p, String(text))
    refresh(p)
    const sha = index.get(p)?.sha ?? null
    if (cur?.sha === sha) return { sha, text: out, unchanged: true }
    if (mirror && out != null) await writeToFolder(p, out)
    events.emit('change', [{ path: p, sha, deleted: false }], { by })
    return { sha, text: out }
  })
}

/** Adds `text` to the end of the file (chat logs) */
export function append(p, text, { by } = {}) {
  return locked(p, async () => {
    const cur = await read(p)
    const out = units.save(p, `${cur?.text ?? ''}${text}`)
    const entry = refresh(p) == null ? null : index.get(p)
    if (mirror && out != null) await writeToFolder(p, out)
    events.emit('change', [{ path: p, sha: entry?.sha ?? null, deleted: false }], { by })
    return entry
  })
}

export function remove(p, { baseSha, check, by } = {}) {
  return locked(p, async () => {
    const cur = await read(p)
    if (!cur) return { deleted: false }
    if (baseSha !== undefined && cur.sha !== baseSha) throw new ConflictError(cur)
    if (check) await check(cur)
    units.remove(p)
    index.delete(p)
    if (mirror) await removeFromFolder(p)
    events.emit('change', [{ path: p, sha: null, deleted: true }], { by })
    return { deleted: true }
  })
}
