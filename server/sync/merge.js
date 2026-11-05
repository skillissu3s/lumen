// Three-way merge of one workspace file changed in two places: on this
// computer (`local`) and on the Lumen server (`remote`), both since `base`, the
// last version the two agreed on. Each kind of file merges record by record
// through the lumen/1 codecs: a card, an idea board's node, a setting, a chat
// message. Changes to different records never collide; when both sides changed
// the same field, the server's version wins and the merge says so. Docs merge as
// text (diff-match-patch), since their blocks have no lasting ids.
//
// `base` is '' when the two sides never agreed on this file (a file made in both
// places before they were linked): records then come from both sides.

import * as L from '../mirror/lumen/index.js'
import { rebaseText } from '../../shared/merge.js'

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// one value of three: the side that changed it, or the server's if both did
function pick(b, l, r, conflict) {
  if (same(l, r)) return l
  if (same(l, b)) return r
  if (same(r, b)) return l
  conflict()
  return r
}

// field by field: every key either side has
function mergeFields(b, l, r, conflict, skip = []) {
  const out = {}
  const keys = new Set([...Object.keys(l || {}), ...Object.keys(r || {})])
  for (const k of keys) {
    if (skip.includes(k)) continue
    const v = pick(b?.[k], l?.[k], r?.[k], conflict)
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * Records with ids, from three versions: changed on one side → that side;
 * on both → field by field; deleted on one side and untouched on the other →
 * gone; deleted on one side and changed on the other → kept.
 */
export function mergeRecords(base, local, remote, conflict, key = (x) => x.id) {
  const index = (list) => new Map((list || []).map((x) => [key(x), x]))
  const b = index(base)
  const l = index(local)
  const r = index(remote)
  const out = []
  const ids = [...new Set([...r.keys(), ...l.keys()])]
  for (const id of ids) {
    const was = b.get(id)
    const mine = l.get(id)
    const theirs = r.get(id)
    if (mine && theirs) out.push(same(mine, theirs) ? mine : mergeFields(was, mine, theirs, conflict))
    else if (mine) {
      if (!was || !same(mine, was)) out.push(mine)
    } else if (theirs) {
      if (!was || !same(theirs, was)) out.push(theirs)
    }
  }
  return out
}

function mergeItems(kind, base, local, remote, conflict) {
  const [b, l, r] = [base, local, remote].map((t) => (t ? L.items.parse(t, { kind }) : { root: {}, cards: [] }))
  const strip = (cards) => cards.map(({ ref, ...c }) => c)
  const root = { ...mergeFields(b.root, l.root, r.root, conflict), type: kind }
  const cards = mergeRecords(strip(b.cards), strip(l.cards), strip(r.cards), conflict)
  return L.items.render(root, cards, { kind })
}

function mergeIdea(base, local, remote, conflict) {
  const [b, l, r] = [base, local, remote].map((t) => (t ? L.idea.parse(t) : { root: {}, nodes: [], edges: [] }))
  const root = { ...mergeFields(b.root, l.root, r.root, conflict), type: 'idea_board' }
  const nodes = mergeRecords(b.nodes, l.nodes, r.nodes, conflict)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = mergeRecords(b.edges, l.edges, r.edges, conflict).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
  return L.idea.render(root, nodes, edges)
}

function mergeJson(codec, base, local, remote, conflict) {
  const read = (t) => (t ? codec.parse(t).data : {})
  return codec.render(mergeFields(read(base), read(local), read(remote), conflict))
}

function mergeChannels(base, local, remote, conflict) {
  const read = (t) => (t ? L.channels.parse(t).channels : [])
  return L.channels.render(mergeRecords(read(base), read(local), read(remote), conflict))
}

function mergeMessages(base, local, remote, conflict) {
  const read = (t) => (t ? L.messages.parse(t).messages : [])
  return L.messages.render(mergeRecords(read(base), read(local), read(remote), conflict))
}

// a plugin's JSON Lines (a log it appends to): lines either side added are kept,
// lines either side removed are gone
function mergeLines(base, local, remote) {
  const lines = (t) => String(t || '').split('\n').filter((x) => x.trim())
  const b = new Set(lines(base))
  const l = lines(local)
  const r = lines(remote)
  const removed = new Set([...b].filter((x) => !l.includes(x) || !r.includes(x)))
  const kept = r.filter((x) => !removed.has(x))
  for (const x of l) if (!b.has(x) && !kept.includes(x)) kept.push(x)
  return kept.length ? `${kept.join('\n')}\n` : ''
}

/**
 * → { text, conflict, copy }. `conflict`: both sides changed the same thing
 * (the server's version was kept). `copy`: the two can't be combined (a doc or
 * another file made separately in both places) and the local version should be
 * kept beside the server's under another name.
 */
export function merge3(path, base, local, remote) {
  if (local === remote) return { text: remote, conflict: false, copy: false }
  if (local === base) return { text: remote, conflict: false, copy: false }
  if (remote === base) return { text: local, conflict: false, copy: false }
  let conflict = false
  const flag = () => {
    conflict = true
  }
  const k = L.fileKind(path)?.kind
  if (k === 'board' || k === 'calendar') return { text: mergeItems(k, base, local, remote, flag), conflict, copy: false }
  if (k === 'idea') return { text: mergeIdea(base, local, remote, flag), conflict, copy: false }
  if (k === 'prefs') return { text: mergeJson(L.prefs, base, local, remote, flag), conflict, copy: false }
  if (k === 'workspace') return { text: mergeJson(L.workspace, base, local, remote, flag), conflict, copy: false }
  if (k === 'channels') return { text: mergeChannels(base, local, remote, flag), conflict, copy: false }
  if (k === 'messages') return { text: mergeMessages(base, local, remote, flag), conflict, copy: false }
  if (k === 'plugin_data' && path.endsWith('.jsonl')) return { text: mergeLines(base, local, remote), conflict: false, copy: false }
  // docs (and anything else) as text: both sides' edits, when they can be placed
  if (base) {
    const r = rebaseText(base, local, remote)
    if (r.clean) return { text: r.text, conflict: false, copy: false }
  }
  return { text: remote, conflict: true, copy: k === 'doc' || !k }
}

/** Where the local version of a file goes when it can't be merged: `docs/plan (this computer).md` */
export function copyPath(path) {
  const m = /^(.*?)(\.[^./]+)?$/.exec(path)
  return `${m[1]} (this computer)${m[2] || ''}`
}
