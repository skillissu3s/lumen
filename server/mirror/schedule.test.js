import { test } from 'node:test'
import assert from 'node:assert/strict'
import { afterChange, backoff, cleanSchedule, nextAt, nextRun } from './schedule.js'

const at = (s) => Date.parse(s)
const MIN = 60000

test('schedules from a request get defaults and limits', () => {
  assert.equal(cleanSchedule('manual', {}), null)
  assert.deepEqual(cleanSchedule('after-changes', {}), { quiet: 10, max: 60 })
  assert.deepEqual(cleanSchedule('interval', { every: 99 }), { every: 24 })
  assert.deepEqual(cleanSchedule('daily', { at: '25:00', tz: 'Nowhere/City' }), { at: '03:00', tz: 'UTC' })
  assert.deepEqual(cleanSchedule('weekly', { at: '18:30', tz: 'Asia/Kolkata', day: 5 }), { at: '18:30', tz: 'Asia/Kolkata', day: 5 })
  assert.throws(() => cleanSchedule('hourly'), /Choose when/)
})

test('daily at 03:00 in a time zone', () => {
  const s = { at: '03:00', tz: 'Asia/Kolkata' } // UTC+5:30
  assert.equal(nextAt(at('2026-11-05T10:00:00Z'), s), at('2026-11-05T21:30:00Z'))
  assert.equal(nextAt(at('2026-11-05T21:30:00Z'), s), at('2026-11-06T21:30:00Z'))
  assert.equal(nextAt(at('2026-11-05T21:00:00Z'), s), at('2026-11-05T21:30:00Z'))
})

test('across daylight saving time the wall clock is kept', () => {
  const s = { at: '09:00', tz: 'America/New_York' }
  // the US leaves DST on 1 November 2026
  assert.equal(nextAt(at('2026-10-31T14:00:00Z'), s), at('2026-11-01T14:00:00Z'))
  assert.equal(nextAt(at('2026-10-30T12:00:00Z'), s), at('2026-10-30T13:00:00Z'))
})

test('weekly on a weekday', () => {
  // 5 November 2026 is a Thursday; Monday is day 1
  assert.equal(nextAt(at('2026-11-05T10:00:00Z'), { at: '08:00', tz: 'UTC', day: 1 }), at('2026-11-09T08:00:00Z'))
  assert.equal(nextAt(at('2026-11-05T07:00:00Z'), { at: '08:00', tz: 'UTC', day: 4 }), at('2026-11-05T08:00:00Z'))
})

test('timed runs are spread over two minutes, the same way each time', () => {
  const now = at('2026-11-05T10:00:00Z')
  const conn = { id: 'c1', mode: 'daily', schedule: { at: '12:00', tz: 'UTC' } }
  const t = nextRun(conn, now)
  assert.ok(t >= at('2026-11-05T12:00:00Z') && t < at('2026-11-05T12:02:00Z'))
  assert.equal(nextRun(conn, now), t)
  const every = { id: 'c1', mode: 'interval', schedule: { every: 6 }, last_run_at: now - 2 * 3600000 }
  assert.ok(nextRun(every, now) - (now + 4 * 3600000) < 2 * MIN)
  assert.equal(nextRun({ mode: 'manual' }, now), null)
})

test('after changes: quiet for a while, but not later than the limit', () => {
  const conn = { mode: 'after-changes', schedule: { quiet: 10, max: 30 } }
  const t0 = at('2026-11-05T10:00:00Z')
  const a = afterChange(conn, t0)
  assert.deepEqual(a, { first_change_at: t0, next_run_at: t0 + 10 * MIN })
  const b = afterChange({ ...conn, ...a }, t0 + 25 * MIN)
  assert.equal(b.next_run_at, t0 + 30 * MIN)
  assert.equal(afterChange({ mode: 'daily' }, t0), null)
})

test('failed runs back off up to six hours', () => {
  assert.deepEqual([1, 2, 3, 4].map(backoff), [1, 2, 4, 8].map((m) => m * MIN))
  assert.equal(backoff(30), 6 * 3600000)
})
