// What the agent tools stand on: the person's own tree (view.js), read and
// written the way the app's file API does it, through the same access rules, so
// an agent can do exactly what its person can and no more.
import * as view from '../view.js'
import * as files from '../files.js'
import { ConflictError } from '../files.js'
import { canReadAt, writeProblemAt, metaOf } from '../access.js'
import { parseItems, flatItems, ItemMissingError } from '../../shared/items.js'
import { ToolError } from './protocol.js'
import { reaches } from '../agents.js'

const NEEDS = { read: 'look at', edit: 'change', full: 'delete in' }

/** The key an agent's reach is kept under: a space's id, or 'shared' for what others share */
const keyOf = (t) => (t.shared ? 'shared' : t.space)
/** What the agent may do there; a person without an agent may do everything their access allows */
export const levelAt = (user, t) => (user.reach ? user.reach(keyOf(t)) : 'full')

/** The space name a refusal can say */
function spaceNameOf(user, t, cache) {
  if (t.shared) return 'what’s shared with you'
  const m = (cache?.mounts || view.mounts(user)).find((x) => x.space === t.space)
  return m?.kind === 'candle' ? 'your candle' : m?.name || 'that space'
}

const PLACE = /^(workspaces|shared)\/[^/]+\//
/** The tree prefix a path sits under: '' (your candle), 'workspaces/<slug>/' or 'shared/<owner>/' */
export const placeOf = (path) => PLACE.exec(path)?.[0] || ''
const inside = (path) => path.slice(placeOf(path).length)

export function kindOf(path) {
  const p = inside(path)
  if (/^lists\/[^/]+\.md$/.test(p)) return 'board'
  if (/^calendars\/[^/]+\.md$/.test(p)) return 'calendar'
  if (/^docs\/.+\.md$/.test(p)) return 'doc'
  if (/^ideas\/[^/]+\.canvas$/.test(p)) return 'idea_board'
  return 'other'
}
export const isItemFile = (path) => ['board', 'calendar'].includes(kindOf(path))

/**
 * A path in the person's tree → where it lives, or a ToolError saying why not:
 * nothing there, or (`need`: read, edit or full) not this agent's to do there.
 */
export function target(user, raw, cache, need = 'read') {
  const p = files.cleanPath(raw)
  if (!p) throw new ToolError(`That isn’t a valid path: ${raw}`)
  const t = view.resolve(user, p, cache)
  if (!t || !canReadAt(t, t.path) || !levelAt(user, t)) throw new ToolError(`Nothing you can see is at ${p}. list_files gives the paths.`)
  if (!reaches(levelAt(user, t), need)) throw new ToolError(`This agent may not ${NEEDS[need]} ${spaceNameOf(user, t, cache)}. The person can change that in Lumen under Settings → AI agents.`)
  return { ...t, view: p }
}

export async function readAt(user, path) {
  const t = target(user, path)
  const r = await files.space(t.space).read(t.path)
  if (!r) throw new ToolError(`Nothing is at ${t.view}.`)
  return { path: t.view, text: r.text, sha: r.sha }
}

const refusals = (user, t, text) => (cur) => {
  const reason = writeProblemAt(user, t, t.path, metaOf(t.path, cur?.text ?? ''), text == null ? null : metaOf(t.path, text), !!cur)
  if (reason) throw new ToolError(reason)
}

/**
 * Changes a file with `fn(text) → text`, read fresh and saved only if no one
 * changed it in between (else read again and redone). `create`: a missing
 * file starts empty. `sha`: the version the agent read; anything newer refuses.
 */
export async function editAt(user, path, fn, { create = false, sha, need = 'edit' } = {}) {
  const t = target(user, path, undefined, need)
  const place = files.space(t.space)
  for (let i = 0; i < 5; i++) {
    const cur = await place.read(t.path)
    if (!cur && !create) throw new ToolError(`Nothing is at ${t.view}.`)
    if (sha !== undefined && (cur?.sha ?? null) !== sha) throw new ToolError(`${t.view} changed since you read it. Read it again, then make your change.`)
    let next
    try {
      next = fn(cur?.text ?? '')
    } catch (e) {
      if (e instanceof ItemMissingError) throw new ToolError(`No item ${e.message.split(': ').pop()} in ${t.view}. list_tasks gives the ids.`)
      throw e
    }
    if (cur && next === cur.text) return { path: t.view, sha: cur.sha, text: cur.text }
    try {
      const r = await place.write(t.path, next, { baseSha: cur?.sha ?? null, check: refusals(user, t, next), by: user.handle })
      return { path: t.view, sha: r.sha, text: r.text ?? next }
    } catch (e) {
      if (!(e instanceof ConflictError) || sha !== undefined) throw e
    }
  }
  throw new ToolError(`${t.view} kept changing while saving. Try again.`)
}

export async function removeAt(user, path) {
  const t = target(user, path, undefined, 'full')
  const r = await files.space(t.space).remove(t.path, { check: refusals(user, t, null), by: user.handle })
  if (!r.deleted) throw new ToolError(`Nothing is at ${t.view}.`)
  return { path: t.view }
}

/** The person's spaces: [{ prefix, name, kind, role }] and what's shared with them */
export function spacesFor(user) {
  const cache = view.lookups(user)
  const level = (key) => (user.reach ? user.reach(key) : 'full')
  return {
    spaces: cache.mounts.filter((m) => level(m.space)).map((m) => ({ prefix: m.prefix, name: m.kind === 'candle' ? m.name || 'Your candle' : m.name, kind: m.kind, role: m.role, slug: m.slug, space: m.space, ...(user.reach ? { agent_may: level(m.space) } : {}) })),
    shared: level('shared') ? cache.shared.map((s) => ({ path: `${s.prefix}${s.path}`, owner: s.owner, can: s.can })) : [],
  }
}

/** A space as the agent names it (its prefix, slug or name; '' or nothing is your candle) → its prefix */
export function prefixFor(user, name) {
  if (name == null || name === '') return ''
  const s = String(name).trim().toLowerCase()
  const { spaces } = spacesFor(user)
  const names = (m) => (m.kind === 'candle' ? [m.name, 'candle', 'my candle', 'your candle'] : [m.prefix, m.prefix.slice(0, -1), m.slug, m.name])
  const found = spaces.find((m) => names(m).some((n) => n && n.toLowerCase() === s))
  if (!found) throw new ToolError(`No space called ${name}. list_spaces gives the names.`)
  return found.prefix
}

/** Every file the person can see, in their tree, in the spaces this agent may look at */
export function filesFor(user) {
  const cache = view.lookups(user)
  return view.list(user, cache).filter((f) => {
    const t = view.resolve(user, f.path, cache)
    return t && levelAt(user, t)
  })
}

/** Items of boards and calendars, each with its path and the file's name: `only` keeps some files */
export async function itemsFor(user, only = () => true) {
  const cache = view.lookups(user)
  const out = []
  for (const f of view.list(user, cache)) {
    if (!isItemFile(f.path) || !only(f.path)) continue
    const t = view.resolve(user, f.path, cache)
    if (!t || !levelAt(user, t)) continue
    const r = await files.space(t.space).read(t.path)
    if (!r) continue
    const events = kindOf(f.path) === 'calendar'
    const parsed = parseItems(r.text, { events })
    const name = parsed.meta?.name || f.path.split('/').pop().replace(/\.md$/, '')
    for (const item of flatItems(parsed)) out.push({ ...item, path: f.path, source: { kind: events ? 'calendar' : 'list', name, path: f.path } })
  }
  return out
}
