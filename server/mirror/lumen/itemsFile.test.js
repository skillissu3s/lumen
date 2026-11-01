import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignIds, parse, render } from './itemsFile.js'

const BOARD = `---
id: b_8f2kq7x1ma
name: Product launch
color: pink
icon: rocket
owner: nikhil
kanban-plugin: board
---

## To do

- [ ] Pricing page layout #design ⏫ 📅 2026-11-12 🆔 a1b2c3
    Two options, one with yearly prices.
    - [ ] Draft copy 🆔 a1b2c4

## Doing

- [/] Launch email ⏳ 2026-11-04 🆔 k3j9x2

## Done

- [x] Pick a launch date ✅ 2026-10-28 🆔 z9y8x7

***

## Archive

- [x] Old idea ✅ 2026-09-01 🆔 q1w2e3

%% kanban:settings
\`\`\`
{"kanban-plugin":"board","lumen":{"done":"Done","columns":{"Done":"green"},"labels":{"design":"violet"},"covers":{"a1b2c3":"orange"}}}
\`\`\`
%%
`

const CALENDAR = `---
id: c_w0rk1ca1en
name: Work
color: blue
default: true
owner: nikhil
---

- 🧍 Standup 🔁 every weekday 📅 2026-11-02 ⏰ 09:30 ⏱ 15m 🚫 2026-11-11 🆔 ev01st
- ✈️ Conference 📅 2026-11-18 🔚 2026-11-20 🆔 ev02cf
- Dentist 📅 2026-11-05 ⏰ 16:00 ⏱ 1h 📍 Main St clinic 🆔 ev03dn
`

test('a board written by Lumen comes back byte for byte', () => {
  const { root, cards, warnings } = parse(BOARD)
  assert.deepEqual(warnings, [])
  assert.equal(root.id, 'b_8f2kq7x1ma')
  assert.deepEqual(root.columns.map((c) => [c.name, c.color]), [['To do', null], ['Doing', null], ['Done', 'green']])
  assert.equal(cards.find((c) => c.id === 'a1b2c4').parent, 'a1b2c3')
  assert.equal(cards.find((c) => c.id === 'a1b2c3').cover, 'orange')
  assert.equal(cards.find((c) => c.id === 'a1b2c3').notes, 'Two options, one with yearly prices.')
  assert.equal(cards.find((c) => c.id === 'q1w2e3').archived, true)
  assert.equal(render(root, cards), BOARD)
})

test('a calendar comes back byte for byte', () => {
  const { root, cards } = parse(CALENDAR, { kind: 'calendar' })
  assert.equal(root.isDefault, true)
  assert.equal(cards.length, 3)
  assert.equal(cards[0].kind, 'event')
  assert.deepEqual(cards[0].skip, ['2026-11-11'])
  assert.equal(render(root, cards, { kind: 'calendar' }), CALENDAR)
})

test('a hand-made file keeps everything and settles after one pass', () => {
  const messy = [
    '---',
    'name: Errands',
    'tags: [home]',
    '---',
    'Things to do around the house.',
    '- [X] Buy bulbs',
    '## Weekend',
    'Only if it is sunny.',
    '- [ ] Wash the car 📅 2026-11-08',
    '\t- [ ] Find the sponge',
    '%% kanban:settings',
    '```',
    '{"kanban-plugin":"board","lane-width":300}',
    '```',
    '%%',
  ].join('\r\n')
  let n = 0
  const first = assignIds(parse(messy), (kind) => `${kind}${++n}`)
  assert.equal(first.root.extra.meta.tags[0], 'home')
  assert.equal(first.root.extra.kanban['lane-width'], 300)
  assert.match(first.root.extra.text[''], /around the house/)
  assert.match(first.root.extra.text.Weekend, /sunny/)
  assert.equal(first.cards.find((c) => c.title === 'Buy bulbs').status, 'x')
  const sponge = first.cards.find((c) => c.title === 'Find the sponge')
  assert.equal(sponge.parent, first.cards.find((c) => c.title === 'Wash the car').id)

  const once = render(first.root, first.cards)
  const again = parse(once)
  assert.deepEqual(again.warnings.length, 1) // the loose text, still there
  assert.equal(render(again.root, again.cards), once)
  assert.match(once, /^id: board\d+$/m)
  assert.match(once, /lane-width/)
})

