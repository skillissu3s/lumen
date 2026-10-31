import test from 'node:test'
import assert from 'node:assert/strict'
import { idbGet, idbSet, idbDel } from './idb.js'

test('idb no-ops gracefully without IndexedDB', async () => {
  assert.equal(await idbGet('missing'), undefined)
  await idbSet('key', 'value')
  await idbDel('key')
})
