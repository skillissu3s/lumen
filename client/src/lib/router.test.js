import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHash } from './router.js'

test('parseHash', () => {
  assert.deepEqual(parseHash('#/calendar?view=week&date=2026-11-02'), {
    path: '/calendar',
    parts: ['calendar'],
    query: { view: 'week', date: '2026-11-02' },
  })
  assert.deepEqual(parseHash('#/list/inbox'), { path: '/list/inbox', parts: ['list', 'inbox'], query: {} })
  assert.deepEqual(parseHash('#/docs/notes/a.md'), { path: '/docs/notes/a.md', parts: ['docs', 'notes', 'a.md'], query: {} })
  assert.deepEqual(parseHash('#/plugin/focus-forest'), { path: '/plugin/focus-forest', parts: ['plugin', 'focus-forest'], query: {} })
  assert.deepEqual(parseHash(''), { path: '/', parts: [], query: {} })
  assert.deepEqual(parseHash('#'), { path: '/', parts: [], query: {} })
  assert.deepEqual(parseHash('#/path?multi=1&multi=2'), { path: '/path', parts: ['path'], query: { multi: '2' } })
})
