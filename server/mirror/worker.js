// The GitHub mirror's worker: the connections people made (which repository,
// which branch, when), and the timer that runs them. Each run is mirror/run.js;
// this module decides when, keeps what a run leaves behind (cursor, index,
// commit, errors) and pauses a connection when a person has to act.

import crypto from 'node:crypto'
import { covers, runMirror } from './run.js'
import { FULL_EVERY, afterChange, backoff, cleanSchedule, nextRun } from './schedule.js'

const MIN = 60000
const LOCK = 15 * MIN
const KEEP_RUNS = 20

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_connections (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  scope TEXT NOT NULL,
  space TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  repo_name TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  prefix TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL,
  schedule TEXT,
  allow_public INTEGER NOT NULL DEFAULT 0,
  adopt INTEGER NOT NULL DEFAULT 0,
  cursor INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  first_change_at INTEGER,
  last_run_at INTEGER,
  last_full_at INTEGER,
  last_commit TEXT,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  paused TEXT,
  locked_until INTEGER,
  index_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_drift (
  connection_id TEXT NOT NULL,
  path TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, path)
);
CREATE TABLE IF NOT EXISTS sync_runs (
  connection_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  from_cursor INTEGER NOT NULL,
  to_cursor INTEGER,
  full INTEGER NOT NULL DEFAULT 0,
  written INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS sync_runs_conn ON sync_runs (connection_id, started_at);
`

// failures that only the person can fix: GitHub refuses the token for this repository
const LOST = new Set([401, 403, 404])
const lostMessage = 'GitHub refused the token for this repository. It may have expired or been revoked, or the repository was deleted. Add a new token.'

/**
 * `ctx`: { db, store, units (or unitsFor(space)), events, users: { get(id) → { handle, role } },
 *          source, app, clock }
 * `repoFor(conn)` → the gh interface for a connection (github/repo.js). The
 * connection's `token` is stored as given (the routes encrypt it).
 */
export function createWorker(ctx, repoFor) {
  const { db, store, units, events, clock = () => Date.now() } = ctx
  db.exec(SCHEMA)
  if (!db.prepare('PRAGMA table_info(sync_connections)').all().some((c) => c.name === 'space')) db.exec("ALTER TABLE sync_connections ADD COLUMN space TEXT NOT NULL DEFAULT ''")
  // a connection mirrors one space (docs/CANDLES.md); one made before spaces, the old scopes
  const unitsOf = (c) => (c.space && ctx.unitsFor ? ctx.unitsFor(c.space) : units)
  const running = new Map() // id → promise
  let timer = null

  const row = (id) => db.prepare('SELECT * FROM sync_connections WHERE id = ?').get(id)
  const decode = (r) => r && { ...r, schedule: r.schedule ? JSON.parse(r.schedule) : null }
  const get = (id) => decode(row(id))
  const set = (id, fields) => {
    const keys = Object.keys(fields)
    if (!keys.length) return
    db.prepare(`UPDATE sync_connections SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id)
  }

  function mirrorConn(c) {
    const u = ctx.users.get(c.owner)
    return {
      owner: c.owner,
      ownerHandle: u?.handle || '',
      admin: u?.role === 'admin',
      scope: c.space ? 'workspace' : c.scope,
      space: c.space || undefined,
      branch: c.branch,
      prefix: c.prefix,
      repoId: c.repo_id,
      allowPublic: !!c.allow_public,
      adopt: !!c.adopt,
      cursor: c.cursor,
      index: c.index_json ? new Map(JSON.parse(c.index_json).map((e) => [e.path, e])) : null,
    }
  }

  // journal rows after `cursor` that this connection's mirror holds
  function pending(c, cursor = c.cursor) {
    if (c.space) return store.changesSince(cursor, { space: c.space, limit: 1 }).length > 0
    const admin = ctx.users.get(c.owner)?.role === 'admin'
    for (const j of store.changesSince(cursor, { limit: 2000 })) {
      if (c.scope === 'workspace' || j.owner === c.owner || (j.owner === '' && admin)) {
        if (c.scope === 'owner' && (j.root_type === 'chat_month' || j.root_type === 'channel')) continue
        return true
      }
    }
    return false
  }

  // ---------- connections ----------

  function create(owner, { token, repo, branch, prefix, scope, space = '', mode, schedule, allowPublic, adopt }) {
    const id = `gh_${crypto.randomBytes(8).toString('hex')}`
    const now = clock()
    db.prepare(
      `INSERT INTO sync_connections (id, owner, scope, space, token, repo_id, repo_name, branch, prefix, mode, schedule, allow_public, adopt, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, owner, scope || 'workspace', space, token, Number(repo.id), repo.fullName, branch, prefix, mode, schedule ? JSON.stringify(schedule) : null, allowPublic ? 1 : 0, adopt ? 1 : 0, now, now)
    // due now: the first run is a full pass, whatever the mode
    return get(id)
  }

  /** Changes what the person may change; a new branch or folder starts the mirror afresh */
  function update(id, patch) {
    const c = get(id)
    if (!c) return null
    const f = {}
    if (patch.mode !== undefined) {
      f.mode = patch.mode
      const s = cleanSchedule(patch.mode, patch.schedule)
      f.schedule = s ? JSON.stringify(s) : null
    }
    if (patch.allowPublic !== undefined) f.allow_public = patch.allowPublic ? 1 : 0
    if (patch.adopt) f.adopt = 1
    if (patch.token) f.token = patch.token
    if ((patch.branch !== undefined && patch.branch !== c.branch) || (patch.prefix !== undefined && patch.prefix !== c.prefix)) {
      Object.assign(f, { branch: patch.branch ?? c.branch, prefix: patch.prefix ?? c.prefix, index_json: null, cursor: 0, last_full_at: null, next_run_at: clock() })
    }
    if (patch.resume || patch.allowPublic || patch.adopt || patch.token) Object.assign(f, { paused: null, failures: 0, last_error: null, next_run_at: clock() })
    set(id, f)
    const after = get(id)
    if (!after.paused && f.mode !== undefined && after.index_json) {
      set(id, { next_run_at: after.mode === 'after-changes' ? (pending(after) ? clock() : null) : nextRun(after, clock()), first_change_at: null })
    }
    return get(id)
  }

  function remove(id) {
    db.prepare('DELETE FROM sync_connections WHERE id = ?').run(id)
    db.prepare('DELETE FROM sync_drift WHERE connection_id = ?').run(id)
    db.prepare('DELETE FROM sync_runs WHERE connection_id = ?').run(id)
  }

  const list = (owner) => db.prepare('SELECT * FROM sync_connections WHERE owner = ? ORDER BY created_at').all(owner).map(decode)
  const drift = (id) => db.prepare('SELECT path FROM sync_drift WHERE connection_id = ? ORDER BY path').all(id).map((r) => r.path)
  const runs = (id, n = 5) => db.prepare('SELECT * FROM sync_runs WHERE connection_id = ? ORDER BY started_at DESC LIMIT ?').all(id, n)

  // ---------- running ----------

  /** Runs one connection now (or joins the run already going) */
  function run(id, { full = false } = {}) {
    if (running.has(id)) return running.get(id)
    const p = runOnce(id, full).finally(() => running.delete(id))
    running.set(id, p)
    return p
  }

  async function runOnce(id, full) {
    const now = clock()
    const took = db.prepare('UPDATE sync_connections SET locked_until = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)').run(now + LOCK, id, now)
    if (!took.changes) return get(id) // another worker has it
    const c = get(id)
    const whole = full || !c.index_json || !c.last_full_at || now - c.last_full_at > FULL_EVERY
    let result = null
    let error = null
    try {
      result = await runMirror({ store, units: unitsOf(c), app: ctx.app, source: ctx.source, clock }, mirrorConn(c), repoFor(c), { full: whole })
    } catch (e) {
      error = e
    }
    const done = clock()
    if (result) {
      const f = {
        cursor: result.cursor,
        index_json: JSON.stringify([...result.index.values()]),
        last_run_at: done,
        last_error: result.failed.length ? `${result.failed.length} file${result.failed.length === 1 ? '' : 's'} couldn’t be written: ${result.failed.map((x) => x.path).join(', ')}` : null,
        failures: 0,
        paused: null,
        locked_until: null,
        ...(result.commit ? { last_commit: result.commit } : {}),
        ...(whole ? { last_full_at: done } : {}),
      }
      const next = { ...c, ...f }
      if (c.mode === 'after-changes') {
        // changes that came in while it ran start the wait again
        const more = pending(next, result.cursor)
        Object.assign(f, more ? afterChange({ ...next, first_change_at: null }, done) : { first_change_at: null, next_run_at: null })
      } else f.next_run_at = nextRun(next, done)
      set(id, f)
      if (whole) {
        db.prepare('DELETE FROM sync_drift WHERE connection_id = ?').run(id)
        for (const p of result.drift) db.prepare('INSERT INTO sync_drift (connection_id, path, seen_at) VALUES (?, ?, ?)').run(id, p, done)
      }
    } else if (error.pause || LOST.has(error.status)) {
      set(id, { paused: error.pause ? error.message : lostMessage, next_run_at: null, locked_until: null, last_error: null })
    } else {
      const failures = c.failures + 1
      set(id, { failures, last_error: error.message, next_run_at: done + backoff(failures), locked_until: null })
    }
    db.prepare('INSERT INTO sync_runs (connection_id, started_at, finished_at, from_cursor, to_cursor, full, written, removed, commit_sha, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      now,
      done,
      c.cursor,
      result?.cursor ?? null,
      whole ? 1 : 0,
      result ? result.written.length : 0,
      result ? result.removed.length : 0,
      result?.commit ?? null,
      error ? error.message : null,
    )
    db.prepare('DELETE FROM sync_runs WHERE connection_id = ? AND started_at NOT IN (SELECT started_at FROM sync_runs WHERE connection_id = ? ORDER BY started_at DESC LIMIT ?)').run(id, id, KEEP_RUNS)
    if (error && !error.pause && !LOST.has(error.status) && !error.status) console.error('[mirror]', id, error)
    return get(id)
  }

  /** Every connection that is due, one after another */
  async function tick() {
    const due = db.prepare('SELECT id FROM sync_connections WHERE paused IS NULL AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(clock())
    for (const { id } of due) await run(id)
  }

  // a change to what an after-changes connection holds moves its next run
  function onChange(changes, opts = {}) {
    const conns = db.prepare("SELECT * FROM sync_connections WHERE mode = 'after-changes' AND paused IS NULL").all().map(decode)
    if (!conns.length) return
    const now = clock()
    for (const c of conns) {
      const admin = ctx.users.get(c.owner)?.role === 'admin'
      const hit = c.space ? opts.space === c.space : changes.some((ch) => {
        if (ch.deleted) return c.scope === 'workspace' || pending(c)
        const owner = units.recordOf(ch.path)?.owner
        return owner != null && covers({ scope: c.scope, owner: c.owner, admin }, ch.path, owner)
      })
      const moved = hit && afterChange(c, now)
      if (moved) set(c.id, moved)
    }
  }

  // someone's handle changed: files moved without journal rows, so every
  // connection checks every file at its next run, which is now
  function onRenamed() {
    db.prepare('UPDATE sync_connections SET last_full_at = NULL, next_run_at = ? WHERE paused IS NULL').run(clock())
  }

  function start() {
    if (timer) return
    events?.on('change', onChange)
    events?.on('renamed', onRenamed)
    timer = setInterval(() => tick().catch((e) => console.error('[mirror]', e)), MIN)
    timer.unref?.()
    // anything that fell due while the server was down runs once now
    setTimeout(() => tick().catch(() => {}), 5000).unref?.()
  }

  async function stop() {
    clearInterval(timer)
    timer = null
    events?.off('change', onChange)
    events?.off('renamed', onRenamed)
    await Promise.allSettled([...running.values()])
  }

  return { create, update, remove, get, list, drift, runs, run, tick, pending, isRunning: (id) => running.has(id), start, stop }
}
