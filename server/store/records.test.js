import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createStore } from './records.js'

function fresh() {
  let t = 1000
  return createStore(new DatabaseSync(':memory:'), { clock: () => ++t })
}

test('a new record starts at rev 1 and is journaled against its root', () => {
  const s = fresh()
  s.write('board', { id: 'b1', owner: 'u1', name: 'Launch', column_list: [{ name: 'To do' }], labels: { design: 'violet' } })
  s.write('card', { id: 'c1', owner: 'u1', root_type: 'board', root_id: 'b1', col: 'To do', position: 0, kind: 'task', status: ' ', title: 'Pricing', skip: ['2026-11-01'], archived: false })
  const b = s.get('board', 'b1')
  assert.equal(b.rev, 1)
  assert.deepEqual(b.column_list, [{ name: 'To do' }])
  assert.deepEqual(s.get('card', 'c1').skip, ['2026-11-01'])
  assert.equal(s.get('card', 'c1').archived, false)
  assert.deepEqual(
    s.changesSince(0).map((j) => [j.type, j.id, j.root_type, j.root_id, j.kind]),
    [
      ['board', 'b1', 'board', 'b1', 'upsert'],
      ['card', 'c1', 'board', 'b1', 'upsert'],
    ],
  )
})

test('a write that changes nothing makes no revision and no journal row', () => {
  const s = fresh()
  s.write('card', { id: 'c1', owner: 'u1', root_type: 'board', root_id: 'b1', title: 'A', skip: ['2026-11-01'], archived: false })
  const seq = s.highWater()
  const out = s.write('card', { id: 'c1', title: 'A', skip: ['2026-11-01'], archived: false })
  assert.equal(out.changed, false)
  assert.equal(s.get('card', 'c1').rev, 1)
  assert.equal(s.highWater(), seq)
  s.write('card', { id: 'c1', title: 'B' })
  assert.equal(s.get('card', 'c1').rev, 2)
  assert.equal(s.get('card', 'c1').skip[0], '2026-11-01')
})

test('moving a card to another board rewrites both boards', () => {
  const s = fresh()
  s.write('card', { id: 'c1', owner: 'u1', root_type: 'board', root_id: 'b1', title: 'A' })
  const seq = s.highWater()
  s.write('card', { id: 'c1', root_id: 'b2' })
  assert.deepEqual(
    s.changesSince(seq).map((j) => j.root_id).sort(),
    ['b1', 'b2'],
  )
})

test('changing the owner takes the record out of the old owner’s mirror', () => {
  const s = fresh()
  s.write('doc', { id: 'd1', owner: 'u1', title: 'Plan' })
  const seq = s.highWater()
  s.write('doc', { id: 'd1', owner: 'u2' })
  const rows = s.changesSince(seq)
  assert.deepEqual(rows.map((j) => [j.owner, j.kind]).sort(), [['u1', 'delete'], ['u2', 'upsert']])
  assert.deepEqual(s.changesSince(0, { owner: 'u1' }).map((j) => j.kind), ['upsert', 'delete'])
})

test('deleting leaves a tombstone, journaled once; writing again revives it', () => {
  const s = fresh()
  s.write('block', { id: 'k1', owner: 'u1', doc_id: 'd1', position: 0, type: 'paragraph', text: 'hi' })
  s.remove('block', 'k1')
  s.remove('block', 'k1')
  assert.equal(s.get('block', 'k1').deleted, true)
  assert.deepEqual(s.where('block', 'doc_id', 'd1'), [])
  assert.equal(s.where('block', 'doc_id', 'd1', { deleted: true }).length, 1)
  assert.deepEqual(s.changesSince(0).map((j) => [j.kind, j.root_id]), [['upsert', 'd1'], ['delete', 'd1']])
  s.write('block', { id: 'k1', text: 'back' })
  assert.equal(s.get('block', 'k1').deleted, false)
})

test('a transaction that fails leaves nothing behind, journal included', () => {
  const s = fresh()
  assert.throws(() =>
    s.tx(() => {
      s.write('board', { id: 'b1', owner: 'u1', name: 'A' })
      s.write('board', { id: 'b2', name: 'no owner' })
    }),
  )
  assert.equal(s.get('board', 'b1'), null)
  assert.equal(s.highWater(), 0)
})

test('unknown columns are refused rather than silently dropped', () => {
  const s = fresh()
  assert.throws(() => s.write('board', { id: 'b1', owner: 'u1', colour: 'red' }), /no column colour/)
})

test('a chat message belongs to its channel’s month file', () => {
  const s = fresh()
  s.write('message', { id: 'm1', owner: 'u1', channel: 'general', at: '2026-10-31T10:02:11.120Z', author: 'nikhil', text: 'Morning' })
  assert.deepEqual(s.changesSince(0).map((j) => [j.root_type, j.root_id]), [['chat_month', 'general/2026-10']])
})
