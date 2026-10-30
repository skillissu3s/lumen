import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItems, parseLine, updateItem, addItem, removeItem, moveItem, skipOccurrence, endSeriesBefore, formatLine, flatItems } from './items.js'

const ids = (...list) => {
  let i = 0
  return () => list[i++] || `gen${i}`
}

const LIST = `---
name: Errands
owner: nikhil
---
## This week
- [ ] 📞 Call the bank #admin ⏫ 📅 2026-11-02 ⏰ 10:30 ⏱ 15m 🆔 k3j9x2
    Ask about the transfer limit.

    Second paragraph.
    - [ ] Find the account number 🆔 p0q81a
    - [x] Check statement ✅ 2026-10-30 🆔 m2n7bb
- [/] Write report ⏳ 2026-11-03 🔁 every week 🆔 a9d0ee

## Later
- [ ] Plain one
`

test('parses fields, notes, subtasks and sections', () => {
  const p = parseItems(LIST)
  assert.equal(p.meta.name, 'Errands')
  assert.equal(p.items.length, 3)
  const bank = p.all.get('k3j9x2')
  assert.equal(bank.icon, '📞')
  assert.equal(bank.label, 'Call the bank #admin')
  assert.deepEqual(bank.tags, ['admin'])
  assert.equal(bank.priority, 'high')
  assert.equal(bank.date, '2026-11-02')
  assert.equal(bank.time, '10:30')
  assert.equal(bank.duration, 15)
  assert.equal(bank.section, 'This week')
  assert.equal(bank.notes, 'Ask about the transfer limit.\n\nSecond paragraph.')
  assert.equal(bank.subtasks.length, 2)
  assert.equal(bank.subtasks[1].done, '2026-10-30')
  assert.equal(p.all.get('a9d0ee').status, '/')
  const plain = p.items[2]
  assert.equal(plain.hasId, false)
  assert.equal(plain.section, 'Later')
  assert.match(plain.id, /^~/)
})

test('events are plain list lines in calendar files', () => {
  const cal = '- 🧍 Standup 📅 2026-11-02 ⏰ 9:30 ⏱ 15m 🔁 every weekday 🚫 2026-11-11 📍 Room 4 🆔 ev01\n  - not an event, a note\n'
  const p = parseItems(cal, { events: true })
  assert.equal(p.items.length, 1)
  const ev = p.items[0]
  assert.equal(ev.kind, 'event')
  assert.equal(ev.status, null)
  assert.equal(ev.time, '09:30')
  assert.equal(ev.recurrence, 'every weekday')
  assert.deepEqual(ev.skip, ['2026-11-11'])
  assert.equal(ev.location, 'Room 4')
  assert.equal(ev.notes, '- not an event, a note')
  assert.equal(parseItems(cal).items.length, 0)
})

test('format round-trips a line', () => {
  const line = '- [ ] 📞 Call #admin ⏫ 🔁 every week 📅 2026-11-02 ⏰ 10:30 ⏱ 1h30m 🆔 k3'
  assert.equal(formatLine(parseLine(line)), line)
})

