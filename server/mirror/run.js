// One run of the GitHub mirror for one connection: the Repo Sync Protocol's
// sync run (§8) and its full pass (§9). The journal says which records changed
// since the connection's cursor; their files are rendered from the database and
// compared with the repository's tree, and whatever differs goes in as one
// commit, with .sync/index.jsonl and .sync/manifest.json. Nothing here talks to
// GitHub directly: `gh` is a small interface (github/repo.js, or a fake in tests).
//
//   gh.repo()                         → { id, private, defaultBranch }
//   gh.head(branch)                   → { commit, tree } | null (an empty repository)
//   gh.tree(treeSha)                  → Map path → blob sha
//   gh.read(path, ref)                → text | null
//   gh.commit({ branch, head, entries, message }) → commit sha
//        entries: [{ path, content }] (content null deletes); throws { moved: true }
//        when the branch moved meanwhile

import crypto from 'node:crypto'
import { PROFILE } from './lumen/index.js'

export const PROTOCOL = 'repo-sync/0.1'

export const gitBlob = (text) => {
  const buf = Buffer.from(text, 'utf8')
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
}

/** A run stopped by something the person has to sort out; the connection pauses */
export class Paused extends Error {
  constructor(message) {
    super(message)
    this.pause = true
  }
}

const isChat = (path) => path.startsWith('chat/')

const major = (profile) => Number(String(profile || '').split('/')[1]) || 0
const newerProfile = (profile) => String(profile || '').split('/')[0] === PROFILE.split('/')[0] && major(profile) > major(PROFILE)

/**
 * Does this connection's mirror hold the file? Scope 'workspace' holds
 * everything; scope 'owner' holds what the person owns, plus the workspace's own
 * files (lumen.json, plugins…) for an admin, and never chat.
 */
export function covers(conn, path, owner) {
  if (path.startsWith('.sync/')) return false
  if (conn.scope === 'workspace') return true
  if (isChat(path)) return false
  return owner === conn.owner || (owner === '' && !!conn.admin)
}

function indexText(index) {
  return [...index.values()]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => JSON.stringify({ path: e.path, type: e.type, id: e.id, blob: e.blob, rev: e.rev }))
    .map((l) => `${l}\n`)
    .join('')
}

export function parseIndex(text) {
  const out = new Map()
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e?.path) out.set(e.path, e)
    } catch {
      /* a broken line: that file is treated as not written */
    }
  }
  return out
}

function manifestText(conn, ctx, cursor, index) {
  const counts = {}
  for (const e of index.values()) counts[e.type] = (counts[e.type] || 0) + 1
  return `${JSON.stringify(
    {
      protocol: PROTOCOL,
      profile: PROFILE,
      app: ctx.app,
      scope: conn.scope,
      owner: conn.scope === 'owner' ? { id: conn.owner, handle: conn.ownerHandle } : undefined,
      source: ctx.source,
      cursor,
      written: new Date(ctx.clock()).toISOString(),
      counts: Object.fromEntries(Object.entries(counts).sort()),
    },
    null,
    2,
  )}\n`
}

function message(written, removed, from, to, runId) {
  const n = written.length + removed.length
  const lines = [`Sync: ${n} file${n === 1 ? '' : 's'}`, '']
  const list = (label, paths) => paths.length && lines.push(`${label}: ${paths.slice(0, 20).join(', ')}${paths.length > 20 ? `, and ${paths.length - 20} more` : ''}`)
  list('Changed', written)
  list('Removed', removed)
  lines.push('', `Sync-Protocol: ${PROTOCOL.split('/')[1]}`, `Sync-Profile: ${PROFILE}`, `Sync-Cursor: ${from}..${to}`, `Sync-Run: ${runId}`)
  return lines.join('\n')
}

/**
 * `ctx`: { store, units, app: { name, version }, source: { id, label }, clock }.
 * `conn`: { owner, ownerHandle, admin, scope, branch, prefix, repoId, allowPublic,
 *           cursor, index (Map or null), adopt (take over another server's mirror) }.
 * `full`: the whole pass (a new connection, a rebuild, the weekly check).
 * → { commit, cursor, index, written, removed, drift, failed }
 */
