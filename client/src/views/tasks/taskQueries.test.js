import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItems, flatItems } from '../../../../shared/items.js'
import { todayGroups, upcomingGroups, listGroups, BOARD, progressOf } from './taskQueries.js'

const TODAY = '2026-11-02'
const TEXT = `## Week
- [ ] Late 📅 2026-10-30 🆔 a
- [ ] Today later ⏰ 15:00 📅 2026-11-02 🆔 b
- [ ] Today early ⏰ 09:00 📅 2026-11-02 🆔 c
    - [x] sub ✅ 2026-11-01 🆔 c1
    - [ ] sub2 🆔 c2
- [x] Finished ✅ 2026-11-02 🆔 d
## Later
- [ ] Tomorrow ⏫ 📅 2026-11-03 🆔 e
- [ ] Undated 🆔 f
`
const list = { ...parseItems(TEXT), path: 'lists/x.md' }
const items = flatItems(list).map((i) => ({ ...i, path: 'lists/x.md' }))

test('today groups', () => {
  const g = todayGroups(items, TODAY)
  assert.deepEqual(g.overdue.map((i) => i.id), ['a'])
  assert.deepEqual(g.today.map((i) => i.id), ['c', 'b'])
  assert.deepEqual(g.done.map((i) => i.id), ['d'])
})

test('upcoming groups', () => {
  const g = upcomingGroups(items, TODAY, 7)
  assert.equal(g[0].label, 'Tomorrow')
  assert.deepEqual(g[0].items.map((i) => i.id), ['e'])
  assert.deepEqual(g.at(-1).items.map((i) => i.id), ['f'])
})

test('list groups by section, priority, date', () => {
  const s = listGroups(list, { today: TODAY })
  assert.deepEqual(s.map((g) => g.label), [null, 'Week', 'Later'])
  assert.deepEqual(s[1].items.map((i) => i.id), ['a', 'b', 'c'])
  const withDone = listGroups(list, { today: TODAY, showCompleted: true })
  assert.equal(withDone[1].items.length, 4)
  const p = listGroups(list, { today: TODAY, groupBy: 'priority' })
  assert.equal(p[0].label, 'High')
  const d = listGroups(list, { today: TODAY, groupBy: 'date' })
  assert.deepEqual(d.map((g) => g.id), ['overdue', 'today', 'tomorrow', 'none'])
})

test('board columns and progress', () => {
  const c = items.find((i) => i.id === 'c')
  assert.equal(BOARD.date.of(c, TODAY), 'today')
  assert.deepEqual(BOARD.status.patch('doing'), { status: '/' })
  assert.equal(BOARD.date.patch('overdue', TODAY), null)
  assert.deepEqual(progressOf(c), { done: 1, total: 2 })
})