test('completing stamps the date; reopening takes it off', () => {
  let t = updateItem(LIST, 'k3j9x2', { status: 'x' }, { today: '2026-11-01' }).text
  assert.match(t, /- \[x\] 📞 Call the bank #admin ⏫ 📅 2026-11-02 ⏰ 10:30 ⏱ 15m ✅ 2026-11-01 🆔 k3j9x2/)
  t = updateItem(t, 'k3j9x2', { status: ' ' }).text
  assert.ok(!t.includes('✅ 2026-11-01'))
})

test('completing a repeating task writes the next one below its checklist', () => {
  const src = '- [ ] Water plants 📅 2026-11-02 🔁 every week 🆔 w1\n    - [x] Balcony ✅ 2026-11-01 🆔 s1\n- [ ] Next 🆔 n1\n'
  const r = updateItem(src, 'w1', { status: 'x' }, { today: '2026-11-02', makeId: ids('w2', 's2') })
  assert.equal(r.next, 'w2')
  assert.equal(
    r.text,
    '- [x] Water plants 🔁 every week 📅 2026-11-02 ✅ 2026-11-02 🆔 w1\n    - [x] Balcony ✅ 2026-11-01 🆔 s1\n- [ ] Water plants 🔁 every week 📅 2026-11-09 🆔 w2\n    - [ ] Balcony 🆔 s2\n- [ ] Next 🆔 n1\n',
  )
})

test('editing a line without an id gives it one', () => {
  const p = parseItems(LIST)
  const plain = p.items[2]
  const r = updateItem(LIST, plain.id, { date: '2026-12-01' }, { makeId: () => 'zz9' })
  assert.match(r.text, /- \[ \] Plain one 📅 2026-12-01 🆔 zz9\n$/)
  assert.equal(r.id, 'zz9')
})

test('notes are replaced in place, subtasks kept', () => {
  const r = updateItem(LIST, 'k3j9x2', { notes: 'New note\nline two' })
  const bank = parseItems(r.text).all.get('k3j9x2')
  assert.equal(bank.notes, 'New note\nline two')
  assert.equal(bank.subtasks.length, 2)
})

test('title and icon edits', () => {
  let t = updateItem(LIST, 'k3j9x2', { icon: '🏦' }).text
  assert.equal(parseItems(t).all.get('k3j9x2').title, '🏦 Call the bank #admin')
  t = updateItem(t, 'k3j9x2', { label: 'Phone bank' }).text
  assert.equal(parseItems(t).all.get('k3j9x2').title, '🏦 Phone bank')
  t = updateItem(t, 'k3j9x2', { icon: null }).text
  assert.equal(parseItems(t).all.get('k3j9x2').title, 'Phone bank')
})

test('add: end of file, in a section, as a subtask, at the top', () => {
  let r = addItem(LIST, { title: 'Buy milk', date: '2026-11-04' }, {}, { makeId: () => 'b1' })
  assert.match(r.text, /- \[ \] Plain one\n- \[ \] Buy milk 📅 2026-11-04 🆔 b1\n$/)
  r = addItem(LIST, { title: 'In week' }, { section: 'This week' }, { makeId: () => 'w9' })
  const p = parseItems(r.text)
  assert.equal(p.all.get('w9').section, 'This week')
  assert.equal(p.items.findIndex((i) => i.id === 'w9'), 2)
  r = addItem(LIST, { title: 'Sub' }, { parent: 'k3j9x2' }, { makeId: () => 's9' })
  assert.equal(parseItems(r.text).all.get('k3j9x2').subtasks.length, 3)
  r = addItem('', { title: 'First', status: null }, {}, { makeId: () => 'f1', events: true })
  assert.equal(r.text, '- First 🆔 f1\n')
  r = addItem('---\nname: x\n---\n', { title: 'A' }, {}, { makeId: () => 'a1' })
  assert.equal(r.text, '---\nname: x\n---\n- [ ] A 🆔 a1\n')
  r = addItem('---\nname: x\n---\n- [ ] B 🆔 b\n', { title: 'A' }, { top: true }, { makeId: () => 'a1' })
  assert.equal(r.text, '---\nname: x\n---\n- [ ] A 🆔 a1\n- [ ] B 🆔 b\n')
})

test('remove and move keep the checklist with the item', () => {
  const r = removeItem(LIST, 'k3j9x2')
  assert.equal(r.block.length, 6)
  assert.ok(!r.text.includes('Find the account'))
  const moved = moveItem(LIST, 'k3j9x2', { section: 'Later' })
  const p = parseItems(moved)
  assert.equal(p.all.get('k3j9x2').section, 'Later')
  assert.equal(p.all.get('k3j9x2').subtasks.length, 2)
  const before = moveItem(LIST, 'a9d0ee', { before: 'k3j9x2' })
  assert.deepEqual(parseItems(before).items.map((i) => i.title).slice(0, 2), ['Write report', '📞 Call the bank #admin'])
})

test('duplicate ids from a union merge: the later line wins', () => {
  const p = parseItems('- [ ] A 🆔 x\n- [x] A ✅ 2026-11-01 🆔 x\n- [ ] B 🆔 y\n')
  assert.equal(p.items.length, 2)
  assert.equal(p.all.get('x').status, 'x')
  assert.equal(flatItems(p).length, 2)
})

test('skip one occurrence and end a series', () => {
  const cal = '- Gym 📅 2026-11-02 ⏰ 07:00 🔁 every mon, wed 🆔 g\n'
  let t = skipOccurrence(cal, 'g', '2026-11-04', { events: true })
  assert.match(t, /🚫 2026-11-04/)
  t = endSeriesBefore(t, 'g', '2026-11-16', { events: true })
  assert.match(t, /🔁 every mon, wed until 2026-11-15/)
})

test('rejects bad values', () => {
  assert.throws(() => updateItem(LIST, 'k3j9x2', { date: '2026-13-01' }), RangeError)
  assert.throws(() => updateItem(LIST, 'k3j9x2', { recurrence: 'whenever' }), RangeError)
  assert.throws(() => updateItem(LIST, 'nope', { date: '2026-11-01' }), /gone/)
})

test('CRLF files stay CRLF', () => {
  const src = '- [ ] A 🆔 a\r\n- [ ] B 🆔 b\r\n'
  const t = updateItem(src, 'a', { status: 'x' }, { today: '2026-11-01' }).text
  assert.equal(t, '- [x] A ✅ 2026-11-01 🆔 a\r\n- [ ] B 🆔 b\r\n')
  const added = addItem(src, { title: 'C' }, {}, { makeId: () => 'c' }).text
  assert.equal(added, '- [ ] A 🆔 a\r\n- [ ] B 🆔 b\r\n- [ ] C 🆔 c\r\n')
})
