import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCanvas, serializeCanvas, newCanvas, insideGroup, facingSide, anchor, bounds, colorName, colorCode, edgeMid, overlaps } from './canvas.js'

test('round trip, one node per line, unknown keys kept', () => {
  const text = serializeCanvas({
    nodes: [
      { id: 'a', type: 'text', text: 'Idea', x: 0.4, y: 10, width: 240, height: 120, color: '6', extra: 1 },
      { id: 'g', type: 'group', label: 'Theme', x: -20, y: -20, width: 600, height: 400 },
    ],
    edges: [{ id: 'e', fromNode: 'a', fromSide: 'right', toNode: 'g', toSide: 'left', toEnd: 'arrow' }],
    lumen: { name: 'Q4' },
  })
  assert.equal(text.split('\n').filter((l) => l.startsWith('\t\t{')).length, 3)
  const c = parseCanvas(text)
  assert.equal(c.nodes[0].x, 0)
  assert.equal(c.nodes[0].extra, 1)
  assert.equal(c.lumen.name, 'Q4')
  assert.equal(c.edges.length, 1)
  assert.deepEqual(JSON.parse(text).nodes.length, 2)
})

test('broken or partial files read as empty, dangling edges dropped', () => {
  assert.deepEqual(parseCanvas('nope').nodes, [])
  const c = parseCanvas(JSON.stringify({ nodes: [{ id: 'a', x: 0, y: 0, width: 1, height: 1 }], edges: [{ id: 'e', fromNode: 'a', toNode: 'zz' }] }))
  assert.equal(c.edges.length, 0)
  assert.equal(parseCanvas(newCanvas({ name: 'N', owner: 'me' })).lumen.owner, 'me')
})

test('geometry', () => {
  const g = { id: 'g', x: 0, y: 0, width: 500, height: 300 }
  const inside = { id: 'i', x: 10, y: 10, width: 100, height: 100 }
  const out = { id: 'o', x: 450, y: 10, width: 100, height: 100 }
  assert.deepEqual(insideGroup(g, [g, inside, out]).map((n) => n.id), ['i'])
  assert.equal(facingSide(inside, out), 'right')
  assert.equal(facingSide(inside, { x: 10, y: 400, width: 100, height: 100 }), 'bottom')
  assert.deepEqual(anchor(inside, 'top'), { x: 60, y: 10 })
  assert.deepEqual(bounds([inside, out]), { x: 10, y: 10, width: 540, height: 100 })
  assert.equal(colorName('6'), 'violet')
  assert.equal(colorCode('green'), '4')
})

test('the middle of an edge, and overlapping boxes', () => {
  const m = edgeMid({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left')
  assert.equal(m.x, 100)
  assert.equal(m.y, 0)
  assert.ok(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }))
  assert.ok(!overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 0, width: 10, height: 10 }))
})
