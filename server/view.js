// Each person's tree (docs/CANDLES.md → The view): their candle at the top,
// every workspace they're in under workspaces/<slug>/, and each thing others
// shared with them under shared/<owner>/. The file API, the realtime notices,
// the browser's offline copy and the desktop's replica all speak these paths;
// this module turns them into (space, path inside it) and back.

import { db } from './db.js'
import * as files from './files.js'
import * as spaces from './spaces.js'
import { TABLES } from './store/tables.js'
import { canReadAt, shareFor } from './access.js'

const ROOT_TABLES = ['board', 'calendar', 'doc', 'idea_board'].map((t) => TABLES[t].table)

/** The spaces a person sees whole: [{ prefix, space, kind, role, name, slug }], their candle first */
export function mounts(user) {
  if (user.desktop) return [{ prefix: '', space: files.homeSpaceId(), kind: 'candle', role: 'owner', name: '', slug: null }]
  spaces.ensureCandle(user)
  return spaces.spacesOf(user.id).map((s) => ({ prefix: s.kind === 'candle' ? '' : `workspaces/${s.slug}/`, space: s.id, kind: s.kind, role: s.role, name: s.name, slug: s.slug }))
}

/** Things in other people's candles shared with this person: [{ prefix, space, path, can, owner }] */
export function shared(user) {
  if (user.desktop) return []
  const mine = spaces.candleId(user.id)
  const out = []
  for (const table of ROOT_TABLES) {
    const rows = db.prepare(`SELECT space, path, share FROM ${table} WHERE deleted = 0 AND share IS NOT NULL AND space LIKE 'c\\_%' ESCAPE '\\' AND space != ?`).all(mine)
    for (const r of rows) {
      let share = null
      try {
        share = JSON.parse(r.share)
      } catch {
        continue
      }
      const can = shareFor(share, user.handle)
      const owner = can && spaces.get(r.space)?.owner_id
      if (!owner || !r.path) continue
      const handle = files.people.handleOf(owner)
      out.push({ prefix: `shared/${handle}/`, space: r.space, path: r.path, can, owner: handle })
    }
  }
  return out
}

/**
 * A path in the person's tree → { space, path, kind, role, shared, can }, or
 * null when it leads nowhere they may go. `cache` ({ mounts, shared }) saves
 * looking them up again for a batch.
 */
export function resolve(user, viewPath, cache = {}) {
  const m = cache.mounts || mounts(user)
  const parts = String(viewPath).split('/')
  if (parts[0] === 'workspaces' && parts.length > 2) {
    const mount = m.find((x) => x.kind === 'workspace' && x.slug === parts[1])
    return mount ? { space: mount.space, path: parts.slice(2).join('/'), kind: 'workspace', role: mount.role, mount } : null
  }
  if (parts[0] === 'shared' && parts.length > 2) {
    const rel = parts.slice(2).join('/')
    const s = (cache.shared || shared(user)).find((x) => x.owner === parts[1] && x.path === rel)
    return s ? { space: s.space, path: rel, kind: 'candle', shared: true, can: s.can } : null
  }
  const candle = m.find((x) => x.prefix === '')
  return candle ? { space: candle.space, path: String(viewPath), kind: 'candle', role: 'owner', mount: candle } : null
}

/** A file of a space → its path in this person's tree, or null if they can't see it */
export function toView(user, space, path, cache = {}) {
  const mount = (cache.mounts || mounts(user)).find((x) => x.space === space)
  if (mount) return canReadAt({ kind: mount.kind, role: mount.role }, path) ? `${mount.prefix}${path}` : null
  const s = (cache.shared || shared(user)).find((x) => x.space === space && x.path === path)
  return s ? `${s.prefix}${path}` : null
}

/** Every file this person can see, in their tree: [{ path, sha, size, meta }] */
export function list(user, cache = {}) {
  const out = []
  for (const mount of cache.mounts || mounts(user)) {
    for (const f of files.space(mount.space).list()) if (canReadAt({ kind: mount.kind, role: mount.role }, f.path)) out.push({ ...f, path: `${mount.prefix}${f.path}` })
  }
  for (const s of cache.shared || shared(user)) {
    const e = files.space(s.space).info(s.path)
    if (e) out.push({ ...e, path: `${s.prefix}${s.path}` })
  }
  return out
}

/** The lookups resolve/toView/list need, done once for a batch */
export const lookups = (user) => ({ mounts: mounts(user), shared: shared(user) })
