import test from 'node:test'
import assert from 'node:assert/strict'
import { spacesFromTree } from './spaces.js'

test('offline, the spaces are worked out from the files kept in this browser', () => {
  const tree = {
    'lumen.json': { text: '{"name":"Ada’s candle"}' },
    'workspaces/crew/lumen.json': { text: '{"name":"Crew"}' },
  }
  const paths = ['lists/inbox.md', 'lumen.json', 'workspaces/crew/lumen.json', 'workspaces/crew/lists/inbox.md', 'shared/bob/lists/bobs.md', 'workspaces/old/lists/x.md']
  assert.deepEqual(
    spacesFromTree(tree, paths, 'Ada').map((s) => [s.prefix, s.kind, s.name]),
    [
      ['', 'candle', 'Ada’s candle'],
      ['workspaces/crew/', 'workspace', 'Crew'],
      ['shared/bob/', 'shared', 'bob'],
      ['workspaces/old/', 'workspace', 'old'],
    ],
  )
})
