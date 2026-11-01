// Idea boards (ideas/<slug>.canvas) as files, both ways, for profile lumen/1:
// JSON Canvas, one node or edge per line (shared/canvas.js writes the layout),
// with every object's keys in a fixed order so the bytes never wobble.
// A `file` node keeps the path it points at; turning paths into the ids the
// database stores is the caller's job, since it needs the other files' paths.

import { parseCanvas, serializeCanvas } from '../../../shared/canvas.js'

const NODE_KEYS = ['id', 'type', 'text', 'label', 'file', 'url', 'x', 'y', 'width', 'height', 'color', 'style', 'shape', 'ink', 'inkW', 'inkH']
const EDGE_KEYS = ['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label']
const ROOT_KEYS = ['id', 'name', 'owner', 'share', 'color', 'icon']

// known keys in order, then any others sorted; empty values left out
function ordered(obj, keys) {
  const out = {}
  for (const k of keys) if (obj[k] != null) out[k] = obj[k]
  for (const k of Object.keys(obj).filter((k) => !keys.includes(k) && obj[k] != null).sort()) out[k] = obj[k]
  return out
}

const strip = (obj, drop) => Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.includes(k)))

/** A canvas file → { root, nodes, edges, warnings } */
export function parse(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').normalize('NFC')
  const warnings = []
  let data = {}
  try {
    data = JSON.parse(src || '{}') || {}
  } catch {
    warnings.push('not valid JSON; read as an empty board')
  }
  const { nodes, edges, lumen } = parseCanvas(src)
  const root = { type: 'idea_board', id: typeof lumen.id === 'string' && lumen.id ? lumen.id : null, extra: {} }
  for (const k of ROOT_KEYS) if (k !== 'id' && lumen[k] != null) root[k] = lumen[k]
  const lumenOther = strip(lumen, ROOT_KEYS)
  if (Object.keys(lumenOther).length) root.extra.lumen = lumenOther
  const top = Object.keys(strip(data, ['nodes', 'edges', 'lumen']))
  if (top.length) warnings.push(`left out top-level key(s) a canvas doesn't have: ${top.join(', ')}`)
  const dropped = (Array.isArray(data.edges) ? data.edges.length : 0) - edges.length
  if (dropped > 0) warnings.push(`left out ${dropped} arrow(s) to cards that don't exist`)
  return {
    root,
    nodes: nodes.map((n, position) => ({ ...n, position })),
    edges: edges.map((e, position) => ({ ...e, position })),
    warnings,
  }
}

const byPosition = (a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id))

/** A board, its nodes and its edges → the file's text */
export function render(root, nodes, edges) {
  const live = nodes.filter((n) => !n.deleted).sort(byPosition)
  const ids = new Set(live.map((n) => n.id))
  // the board's own details; share: null means private, and is written as such
  const lumen = {}
  for (const k of ROOT_KEYS) if (root[k] != null || k === 'share') lumen[k] = root[k] ?? null
  Object.assign(lumen, ordered(root.extra?.lumen || {}, []))
  return serializeCanvas({
    nodes: live.map((n) => ordered(strip(n, ['position', 'deleted', 'rev']), NODE_KEYS)),
    edges: edges
      .filter((e) => !e.deleted && ids.has(e.fromNode) && ids.has(e.toNode))
      .sort(byPosition)
      .map((e) => ordered(strip(e, ['position', 'deleted', 'rev']), EDGE_KEYS)),
    lumen,
  })
}
