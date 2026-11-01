import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, render } from './ideaFile.js'

const BOARD = [
  '{',
  '\t"nodes":[',
  '\t\t{"id":"g7","type":"group","label":"Marketing","x":-40,"y":-60,"width":600,"height":360},',
  '\t\t{"id":"k2","type":"text","text":"Launch email","x":0,"y":0,"width":240,"height":120,"color":"5"},',
  '\t\t{"id":"m4","type":"text","text":"Start","x":300,"y":0,"width":180,"height":120,"shape":"ellipse"},',
  '\t\t{"id":"p9","type":"file","file":"docs/plans.md","x":0,"y":200,"width":260,"height":72},',
  '\t\t{"id":"s1","type":"text","text":"","x":10,"y":10,"width":40,"height":20,"color":"4","ink":"M6 6 L30 12","inkW":40,"inkH":20}',
  '\t],',
  '\t"edges":[',
  '\t\t{"id":"e1","fromNode":"k2","fromSide":"right","toNode":"m4","toSide":"left","toEnd":"arrow","label":"then"}',
  '\t],',
  '\t"lumen":{"id":"i_4k2p9q7x1m","name":"Product launch","owner":"nikhil","share":null,"color":"violet","icon":"lightbulb"}',
  '}',
  '',
].join('\n')

test('an idea board written by Lumen comes back byte for byte', () => {
  const { root, nodes, edges, warnings } = parse(BOARD)
  assert.deepEqual(warnings, [])
  assert.equal(root.id, 'i_4k2p9q7x1m')
  assert.equal(root.share, undefined)
  assert.equal(nodes.length, 5)
  assert.equal(nodes[2].shape, 'ellipse')
  assert.equal(nodes[3].file, 'docs/plans.md')
  assert.equal(edges[0].label, 'then')
  assert.equal(render(root, nodes, edges), BOARD)
  // the rows' order doesn't change the file
  assert.equal(render(root, [...nodes].reverse(), edges), BOARD)
})

test('keys come out in a fixed order, unknown ones sorted and kept', () => {
  const messy = JSON.stringify({
    nodes: [{ height: 60, width: 120, y: 2.6, x: 1.4, text: 'Hi', type: 'text', id: 'a', zeta: 1, alpha: 'keep' }],
    edges: [],
    lumen: { icon: 'lightbulb', name: 'Messy', theme: 'dark' },
  })
  const { root, nodes, edges } = parse(messy)
  assert.equal(root.extra.lumen.theme, 'dark')
  const once = render({ ...root, id: 'i_new' }, nodes, edges)
  assert.match(once, /\{"id":"a","type":"text","text":"Hi","x":1,"y":3,"width":120,"height":60,"alpha":"keep","zeta":1\}/)
  assert.match(once, /"lumen":\{"id":"i_new","name":"Messy","share":null,"icon":"lightbulb","theme":"dark"\}/)
  const again = parse(once)
  assert.equal(render(again.root, again.nodes, again.edges), once)
})

test('arrows to missing cards are left out and reported', () => {
  const text = JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: '', x: 0, y: 0, width: 10, height: 10 }], edges: [{ id: 'e', fromNode: 'a', toNode: 'gone' }] })
  const { edges, warnings } = parse(text)
  assert.equal(edges.length, 0)
  assert.match(warnings[0], /1 arrow/)
})
