// The workspace folder: list, read, write and delete text files, each with its
// git blob sha as its version. Keeps an index (path → sha, access meta) so
// listing is instant, notices edits made by other programs, and tells listeners
// about every change so they can reach browsers (ws.js) and git (git.js).
import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { MAX_FILE_BYTES } from './config.js'
import { metaOf } from './access.js'

export const events = new EventEmitter()
events.setMaxListeners(100)

let root = null
const index = new Map() // path → { sha, meta, size }
let watcher = null
let rescanTimer = null
let selfWrites = new Map() // path → sha we just wrote (so the watcher ignores them)

export const workspaceRoot = () => root

export const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')

const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|js|mjs|css|html|svg|ics|csv|yml|yaml)$/i
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
    else if (e.isFile() && (TEXT_EXT.test(e.name) || r === '.gitattributes')) out.push(r)
  }
  return out
}

async function indexFile(p) {
  try {
    const buf = await fs.readFile(abs(p))
    const entry = { sha: gitSha(buf), size: buf.length, meta: metaOf(p, buf.toString('utf8')) }
    index.set(p, entry)
    return entry
  } catch {
    index.delete(p)
    return null
  }
}

/** Reads the whole folder again; reports what changed since the last look */
export async function rescan({ quiet = false } = {}) {
  if (!root) return []
  const paths = await walk(root)
  const seen = new Set(paths)
  const changes = []
  for (const p of paths) {
    const before = index.get(p)?.sha
    const after = (await indexFile(p))?.sha
    if (after && after !== before) changes.push({ path: p, sha: after, deleted: false })
  }
  for (const p of [...index.keys()]) {
    if (!seen.has(p)) {
      index.delete(p)
      changes.push({ path: p, sha: null, deleted: true })
    }
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
      if (IGNORED.test(rel)) return
      clearTimeout(rescanTimer)
      rescanTimer = setTimeout(() => rescan().catch(() => {}), 400)
    })
    watcher.on('error', () => {})
  } catch {
    // no recursive watching here: edits by other programs show up on the next rescan (git sync)
  }
}

export async function openWorkspace(dir) {
  root = path.resolve(dir)
  await fs.mkdir(root, { recursive: true })
  index.clear()
  await rescan({ quiet: true })
  watch()
  events.emit('opened', root)
  return root
}

export function closeWorkspace() {
  watcher?.close()
  watcher = null
}

export const list = () => [...index.entries()].map(([p, e]) => ({ path: p, sha: e.sha, size: e.size, meta: e.meta }))
export const info = (p) => index.get(p) || null

export async function read(p) {
  try {
    const buf = await fs.readFile(abs(p))
    return { text: buf.toString('utf8'), sha: gitSha(buf) }
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return null
    throw e
  }
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
 * Writes `text` if the file is still at `baseSha` (null: it must not exist;
 * undefined: don't check). `check(currentText|null)` may throw to refuse.
 */
export function write(p, text, { baseSha, check, by } = {}) {
  return locked(p, async () => {
    const buf = Buffer.from(String(text), 'utf8')
    if (buf.length > MAX_FILE_BYTES) throw Object.assign(new Error('That file is too large.'), { status: 413 })
    const cur = await read(p)
    if (baseSha !== undefined && (cur?.sha ?? null) !== baseSha) throw new ConflictError(cur)
    if (check) await check(cur)
    const sha = gitSha(buf)
    if (cur?.sha === sha) return { sha, unchanged: true }
    await fs.mkdir(path.dirname(abs(p)), { recursive: true })
    const tmp = `${abs(p)}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, buf)
    await fs.rename(tmp, abs(p))
    selfWrites.set(p, sha)
    index.set(p, { sha, size: buf.length, meta: metaOf(p, String(text)) })
    events.emit('change', [{ path: p, sha, deleted: false }], { by })
    return { sha }
  })
}

export function append(p, text, { by } = {}) {
  return locked(p, async () => {
    await fs.mkdir(path.dirname(abs(p)), { recursive: true })
    await fs.appendFile(abs(p), text)
    const entry = await indexFile(p)
    events.emit('change', [{ path: p, sha: entry?.sha, deleted: false }], { by })
    return entry
  })
}

export function remove(p, { baseSha, check, by } = {}) {
  return locked(p, async () => {
    const cur = await read(p)
    if (!cur) return { deleted: false }
    if (baseSha !== undefined && cur.sha !== baseSha) throw new ConflictError(cur)
    if (check) await check(cur)
    await fs.rm(abs(p), { force: true })
    index.delete(p)
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
    events.emit('change', [{ path: p, sha: null, deleted: true }], { by })
    return { deleted: true }
  })
}
