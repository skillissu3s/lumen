import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSegments, splitByMidnight, summarizeDay, localIso, nextLocalMidnight, IDLE_APP, PRIVATE_APP } from './activity.js'

test('buildSegments merges consecutive samples of the same app', () => {
  const samples = [
    { at: 0, app: 'Code', idle: 0 },
    { at: 5000, app: 'Code', idle: 5 },
    { at: 10000, app: 'Code', idle: 8 },
    { at: 15000, app: 'Browser', idle: 3 },
    { at: 20000, app: 'Browser', idle: 6 },
  ]
  const segments = buildSegments(samples)
  assert.deepEqual(segments, [
    { app: 'Code', start: 0, end: 15000 },
    { app: 'Browser', start: 15000, end: 20000 },
  ])
})

test('buildSegments splits idle runs out and back', () => {
  const samples = [
    { at: 0, app: 'Code', idle: 0 },
    { at: 5000, app: 'Code', idle: 10 },
    { at: 10000, app: 'Code', idle: 130 },
    { at: 15000, app: 'Code', idle: 200 },
    { at: 20000, app: 'Code', idle: 5 },
  ]
  const segments = buildSegments(samples, { idleSeconds: 120 })
  assert.deepEqual(segments, [
    { app: 'Code', start: 0, end: 10000 },
    { app: IDLE_APP, start: 10000, end: 20000 },
    { app: 'Code', start: 20000, end: 20000 },
  ])
})

test('buildSegments records excluded apps as Private', () => {
  const samples = [
    { at: 0, app: 'Terminal', idle: 0 },
    { at: 5000, app: 'Terminal', idle: 1 },
    { at: 10000, app: 'Code', idle: 0 },
  ]
  const segments = buildSegments(samples, { excluded: ['Terminal'] })
  assert.deepEqual(segments, [
    { app: PRIVATE_APP, start: 0, end: 10000 },
    { app: 'Code', start: 10000, end: 10000 },
  ])
})

test('buildSegments records window titles only when recordTitles is on', () => {
  const samples = [
    { at: 0, app: 'Code', title: 'a.js', idle: 0 },
    { at: 5000, app: 'Code', title: 'b.js', idle: 0 },
  ]
  assert.deepEqual(buildSegments(samples), [
    { app: 'Code', start: 0, end: 5000 },
  ])
  assert.deepEqual(buildSegments(samples, { recordTitles: true }), [
    { app: 'Code', title: 'a.js', start: 0, end: 5000 },
    { app: 'Code', title: 'b.js', start: 5000, end: 5000 },
  ])
})

test('splitByMidnight splits a segment that crosses local midnight', () => {
  const start = new Date(2026, 10, 2, 23, 50, 0).getTime()
  const end = new Date(2026, 10, 3, 0, 10, 0).getTime()
  const midnight = nextLocalMidnight(start)
  const parts = splitByMidnight([{ app: 'Code', start, end }])
  assert.equal(parts.length, 2)
  assert.equal(parts[0].iso, '2026-11-02')
  assert.deepEqual(parts[0].segment, { app: 'Code', start, end: midnight })
  assert.equal(parts[1].iso, '2026-11-03')
  assert.deepEqual(parts[1].segment, { app: 'Code', start: midnight, end })
})

test('splitByMidnight leaves within-day segments untouched', () => {
  const start = new Date(2026, 10, 2, 9, 0, 0).getTime()
  const end = new Date(2026, 10, 2, 10, 0, 0).getTime()
  const parts = splitByMidnight([{ app: 'Code', start, end }])
  assert.deepEqual(parts, [{ iso: localIso(start), segment: { app: 'Code', start, end } }])
})

test('summarizeDay totals idle ms, returns active segments and counts switches', () => {
  const segments = [
    { app: 'Code', start: 0, end: 10000 },
    { app: IDLE_APP, start: 10000, end: 70000 },
    { app: 'Browser', start: 70000, end: 80000 },
    { app: 'Browser', start: 80000, end: 90000 },
  ]
  const summary = summarizeDay(segments)
  assert.deepEqual(summary.segments, [
    { app: 'Code', start: 0, end: 10000 },
    { app: 'Browser', start: 70000, end: 80000 },
    { app: 'Browser', start: 80000, end: 90000 },
  ])
  assert.equal(summary.idleMs, 60000)
  assert.equal(summary.switches, 1)
})
