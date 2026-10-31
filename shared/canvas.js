// Idea boards are JSON Canvas files (jsoncanvas.org — the format Obsidian's
// canvases use): cards of text, groups that frame them, and arrows between
// them. Lumen keeps the board's own details under "lumen". Written with one
// node or edge per line so git can merge two people's changes card by card.

export const CANVAS_COLORS = { 1: 'red', 2: 'orange', 3: 'amber', 4: 'green', 5: 'teal', 6: 'violet' }
const COLOR_CODE = Object.fromEntries(Object.entries(CANVAS_COLORS).map(([k, v]) => [v, k]))

/** A canvas colour ("1"–"6" or "#rrggbb") → one of Lumen's colour names, or null */
export const colorName = (c) => (c == null ? null : CANVAS_COLORS[String(c)] || null)
/** Lumen colour name → canvas colour code */
export const colorCode = (name) => (name ? COLOR_CODE[name] || null : null)

export function parseCanvas(text) {
  let data = {}
  try {
    data = JSON.parse(text || '{}') || {}
  } catch {
    data = {}
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes.filter((n) => n && n.id) : []
  const ids = new Set(nodes.map((n) => n.id))
  const edges = Array.isArray(data.edges) ? data.edges.filter((e) => e && e.id && ids.has(e.fromNode) && ids.has(e.toNode)) : []
  const lumen = data.lumen && typeof data.lumen === 'object' ? data.lumen : {}
  return { nodes, edges, lumen }
}

const NODE_KEYS = ['id', 'type', 'text', 'label', 'file', 'url', 'x', 'y', 'width', 'height', 'color']
const EDGE_KEYS = ['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label']
const ordered = (obj, keys) => {
  const out = {}
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k]
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined && obj[k] !== null) out[k] = obj[k]
  return out
}

export function serializeCanvas({ nodes = [], edges = [], lumen = {} }) {
  const line = (o) => `\t\t${JSON.stringify(o)}`
  return [
    '{',
    '\t"nodes":[',
    nodes.map((n) => line(ordered({ ...n, x: Math.round(n.x), y: Math.round(n.y), width: Math.round(n.width), height: Math.round(n.height) }, NODE_KEYS))).join(',\n'),
    '\t],',
    '\t"edges":[',
    edges.map((e) => line(ordered(e, EDGE_KEYS))).join(',\n'),
    '\t],',
    `\t"lumen":${JSON.stringify(lumen)}`,
    '}',
    '',
  ]
    .filter((l, i, all) => !(l === '' && i < all.length - 1))
    .join('\n')
}

export function newCanvas({ name, owner, share = null, color = 'violet', icon = 'lightbulb' }) {
  return serializeCanvas({ nodes: [], edges: [], lumen: { name, owner, share, color, icon } })
}

/** The nodes whose box lies inside `group`'s box (they move with it) */
export function insideGroup(group, nodes) {
  return nodes.filter((n) => n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height)
}

/** Which side of `a` faces `b` best */
export function facingSide(a, b) {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  const dx = bx - ax
  const dy = by - ay
  if (Math.abs(dx) * a.height > Math.abs(dy) * a.width) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

/** The point on a node's side where an edge attaches */
export function anchor(n, side) {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y }
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height }
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 }
    default:
      return { x: n.x + n.width, y: n.y + n.height / 2 }
  }
}

/** An SVG path for an edge: a gentle curve leaving each side straight out */
export function edgePath(from, fromSide, to, toSide) {
  const pull = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.35)
  const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }
  const [fx, fy] = out[fromSide] || [1, 0]
  const [tx, ty] = out[toSide] || [-1, 0]
  return `M ${from.x} ${from.y} C ${from.x + fx * pull} ${from.y + fy * pull}, ${to.x + tx * pull} ${to.y + ty * pull}, ${to.x} ${to.y}`
}

/** The box around some nodes */
export function bounds(nodes) {
  if (!nodes.length) return null
  const x = Math.min(...nodes.map((n) => n.x))
  const y = Math.min(...nodes.map((n) => n.y))
  return { x, y, width: Math.max(...nodes.map((n) => n.x + n.width)) - x, height: Math.max(...nodes.map((n) => n.y + n.height)) - y }
}

/** The middle of an edge's curve (where its label sits) */
export function edgeMid(from, fromSide, to, toSide) {
  const pull = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.35)
  const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }
  const [fx, fy] = out[fromSide] || [1, 0]
  const [tx, ty] = out[toSide] || [-1, 0]
  const c1 = { x: from.x + fx * pull, y: from.y + fy * pull }
  const c2 = { x: to.x + tx * pull, y: to.y + ty * pull }
  // a cubic bezier at t = 1/2
  return { x: (from.x + 3 * c1.x + 3 * c2.x + to.x) / 8, y: (from.y + 3 * c1.y + 3 * c2.y + to.y) / 8 }
}

/** Do two boxes overlap? */
export const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
