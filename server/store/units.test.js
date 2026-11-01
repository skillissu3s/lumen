import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from './records.js'
import { createUnits } from './units.js'

const here = path.dirname(fileURLToPath(import.meta.url))

function fresh() {
  const store = createStore(new DatabaseSync(':memory:'))
  const ids = { nikhil: 'u_nikhil', ana: 'u_ana' }
  const people = {
    idOf: (h) => ids[h] || `handle:${h}`,
    handleOf: (id) => Object.keys(ids).find((h) => ids[h] === id) || String(id).replace(/^handle:/, ''),
  }
  let n = 0
  const units = createUnits(store, people, { makeId: (len) => String(++n).padStart(len, '0') })
  return { store, units }
}

const BOARD = `---
id: b_launch0001
name: Launch
owner: nikhil
kanban-plugin: board
---

## To do

- [ ] Pricing page #design 📅 2026-11-12 🆔 a1b2c3
    - [ ] Draft copy 🆔 a1b2c4

## Done

- [x] Pick a date ✅ 2026-10-28 🆔 z9y8x7

%% kanban:settings
\`\`\`
{"kanban-plugin":"board","lumen":{"done":"Done"}}
\`\`\`
%%
`

test('a board goes into rows and comes back byte for byte', () => {
  const { store, units } = fresh()
  assert.equal(units.save('lists/launch.md', BOARD), BOARD)
  const board = store.get('board', 'b_launch0001')
  assert.equal(board.owner, 'u_nikhil')
  assert.equal(board.path, 'lists/launch.md')
  const cards = store.where('card', 'root_id', 'b_launch0001')
  assert.equal(cards.length, 3)
  assert.equal(store.get('card', 'b_launch0001/a1b2c4').parent, 'b_launch0001/a1b2c3')
  assert.equal(units.render('lists/launch.md'), BOARD)
  assert.deepEqual(units.paths(), ['lists/launch.md'])
})

test('saving what was rendered writes nothing', () => {
  const { store, units } = fresh()
  const text = units.save('lists/launch.md', BOARD)
  const seq = store.highWater()
  units.save('lists/launch.md', text)
  assert.equal(store.highWater(), seq)
})

test('ticking one card changes one row', () => {
  const { store, units } = fresh()
  units.save('lists/launch.md', BOARD)
  const seq = store.highWater()
  units.save('lists/launch.md', BOARD.replace('- [ ] Draft copy', '- [x] Draft copy'))
  assert.deepEqual(store.changesSince(seq).map((j) => j.id), ['b_launch0001/a1b2c4'])
})

test('a file without ids gets them, and the rendered file carries them', () => {
  const { units } = fresh()
  const out = units.save('lists/errands.md', '---\nname: Errands\n---\n- [ ] Buy bulbs\n')
  assert.match(out, /^id: b_\d+$/m)
  assert.match(out, /- \[ \] Buy bulbs 🆔 \d{6}/)
  // the next save of the same text, without ids, maps onto the same board
  const again = units.save('lists/errands.md', '---\nname: Errands\n---\n- [ ] Buy bulbs\n- [ ] Milk\n')
  assert.equal(/^id: (.*)$/m.exec(again)[1], /^id: (.*)$/m.exec(out)[1])
})

test('a board copied by hand, id and all, becomes a board of its own', () => {
  const { store, units } = fresh()
  units.save('lists/launch.md', BOARD)
  const copy = units.save('lists/launch-copy.md', BOARD)
  const id = /^id: (.*)$/m.exec(copy)[1]
  assert.notEqual(id, 'b_launch0001')
  assert.equal(store.get('board', 'b_launch0001').path, 'lists/launch.md')
  assert.equal(store.where('card', 'root_id', 'b_launch0001').length, 3)
  assert.equal(store.where('card', 'root_id', id).length, 3)
})

test('editing one paragraph of a doc touches one block', () => {
  const { store, units } = fresh()
  const doc = '---\nid: d_plan000001\ntitle: Plan\n---\n\n# Plan\n\nFirst.\n\nSecond.\n\n- [ ] One\n- [ ] Two\n'
  assert.equal(units.save('docs/plan.md', doc), doc)
  const seq = store.highWater()
  units.save('docs/plan.md', doc.replace('Second.', 'Second, changed.'))
  assert.equal(store.changesSince(seq).length, 1)
  // inserting a paragraph keeps the rows of the others
  const before = new Set(store.where('block', 'doc_id', 'd_plan000001').map((b) => b.id))
  units.save('docs/plan.md', doc.replace('First.', 'First.\n\nNew one.'))
  const after = store.where('block', 'doc_id', 'd_plan000001')
  assert.equal(after.filter((b) => before.has(b.id)).length, before.size)
})

test('removing a file tombstones the root and its children', () => {
  const { store, units } = fresh()
  units.save('lists/launch.md', BOARD)
  units.remove('lists/launch.md')
  assert.equal(units.render('lists/launch.md'), null)
  assert.equal(store.get('board', 'b_launch0001').deleted, true)
  assert.equal(store.where('card', 'root_id', 'b_launch0001').length, 0)
  assert.deepEqual(units.paths(), [])
})

test('chat: appending an edit line changes the message, not the log', () => {
  const { store, units } = fresh()
  const first = '{"id":"m1","at":"2026-10-31T10:00:00.000Z","from":"nikhil","text":"Hi"}\n'
  units.save('chat/general/2026-10.jsonl', first)
  const out = units.save('chat/general/2026-10.jsonl', `${first}{"id":"m1","at":"2026-10-31T10:05:00.000Z","from":"nikhil","edit":true,"text":"Hello"}\n`)
  assert.equal(out, '{"id":"m1","at":"2026-10-31T10:00:00.000Z","from":"nikhil","text":"Hello","edited":"2026-10-31T10:05:00.000Z"}\n')
  assert.equal(store.get('message', 'general/m1').owner, 'u_nikhil')
})

test('the dev workspace goes into the database and renders back as the codecs do', () => {
  const folder = path.join(here, '../../data/workspace')
  if (!fs.existsSync(folder)) return
  const { store, units } = fresh()
  const files = []
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else files.push(r)
    }
  }
  walk(folder)
  const rendered = {}
  for (const p of files) rendered[p] = units.save(p, fs.readFileSync(path.join(folder, p), 'utf8'))
  assert.deepEqual(units.paths(), [...files].sort())
  const seq = store.highWater()
  for (const p of files) {
    assert.equal(units.render(p), rendered[p], p)
    units.save(p, rendered[p])
  }
  assert.equal(store.highWater(), seq, 'a second save of every file wrote nothing')
})
