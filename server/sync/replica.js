// The desktop app signed in to a Lumen server: this computer's database is a
// copy of the account's data that works offline, kept in step with the server.
// The window always talks to the local server; this module carries changes both
// ways, through the server's file API (which checks who may read and write
// what, and gives every file a version).
//
// For every file it remembers the last version both sides agreed on (`base`).
// A round compares each side with it: a file changed on one side is copied to
// the other; changed on both, it is merged record by record (sync/merge.js);
// one the two can't combine keeps this computer's version beside the server's.
// Rounds run on start, a moment after a change here, and every half minute.

import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { db, getSetting, setSetting } from '../db.js'
import { DATA_DIR, decrypt, encrypt } from '../config.js'
import * as files from '../files.js'
import { merge3, copyPath } from './merge.js'

export const cloudEvents = new EventEmitter()

db.exec(`CREATE TABLE IF NOT EXISTS sync_files (
  path TEXT PRIMARY KEY,
  base TEXT NOT NULL,
  remote_sha TEXT,
  local_sha TEXT
)`)

const EVERY = 30000
const SETTLE = 1500
let timer = null
let soon = null
let running = null
let again = false
let pending = null // a sign-in waiting for the person's choice: { server, token, user }
let status = { state: 'off', lastSync: null, lastError: null, conflicts: [], refused: [] }

const config = () => getSetting('cloud')
const tokenOf = (cfg) => (cfg?.token ? decrypt(cfg.token) : null)

function setStatus(patch) {
  status = { ...status, ...patch }
  cloudEvents.emit('status', publicStatus())
}

/** What the app may know: where it's signed in, as whom, and how syncing goes */
export function publicStatus() {
  const cfg = config()
  return cfg ? { linked: true, server: cfg.server, user: cfg.user, ...status } : { linked: false, state: 'off' }
}

// ---------- talking to the server ----------

