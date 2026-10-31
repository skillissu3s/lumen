import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItems, addItem, moveItem } from './items.js'
import { boardOf, boardSettings, setBoardSettings, renameColumn, removeColumn, moveColumn, addColumn, boardProgress } from './board.js'

const TEXT = `---
name: Launch
kanban-plugin: board
---
## To do
- [ ] Write the brief #design 🆔 a1
- [ ] Book venue 🆔 a2

## Doing
- [/] Landing page 🆔 b1

## Done
- [x] Repo ✅ 2026-10-14 🆔 c1
`

const board = (t) => boardOf(parseItems(t), t)

test('columns come from headings, in order, with their cards', () => {
  const b = board(TEXT)
  assert.deepEqual(b.columns.map((c) => c.name), ['To do', 'Doing', 'Done'])
  assert.deepEqual(b.columns[0].items.map((i) => i.id), ['a1', 'a2'])
  assert.equal(b.done, 'Done')
  assert.deepEqual(boardProgress(b), { open: 3, finished: 1, total: 4 })
})

test('a list without headings is one unnamed column', () => {
  const b = board('- [ ] A 🆔 a\n- [ ] B 🆔 b\n')
  assert.equal(b.columns.length, 1)
  assert.equal(b.columns[0].name, null)
})

test('settings block: written, read, merged, and invisible to items', () => {
  let t = setBoardSettings(TEXT, { columns: { 'To do': 'blue' }, labels: { design: 'violet' } })
  t = setBoardSettings(t, { covers: { a1: 'green' }, columns: { Doing: 'amber' } })
  const s = boardSettings(t)
  assert.deepEqual(s.columns, { 'To do': 'blue', Doing: 'amber' })
  assert.equal(s.labels.design, 'violet')
  assert.equal(s.covers.a1, 'green')
  assert.match(t, /%% kanban:settings\n```\n\{"kanban-plugin":"board"/)
  assert.equal(parseItems(t).all.size, 4)
  // adding a card to the last column still goes above the settings block
  const added = addItem(t, { title: 'Ship' }, { section: 'Done' }, { makeId: () => 'z9' }).text
  assert.ok(added.indexOf('Ship') < added.indexOf('%% kanban:settings'))
  t = setBoardSettings(t, { covers: { a1: null } })
  assert.deepEqual(boardSettings(t).covers, {})
})

test('rename keeps the colour; remove only when empty; move columns', () => {
  let t = setBoardSettings(TEXT, { columns: { Doing: 'amber' } })
  t = renameColumn(t, 'Doing', 'In progress')
  assert.equal(boardSettings(t).columns['In progress'], 'amber')
  assert.deepEqual(board(t).columns.map((c) => c.name), ['To do', 'In progress', 'Done'])
  assert.throws(() => removeColumn(t, 'Done'), /Move or delete/)
  t = addColumn(t, 'Later')
  t = removeColumn(t, 'Later')
  assert.deepEqual(board(t).columns.map((c) => c.name), ['To do', 'In progress', 'Done'])
  t = moveColumn(t, 'Done', 'To do')
  assert.deepEqual(board(t).columns.map((c) => c.name), ['Done', 'To do', 'In progress'])
  assert.deepEqual(board(t).columns[1].items.map((i) => i.id), ['a1', 'a2'])
  t = moveColumn(t, 'Done', null)
  assert.deepEqual(board(t).columns.map((c) => c.name), ['To do', 'In progress', 'Done'])
})

test('moving a card between columns is moving it to that section', () => {
  const t = moveItem(TEXT, 'a2', { section: 'Doing' })
  assert.deepEqual(board(t).columns[1].items.map((i) => i.id), ['b1', 'a2'])
})
