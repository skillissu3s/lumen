// What the calendar draws: items from lists and calendars turned into
// occurrences on days, with repeating events expanded.

import { addDays, daysBetween, toMinutes } from './dates.js'
import { occurrencesBetween, parseRecurrence, nextOccurrence } from './recurrence.js'
import { isOpen } from './items.js'

/**
 * Occurrences of `items` between `from` and `to` (inclusive). Each:
 *   { key, item, source, date, endDate, time, duration, allDay, ghost }
 * `item.source` is { path, kind, color } and is copied over. A repeating task only
 * exists once (its next occurrence is written when it is done), so its later
 * occurrences come back as `ghost`s — shown faintly, not editable as such.
 */
export function expand(items, from, to, { defaultDuration = 30, showDone = true, ghosts = true } = {}) {
  const out = []
  for (const item of items) {
    const day = item.date || item.scheduled || item.start
    if (!day) continue
    if (!showDone && item.kind === 'task' && !isOpen(item.status)) continue
    const span = item.endDate && item.endDate > day ? daysBetween(day, item.endDate) : 0
    const base = {
      item,
      time: item.time || null,
      duration: item.time ? item.duration || defaultDuration : null,
      allDay: !item.time,
    }
    const rec = item.recurrence && parseRecurrence(item.recurrence)
    if (!rec || item.kind === 'task') {
      if (day <= to && addDays(day, span) >= from) out.push({ ...base, key: `${item.path}#${item.id}`, date: day, endDate: addDays(day, span), ghost: false })
      if (rec && ghosts && isOpen(item.status)) {
        let d = day
        for (let i = 0; i < 60; i++) {
          d = nextOccurrence(rec, d, day)
          if (d > to || (rec.until && d > rec.until)) break
          if (d >= from) out.push({ ...base, key: `${item.path}#${item.id}@${d}`, date: d, endDate: addDays(d, span), ghost: true })
        }
      }
      continue
    }
    // a repeating event: every occurrence that overlaps the range
    for (const d of occurrencesBetween(rec, day, addDays(from, -span), to, { skip: item.skip })) {
      out.push({ ...base, key: `${item.path}#${item.id}@${d}`, date: d, endDate: addDays(d, span), ghost: false, occurrence: d, series: true })
    }
  }
  return out
}

/** Occurrences on one day, all-day ones first, then by start time */
export function onDay(occs, day) {
  return occs
    .filter((o) => o.date <= day && o.endDate >= day)
    .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || (a.time || '').localeCompare(b.time || '') || (b.duration || 0) - (a.duration || 0))
}

/**
 * Side-by-side layout for timed occurrences of one day (like every calendar):
 * overlapping ones share the width. Returns each with { top, height } in minutes
 * and { col, cols }.
 */
export function layoutDay(occs, { minHeight = 15 } = {}) {
  const timed = occs
    .filter((o) => !o.allDay && o.time)
    .map((o) => {
      const top = toMinutes(o.time)
      return { ...o, top, height: Math.max(minHeight, o.duration || minHeight), end: top + Math.max(minHeight, o.duration || minHeight) }
    })
    .sort((a, b) => a.top - b.top || b.end - a.end)
  const out = []
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const colsEnd = []
    for (const o of cluster) {
      let col = colsEnd.findIndex((e) => e <= o.top)
      if (col < 0) col = colsEnd.push(0) - 1
      colsEnd[col] = o.end
      o.col = col
    }
    for (const o of cluster) o.cols = colsEnd.length
    out.push(...cluster)
    cluster = []
  }
  for (const o of timed) {
    if (cluster.length && o.top >= clusterEnd) flush()
    cluster.push(o)
    clusterEnd = Math.max(clusterEnd, o.end)
  }
  flush()
  return out
}

/** Free gaps between timed items in [dayStart, dayEnd] minutes (for the timeline view) */
export function freeGaps(laid, dayStart, dayEnd, minGap = 15) {
  const gaps = []
  let at = dayStart
  for (const o of [...laid].sort((a, b) => a.top - b.top)) {
    if (o.top - at >= minGap) gaps.push({ from: at, to: o.top })
    at = Math.max(at, o.end)
  }
  if (dayEnd - at >= minGap) gaps.push({ from: at, to: dayEnd })
  return gaps
}