class RemoteError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function call(server, token, method, url, body) {
  let res
  try {
    res = await fetch(`${server}/api${url}`, {
      method,
      headers: {
        'X-Lumen': '1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Cookie: `lumen_session=${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw new RemoteError('offline', 0)
  }
  let json = null
  try {
    json = await res.json()
  } catch {
    /* no body */
  }
  if (!res.ok) throw new RemoteError(json?.error || `The server answered ${res.status}.`, res.status, json)
  const cookie = (res.headers.getSetCookie?.() || []).map((c) => /^lumen_session=([^;]+)/.exec(c)).find(Boolean)
  return { json, token: cookie ? cookie[1] : null }
}

const remote = (method, url, body) => {
  const cfg = config()
  return call(cfg.server, tokenOf(cfg), method, url, body).then((r) => r.json)
}

// ---------- signing in ----------

// the same account on the same server again (a session that ran out): sync
// carries on from where it was, with nothing to choose
const resuming = (server, user) => {
  const cfg = config()
  return !!cfg && cfg.server === server && cfg.user?.id === user.id
}

function signedIn(server, r) {
  if (!r.token || !r.json?.user) throw new RemoteError('The server didn’t sign you in.', 502)
  pending = { server, token: r.token, user: r.json.user }
  const resume = resuming(server, r.json.user)
  return { user: r.json.user, resume, hasOwnData: !resume && hasOwnData() }
}

/** Email and password → { user, hasOwnData } or, for admins, { needsCode, challenge, email } */
export async function login({ server, email, password }) {
  const r = await call(server, null, 'POST', '/login', { email, password })
  if (r.json?.needsCode) return { needsCode: true, challenge: r.json.challenge, email: r.json.email }
  return signedIn(server, r)
}

/** The code an admin was emailed */
export async function verify({ server, challenge, code }) {
  return signedIn(server, await call(server, null, 'POST', '/login/verify', { challenge, code }))
}

/** Has anyone made anything on this computer (beyond the starter workspace)? */
export function hasOwnData() {
  return !!getSetting('local.touched') || (getSetting('store.imported')?.files || 0) > 0
}

files.events.on('change', (changes, opts) => {
  if (!opts?.by || ['seed', 'sync'].includes(opts.by)) return
  if (!getSetting('local.touched')) setSetting('local.touched', true)
  if (config()) {
    clearTimeout(soon)
    soon = setTimeout(() => syncNow().catch(() => {}), SETTLE)
  }
})

// every file this computer holds, written to a folder, before anything is replaced
async function backup() {
  const dir = path.join(DATA_DIR, 'backups', new Date().toISOString().replace(/[:.]/g, '-'))
  for (const f of files.list()) {
    const r = await files.read(f.path)
    if (!r) continue
    const to = path.join(dir, ...f.path.split('/'))
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, r.text)
  }
  return dir
}

/**
 * Finishes signing in. `keep`: 'both' adds this computer's data to the
 * account's; 'server' keeps only the account's (this computer's is backed up
 * to a folder first).
 */
export async function link({ keep = 'server' } = {}) {
  if (!pending) throw new RemoteError('Sign in first.', 400)
  const { server, token, user } = pending
  pending = null
  let backedUp = null
  if (!resuming(server, user)) {
    if (keep === 'server') {
      backedUp = await backup()
      for (const f of files.list()) await files.remove(f.path, { by: 'sync' })
    }
    db.exec('DELETE FROM sync_files')
  }
  // the person here is the account's person, so what they make here is theirs there
  const local = db.prepare("SELECT id FROM users WHERE email = 'local@lumen.desktop'").get()
  if (local) db.prepare('UPDATE users SET handle = ?, name = ? WHERE id = ?').run(user.handle, user.name, local.id)
  setSetting('cloud', { server, token: encrypt(token), user, linkedAt: new Date().toISOString() })
  setSetting('desktop.mode', { mode: 'cloud', server })
  status = { state: 'idle', lastSync: null, lastError: null, conflicts: [], refused: [] }
  start()
  await syncNow()
  return { ...publicStatus(), backedUp }
}

/** Signs out of the server; this computer keeps its copy, now on its own */
export async function unlink() {
  stop()
  if (config()) await remote('POST', '/logout').catch(() => {})
  setSetting('cloud', null)
  setSetting('cloud.spaces', null)
  setSetting('desktop.mode', { mode: 'local' })
  db.exec('DELETE FROM sync_files')
  status = { state: 'off', lastSync: null, lastError: null, conflicts: [], refused: [] }
  cloudEvents.emit('status', publicStatus())
}

// ---------- a round ----------

const baseOf = (p) => db.prepare('SELECT * FROM sync_files WHERE path = ?').get(p) || null
const saveBase = (p, base, remoteSha, localSha) =>
  db.prepare('INSERT INTO sync_files (path, base, remote_sha, local_sha) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET base = excluded.base, remote_sha = excluded.remote_sha, local_sha = excluded.local_sha').run(p, base, remoteSha, localSha)
const dropBase = (p) => db.prepare('DELETE FROM sync_files WHERE path = ?').run(p)

async function writeLocal(p, text) {
  await files.write(p, text, { by: 'sync' })
  return files.info(p)?.sha ?? null
}

async function readRemote(paths) {
  const out = {}
  for (let i = 0; i < paths.length; i += 200) Object.assign(out, (await remote('POST', '/files/read', { paths: paths.slice(i, i + 200) })).files)
  return out
}

// sends a version to the server (this computer's, or a merge); the server may
// settle it (ids, formatting), and this computer then takes what the server has
async function push(p, text, baseSha) {
  const r = await remote('PUT', '/files', { path: p, text, sha: baseSha })
  const settled = r.text ?? text
  const here = await files.read(p)
  const localSha = here?.text === settled ? here.sha : await writeLocal(p, settled)
  saveBase(p, settled, r.sha, localSha)
}

async function round() {
  // the account's spaces, so the app here can move between them (docs/CANDLES.md)
  setSetting('cloud.spaces', await remote('GET', '/spaces').catch(() => getSetting('cloud.spaces')))
  const theirs = new Map((await remote('GET', '/files')).files.map((f) => [f.path, f.sha]))
  const ours = new Map(files.list().map((f) => [f.path, f.sha]))
  const paths = [...new Set([...theirs.keys(), ...ours.keys()])].sort()
  const plan = []
  for (const p of paths) {
    const b = baseOf(p)
    const rsha = theirs.get(p) ?? null
    const lsha = ours.get(p) ?? null
    const remoteChanged = rsha !== (b?.remote_sha ?? null)
    const localChanged = lsha !== (b?.local_sha ?? null)
    if (remoteChanged || localChanged) plan.push({ p, b, rsha, lsha, remoteChanged, localChanged })
  }
  if (!plan.length) return { changed: 0 }
  const texts = await readRemote(plan.filter((x) => x.rsha && x.remoteChanged).map((x) => x.p))
  const conflicts = []
  const refused = []
  for (const { p, b, rsha, lsha, remoteChanged, localChanged } of plan) {
    try {
      const rtext = rsha ? texts[p]?.text ?? null : null
      if (remoteChanged && !localChanged) {
        if (rsha && rtext != null) saveBase(p, rtext, rsha, await writeLocal(p, rtext))
        else if (!rsha) {
          await files.remove(p, { by: 'sync' })
          dropBase(p)
        }
      } else if (localChanged && !remoteChanged) {
        if (lsha) await push(p, (await files.read(p)).text, b?.remote_sha ?? null)
        else if (b?.remote_sha) {
          await remote('DELETE', '/files', { path: p, sha: b.remote_sha })
          dropBase(p)
        } else dropBase(p)
      } else {
        // changed on both sides
        const ltext = lsha ? (await files.read(p)).text : null
        if (ltext == null && rtext == null) dropBase(p)
        else if (ltext == null) saveBase(p, rtext, rsha, await writeLocal(p, rtext)) // deleted here, changed there: kept
        else if (rtext == null) await push(p, ltext, null) // deleted there, changed here: kept
        else {
          const m = merge3(p, b?.base ?? '', ltext, rtext)
          if (m.conflict) conflicts.push(p)
          if (m.copy) {
            // can't be combined: this computer's version goes beside the server's
            await files.write(copyPath(p), ltext, { by: 'sync-copy' })
            saveBase(p, rtext, rsha, await writeLocal(p, rtext))
          } else await push(p, m.text, rsha)
        }
      }
    } catch (e) {
      if (e.status === 409) again = true // it moved on the server meanwhile: the next round merges it
      else if (e.status === 403 && rsha && /^(workspaces|shared)\//.test(p)) {
        // someone else's space (shared to view, or settings for its admins): theirs comes back
        refused.push({ path: p, reason: e.message })
        const text = texts[p]?.text ?? (await readRemote([p]))[p]?.text
        if (text != null) saveBase(p, text, rsha, await writeLocal(p, text))
      } else if (e.status === 403 || e.status === 404 || e.status === 400 || e.status === 413) {
        // the server won't take this change (not yours to change, gone, too big…): it stays here only
        refused.push({ path: p, reason: e.message })
        saveBase(p, b?.base ?? '', b?.remote_sha ?? null, lsha)
      } else throw e
    }
  }
  return { changed: plan.length, conflicts, refused }
}

/** One round now (or right after the one running) */
export function syncNow() {
  if (!config()) return Promise.resolve(publicStatus())
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    setStatus({ state: 'syncing' })
    try {
      do {
        again = false
        const r = await round()
        setStatus({
          state: 'idle',
          lastSync: new Date().toISOString(),
          lastError: null,
          ...(r.conflicts?.length ? { conflicts: r.conflicts } : {}),
          ...(r.refused?.length ? { refused: r.refused } : {}),
        })
      } while (again)
    } catch (e) {
      if (e.status === 401) setStatus({ state: 'signed-out', lastError: 'Your session on the server ended. Sign in again.' })
      else if (e.status === 0) setStatus({ state: 'offline', lastError: null })
      else setStatus({ state: 'error', lastError: e.message })
    } finally {
      running = null
    }
    return publicStatus()
  })()
  return running
}

export function start() {
  if (!config() || timer) return
  timer = setInterval(() => syncNow().catch(() => {}), EVERY)
  syncNow().catch(() => {})
}

export function stop() {
  clearInterval(timer)
  timer = null
  clearTimeout(soon)
  soon = null
}