// ---- random boards: parse(render(state)) is the state ----

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

function randomBoard(seed) {
  const r = rng(seed)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const word = () => pick(['plan', 'call', 'write', 'fix', 'ship', 'review', 'draft', 'book', 'order', 'clean'])
  const id = () => Math.floor(r() * 36 ** 6).toString(36).padStart(6, '0')
  const date = () => `2026-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
  const columns = ['To do', 'Doing', 'Done', 'Later'].slice(0, 1 + Math.floor(r() * 4)).map((name) => ({ name, color: r() < 0.4 ? pick(['blue', 'green', 'red']) : null }))
  const root = { type: 'board', id: `b_${id()}`, name: `Board ${word()}`, columns, done: r() < 0.5 ? columns[columns.length - 1].name : null, labels: r() < 0.5 ? { home: 'green', work: 'blue' } : {}, extra: {} }
  if (r() < 0.5) root.color = pick(['pink', 'teal'])
  if (r() < 0.5) root.owner = 'nikhil'
  if (r() < 0.3) root.share = 'everyone'
  const cards = []
  const make = (parent, column, archived, position) => {
    const c = { id: id(), parent, column, archived, position, kind: 'task', status: pick([' ', 'x', '/', '-']), title: `${word()} ${word()}${r() < 0.3 ? ' #home' : ''}`, notes: '' }
    if (r() < 0.4) c.priority = pick(['highest', 'high', 'medium', 'low', 'lowest'])
    if (r() < 0.5) c.date = date()
    if (r() < 0.2) c.scheduled = date()
    if (r() < 0.2) c.time = pick(['09:00', '13:30', '18:45'])
    if (r() < 0.2) c.duration = pick([15, 30, 90])
    if (r() < 0.15) c.recurrence = pick(['every day', 'every week', 'every 2 weeks'])
    if (r() < 0.15) c.location = 'Main St'
    if (r() < 0.2 && c.status === 'x') c.done = date()
    if (r() < 0.2) c.notes = r() < 0.5 ? 'one line of notes' : 'first paragraph\n\nsecond paragraph'
    if (!parent && r() < 0.15) c.cover = pick(['orange', 'violet'])
    cards.push(c)
    return c
  }
  for (const col of columns) {
    const n = Math.floor(r() * 5)
    for (let i = 0; i < n; i++) {
      const c = make(null, col.name, false, i)
      const subs = r() < 0.3 ? 1 + Math.floor(r() * 3) : 0
      for (let j = 0; j < subs; j++) make(c.id, null, false, j)
    }
  }
  const archived = r() < 0.3 ? 1 + Math.floor(r() * 2) : 0
  for (let i = 0; i < archived; i++) make(null, null, true, i)
  return { root, cards }
}

const comparable = (cards) =>
  cards
    .map(({ ref, ...c }) => c)
    .sort((a, b) => a.id.localeCompare(b.id))

test('random boards survive render then parse, and render the same twice', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const { root, cards } = randomBoard(seed)
    const text = render(root, cards)
    assert.equal(render(root, structuredClone(cards).reverse()), text, `seed ${seed}: order of rows changed the file`)
    const back = parse(text)
    assert.deepEqual(back.warnings, [], `seed ${seed}`)
    assert.equal(back.root.id, root.id)
    assert.deepEqual(back.root.columns, root.columns, `seed ${seed}`)
    assert.equal(back.root.done ?? null, root.done ?? null, `seed ${seed}`)
    assert.deepEqual(back.root.labels, root.labels, `seed ${seed}`)
    // the archived cards' subtasks don't exist here, and archived cards have no column
    const want = comparable(cards.map((c) => ({ ...c, parent: c.parent ?? null })))
    const got = comparable(back.cards.map((c) => ({ ...c, parent: c.parent ?? null })))
    assert.deepEqual(got, want, `seed ${seed}`)
  }
})
