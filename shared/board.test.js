import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItems, addItem, moveItem } from './items.js'
import { boardOf, boardSettings, setBoardSettings, renameColumn, removeColumn, moveColumn, addColumn, boardProgress, columnize, archiveCard, archivedOf, nameLooseColumn } from './board.js'

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

test('columnize turns a plain list into To do / Doing / Done', () => {
  const text = '---\nname: Inbox\n---\n- [ ] Open one 🆔 a1\n- [x] Finished 🆔 b2\n- [ ] Open two 🆔 c3\n'
  const t = columnize(text)
  const board = boardOf(parseItems(t), t)
  assert.deepEqual(board.columns.map((c) => c.name), ['To do', 'Doing', 'Done'])
  assert.deepEqual(board.columns[0].items.map((i) => i.id), ['a1', 'c3'])
  assert.deepEqual(board.columns[2].items.map((i) => i.id), ['b2'])
  assert.equal(columnize(t), t)
})

test('a new column goes in before the settings block', () => {
  const t = addColumn(setBoardSettings('## A\n', { done: 'A' }), 'B')
  assert.ok(t.indexOf('## B') < t.indexOf('%% kanban:settings'))
  assert.equal(boardSettings(t).done, 'A')
})

test('archiving puts a card under ***, before the settings, and the board leaves it out', () => {
  let t = setBoardSettings('## To do\n\n- [ ] One 🆔 a1\n- [ ] Two 🆔 b2\n\n## Done\n', { done: 'Done' })
  t = archiveCard(t, 'a1')
  assert.ok(t.indexOf('***') < t.indexOf('%% kanban:settings'))
  const board = boardOf(parseItems(t), t)
  assert.deepEqual(board.columns.map((c) => c.name), ['To do', 'Done'])
  assert.deepEqual(board.columns[0].items.map((i) => i.id), ['b2'])
  assert.deepEqual(archivedOf(parseItems(t), t).map((i) => i.id), ['a1'])
  t = archiveCard(t, 'b2')
  assert.deepEqual(archivedOf(parseItems(t), t).map((i) => i.id), ['b2', 'a1'])
  // a new column still goes in before the archive
  t = addColumn(t, 'Later')
  assert.deepEqual(boardOf(parseItems(t), t).columns.map((c) => c.name), ['To do', 'Done', 'Later'])
  assert.equal(boardSettings(t).done, 'Done')
})

test('the loose cards get a column of their own', () => {
  const t = nameLooseColumn('---\nname: X\n---\n- [ ] A 🆔 a1\n\n## Done\n', 'Inbox')
  assert.deepEqual(boardOf(parseItems(t), t).columns.map((c) => [c.name, c.items.length]), [['Inbox', 1], ['Done', 0]])
})