export async function runMirror(ctx, conn, gh, { full = false } = {}) {
  const { store, units } = ctx
  const prefix = conn.prefix ? `${conn.prefix.replace(/\/+$/, '')}/` : ''
  const repo = await gh.repo()
  if (conn.repoId && repo.id !== conn.repoId) throw new Paused('The repository is not the one this connection was made with (it may have been replaced). Choose it again.')
  if (!repo.private && !conn.allowPublic) throw new Paused('The repository is public. Make it private, or allow a public mirror for this connection.')

  const high = store.highWater()
  const index = conn.index ? new Map(conn.index) : null
  const first = !index

  // which files to look at
  const candidates = new Set()
  if (full || first) {
    for (const p of units.paths()) candidates.add(p)
    for (const p of index?.keys() || []) candidates.add(p)
  } else {
    const byId = new Map([...index.values()].map((e) => [`${e.type}:${e.id}`, e.path]))
    for (const j of store.changesSince(conn.cursor, { limit: 1e7 })) {
      if (j.seq > high) break
      if (conn.scope === 'owner' && j.owner !== conn.owner && !(j.owner === '' && conn.admin)) continue
      const path = units.pathOfRoot(j.root_type, j.root_id)
      if (path) candidates.add(path)
      // where the root was written before, if it moved (a rename)
      const before = byId.get(j.root_type === 'channel' ? 'channels:channels' : `${j.root_type}:${j.root_id}`)
      if (before) candidates.add(before)
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await gh.head(conn.branch)
    const tree = head ? await gh.tree(head.tree) : new Map()
    if ((first || full) && tree.has(`${prefix}.sync/manifest.json`)) {
      let manifest = null
      try {
        manifest = JSON.parse((await gh.read(`${prefix}.sync/manifest.json`, head.commit)) || 'null')
      } catch {
        /* unreadable: treated as foreign */
      }
      // somebody's mirror is already here: only this server's may be taken over
      if (first && !conn.adopt && manifest?.source?.id !== ctx.source.id) throw new Paused('This repository already holds a mirror written by another Lumen server. Choose another repository, or a folder inside this one.')
      if (newerProfile(manifest?.profile)) throw new Paused('This mirror was written by a newer version of Lumen. Update this server to keep syncing to it.')
    }

    const next = new Map(index || [])
    const entries = []
    const written = []
    const removed = []
    const drift = []
    const failed = []
    for (const p of [...candidates].sort()) {
      const at = `${prefix}${p}`
      const was = next.get(p)
      let rec, text
      try {
        rec = units.recordOf(p)
        text = rec && covers(conn, p, rec.owner) ? units.render(p) : null
      } catch (e) {
        // one file that won't render keeps its old version; the next full pass tries again
        failed.push({ path: p, error: e.message })
        continue
      }
      if (was && tree.has(at) && tree.get(at) !== was.blob) drift.push(p)
      if (text == null) {
        if (was) {
          next.delete(p)
          if (tree.has(at)) {
            entries.push({ path: at, content: null })
            removed.push(p)
          }
        }
        continue
      }
      const blob = gitBlob(text)
      next.set(p, { path: p, type: rec.type, id: rec.id, blob, rev: rec.rev })
      if (tree.get(at) !== blob) {
        entries.push({ path: at, content: text })
        written.push(p)
      }
    }
    if (!entries.length && !first) return { commit: null, cursor: high, index: next, written, removed, drift, failed }
    entries.push({ path: `${prefix}.sync/index.jsonl`, content: indexText(next) })
    entries.push({ path: `${prefix}.sync/manifest.json`, content: manifestText(conn, ctx, high, next) })
    try {
      const commit = await gh.commit({ branch: conn.branch, head, entries, message: message(written, removed, conn.cursor, high, crypto.randomUUID()) })
      return { commit, cursor: high, index: next, written, removed, drift, failed }
    } catch (e) {
      if (!e.moved) throw e
      // someone pushed meanwhile: start again from the new head
    }
  }
  throw new Error('The branch kept moving while Lumen wrote to it. It will try again.')
}
