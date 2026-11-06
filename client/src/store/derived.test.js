import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAllItems, selectCalendars, selectLists } from './derived.js'

// your candle's files at the top, other spaces' with their place in the tree (unified views)
const files = {
  'lumen.json': { text: '{"inbox":"inbox"}' },
  'lists/inbox.md': { text: '---\nname: Inbox\n---\n\n- [ ] mine 🆔 a1\n' },
  'workspaces/acme/lists/inbox.md': { text: '---\nname: Inbox\n---\n\n- [ ] team 🆔 b1\n' },
  'shared/ana/calendars/trips.md': { text: '---\nname: Trips\n---\n\n- Lisbon 📅 2026-12-01 🆔 c1\n' },
}
const paths = Object.keys(files)

test('boards and calendars from other spaces keep their place, and say which space', () => {
  const lists = selectLists({ files, paths })
  assert.deepEqual(
    lists.map((l) => [l.path, l.id, l.space]),
    [
      ['lists/inbox.md', 'inbox', ''],
      ['workspaces/acme/lists/inbox.md', 'inbox', 'workspaces/acme/'],
    ],
  )
  const cals = selectCalendars({ files, paths })
  assert.deepEqual(cals.map((c) => [c.id, c.space]), [['trips', 'shared/ana/']])
  const items = selectAllItems({ files, paths })
  assert.deepEqual(
    items.map((i) => [i.title, i.path, i.source.space]),
    [
      ['mine', 'lists/inbox.md', ''],
      ['team', 'workspaces/acme/lists/inbox.md', 'workspaces/acme/'],
      ['Lisbon', 'shared/ana/calendars/trips.md', 'shared/ana/'],
    ],
  )
})
