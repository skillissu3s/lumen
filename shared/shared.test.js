import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRecurrence, formatRecurrence, occurrencesBetween } from './recurrence.js'
import { parseQuickAdd } from './quickadd.js'
import { parseDuration, formatDuration, formatTime, isoWeek } from './dates.js'
import { splitFrontMatter, setFrontMatter, withFrontMatter } from './frontmatter.js'
import { expand, layoutDay, freeGaps } from './calendar.js'
import { toIcs, fromIcs } from './ics.js'
import { rebaseText, blobSha } from './merge.js'
import { parseItems } from './items.js'

test('recurrence rules', () => {
  assert.deepEqual(parseRecurrence('every 2 weeks'), { unit: 'week', n: 2, whenDone: false })
  assert.deepEqual(parseRecurrence('every mon and fri').weekdays, [1, 5])
  assert.deepEqual(parseRecurrence('every 2 weeks on tue, thu').weekdays, [2, 4])
  assert.equal(parseRecurrence('every weekday until 2026-12-01').until, '2026-12-01')
  assert.equal(parseRecurrence('daily').unit, 'day')
  assert.equal(parseRecurrence('sometimes'), null)
  assert.equal(formatRecurrence(parseRecurrence('every monday, and friday')), 'every mon, fri')
})

test('occurrences', () => {
  assert.deepEqual(occurrencesBetween('every weekday', '2026-11-02', '2026-11-06', '2026-11-10', { skip: ['2026-11-09'] }), ['2026-11-06', '2026-11-10'])
  assert.deepEqual(occurrencesBetween('every month', '2026-01-31', '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30'])
  assert.deepEqual(occurrencesBetween('every 2 weeks on mon', '2026-11-02', '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-16', '2026-11-30'])
  assert.deepEqual(occurrencesBetween('every day until 2026-11-03', '2026-11-01', '2026-11-01', '2026-11-30'), ['2026-11-01', '2026-11-02', '2026-11-03'])
  assert.equal(occurrencesBetween('every day', '2020-01-01', '2026-11-01', '2026-11-02').length, 2)
})

test('quick add', () => {
  const today = '2026-10-31' // a Saturday
  let r = parseQuickAdd('Gym tomorrow 7am for 1h every mon !high', { today })
  assert.equal(r.title, 'Gym')
  assert.equal(r.date, '2026-11-01')
  assert.equal(r.time, '07:00')
  assert.equal(r.duration, 60)
  assert.equal(r.recurrence, 'every mon')
  assert.equal(r.priority, 'high')
  r = parseQuickAdd('Standup 9:30-9:45 every weekday', { today })
  assert.equal(r.time, '09:30')
  assert.equal(r.duration, 15)
  r = parseQuickAdd('Lunch with Sam 12-1pm fri', { today })
  assert.equal(r.time, '12:00')
  assert.equal(r.duration, 60)
  assert.equal(r.date, '2026-11-06')
  r = parseQuickAdd('Read chapters 3-4 #book', { today })
  assert.equal(r.title, 'Read chapters 3-4 #book')
  assert.equal(r.time, null)
  r = parseQuickAdd('Dentist 12 nov at 4', { today })
  assert.equal(r.date, '2026-11-12')
  assert.equal(r.time, '16:00')
  r = parseQuickAdd('Call mom tomorrow', { today, ignore: ['tomorrow'] })
  assert.equal(r.title, 'Call mom tomorrow')
  assert.equal(parseQuickAdd('today', { today }).title, 'today')
})

test('durations and times', () => {
  assert.equal(parseDuration('1h30m'), 90)
  assert.equal(parseDuration('1.5h'), 90)
  assert.equal(parseDuration('45 min'), 45)
  assert.equal(parseDuration('soon'), null)
  assert.equal(formatDuration(90), '1h30m')
  assert.equal(formatDuration(120), '2h')
  assert.equal(formatTime('13:05', true), '1:05 PM')
  assert.equal(formatTime('00:00', true), '12 AM')
  assert.equal(isoWeek('2026-01-01'), 1)
  assert.equal(isoWeek('2026-12-31'), 53)
})

