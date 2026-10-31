import test from 'node:test'
import assert from 'node:assert/strict'
import { viewDays, stepDate, periodTitle, yToMinutes, minutesToY, xToColumn, dragRange, colorOf, movePatch } from './calendarMath.js'

test('view ranges', () => {
  assert.deepEqual(viewDays('week', '2026-11-04', { weekStart: 1 }), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
  assert.equal(viewDays('week', '2026-11-04', { weekStart: 1, showWeekends: false }).length, 5)
  assert.equal(viewDays('week', '2026-11-04', { weekStart: 0 })[0], '2026-11-01')
  assert.equal(viewDays('month', '2026-11-15', { weekStart: 1 }).length % 7, 0)
  assert.deepEqual(viewDays('3day', '2026-11-04'), ['2026-11-04', '2026-11-05', '2026-11-06'])
  assert.equal(stepDate('month', '2026-01-31', 1), '2026-02-28')
  assert.equal(stepDate('week', '2026-11-04', -1), '2026-10-28')
})

test('titles', () => {
  assert.equal(periodTitle('week', viewDays('week', '2026-11-04')), '2 – 8 Nov 2026')
  assert.equal(periodTitle('week', viewDays('week', '2026-10-28')), '26 Oct – 1 Nov 2026')
  assert.equal(periodTitle('month', viewDays('month', '2026-11-15')), 'November 2026')
  assert.equal(periodTitle('day', ['2026-11-04']), 'Wednesday, 4 November')
})

test('pixels and minutes', () => {
  const g = { hourHeight: 48, dayStart: 6, snap: 15 }
  assert.equal(yToMinutes(0, g), 360)
  assert.equal(yToMinutes(48 * 3 + 20, g), 9 * 60 + 30)
  assert.equal(minutesToY(9 * 60, g), 144)
  assert.equal(xToColumn(250, 700, 7), 2)
  assert.equal(xToColumn(-5, 700, 7), 0)
  assert.deepEqual(dragRange('2026-11-04', 600, 540, 15), { date: '2026-11-04', startMin: 540, duration: 60 })
  assert.deepEqual(dragRange('2026-11-04', 600, 600, 15), { date: '2026-11-04', startMin: 600, duration: 15 })
})

test('colours and moves', () => {
  assert.equal(colorOf({ kind: 'event', source: { color: 'green' } }, 'calendar'), 'green')
  assert.equal(colorOf({ kind: 'event', color: 'pink', source: { color: 'green' } }, 'item'), 'pink')
  assert.equal(colorOf({ kind: 'task', priority: 'high' }, 'priority'), 'orange')
  assert.deepEqual(movePatch({ kind: 'task', scheduled: '2026-11-04' }, '2026-11-04', '2026-11-06', '10:00'), { scheduled: '2026-11-06', time: '10:00' })
  assert.deepEqual(movePatch({ kind: 'event', date: '2026-11-02', endDate: '2026-11-03' }, '2026-11-02', '2026-11-05'), { date: '2026-11-05', endDate: '2026-11-06' })
  // a repeating series moved from one of its later occurrences shifts its start by the same amount
  assert.deepEqual(movePatch({ kind: 'event', date: '2026-11-02' }, '2026-11-09', '2026-11-10', '08:00'), { date: '2026-11-03', time: '08:00' })
})