test('front matter', () => {
  const t = '---\nname: Work\nshare: [ana, sam]\ncustom: keep me\n---\nbody\n'
  assert.deepEqual(splitFrontMatter(t).meta, { name: 'Work', share: ['ana', 'sam'], custom: 'keep me' })
  const u = setFrontMatter(t, { name: 'Job: day', share: 'everyone', color: 'blue' })
  assert.equal(u, '---\nname: "Job: day"\nshare: everyone\ncustom: keep me\ncolor: blue\n---\nbody\n')
  assert.equal(setFrontMatter('body\n', { name: 'X' }), '---\nname: X\n---\nbody\n')
  assert.equal(withFrontMatter({ name: 'A', owner: 'me' }), '---\nname: A\nowner: me\n---\n')
  assert.deepEqual(splitFrontMatter('---\nshare:\n  - a\n  - b\n---\n').meta.share, ['a', 'b'])
})

test('calendar expansion and layout', () => {
  const p = parseItems('- Standup 📅 2026-11-02 ⏰ 09:30 ⏱ 15m 🔁 every weekday 🆔 s\n- Trip 📅 2026-11-05 🔚 2026-11-07 🆔 t\n', { events: true })
  const items = p.items.map((i) => ({ ...i, path: 'calendars/work.md' }))
  const occ = expand(items, '2026-11-02', '2026-11-08')
  assert.equal(occ.filter((o) => o.item.id === 's').length, 5)
  const trip = occ.find((o) => o.item.id === 't')
  assert.equal(trip.endDate, '2026-11-07')
  const laid = layoutDay([
    { time: '09:00', duration: 60, allDay: false },
    { time: '09:30', duration: 30, allDay: false },
    { time: '11:00', duration: 30, allDay: false },
  ])
  assert.deepEqual(laid.map((o) => [o.col, o.cols]), [[0, 2], [1, 2], [0, 1]])
  assert.deepEqual(freeGaps(laid, 480, 720), [{ from: 480, to: 540 }, { from: 600, to: 660 }, { from: 690, to: 720 }])
  const task = parseItems('- [ ] Bins 📅 2026-11-02 🔁 every week 🆔 b\n').items.map((i) => ({ ...i, path: 'lists/home.md' }))
  const ghosts = expand(task, '2026-11-01', '2026-11-30')
  assert.deepEqual(ghosts.map((o) => [o.date, o.ghost]), [['2026-11-02', false], ['2026-11-09', true], ['2026-11-16', true], ['2026-11-23', true], ['2026-11-30', true]])
})

test('ics round trip', () => {
  const items = parseItems('- 🧍 Standup 📅 2026-11-02 ⏰ 09:30 ⏱ 15m 🔁 every weekday 🚫 2026-11-04 📍 Room, 4 🆔 s\n- Trip 📅 2026-11-05 🔚 2026-11-07 🆔 t\n', { events: true }).items
  const ics = toIcs(items, { stamp: new Date('2026-10-31T00:00:00Z') })
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/)
  assert.match(ics, /LOCATION:Room\\, 4/)
  const back = fromIcs(ics).items
  assert.equal(back[0].title, '🧍 Standup')
  assert.equal(back[0].time, '09:30')
  assert.equal(back[0].duration, 15)
  assert.equal(back[0].recurrence, 'every weekday')
  assert.deepEqual(back[0].skip, ['2026-11-04'])
  assert.equal(back[0].location, 'Room, 4')
  assert.equal(back[1].endDate, '2026-11-07')
  assert.equal(back[1].time, undefined)
})

test('ics import: utc, count, unsupported rules, overrides', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:a',
    'DTSTART:20261102T090000Z',
    'DURATION:PT1H',
    'RRULE:FREQ=DAILY;COUNT=3',
    'SUMMARY:Daily',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:b',
    'DTSTART;VALUE=DATE:20261110',
    'RRULE:FREQ=MONTHLY;BYDAY=2TU',
    'SUMMARY:Second Tuesday',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const { items, warnings } = fromIcs(ics)
  assert.equal(items[0].duration, 60)
  assert.equal(items[0].recurrence, 'every day until 2026-11-04')
  assert.equal(warnings.length, 1)
  assert.equal(items[1].recurrence, undefined)
})

test('text rebase and blob sha', async () => {
  const r = rebaseText('one\ntwo\nthree\n', 'one\nTWO\nthree\n', 'one\ntwo\nthree\nfour\n')
  assert.deepEqual(r, { text: 'one\nTWO\nthree\nfour\n', clean: true })
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(await blobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a')
})
