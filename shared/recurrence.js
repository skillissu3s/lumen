// Repeat rules, written the way people say them (and the way Obsidian Tasks
// reads them): "every day", "every 2 weeks", "every weekday", "every mon and fri",
// "every 2 weeks on tue, thu", "every month", "every year", "… when done".

import { addDays, addMonths, daysBetween, weekdayOf, weekStartOf } from './dates.js'

const DAY_WORDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_RE = '(?:sun|mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?'
const SHORT = { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year', annually: 'every year', weekdays: 'every weekday' }
const dayIndex = (w) => DAY_WORDS.indexOf(w.slice(0, 3))
const daysIn = (s) => [...new Set(s.match(new RegExp(DAY_RE, 'g')).map(dayIndex))].sort((a, b) => a - b)
const LIST = `${DAY_RE}(?:(?:\\s*,\\s*and\\s+|\\s*,\\s*|\\s+and\\s+|\\s+)${DAY_RE})*`

/**
 * Reads a rule. Returns { unit: 'day'|'week'|'month'|'year', n, weekdays?, whenDone }
 * or null if it isn't one we understand.
 */
export function parseRecurrence(rule) {
  let s = String(rule || '').toLowerCase().trim().replace(/\s+/g, ' ')
  let until = null
  const u = / until (\d{4}-\d{2}-\d{2})$/.exec(s)
  if (u) {
    until = u[1]
    s = s.slice(0, u.index)
  }
  const rec = parseRule(SHORT[s] || s)
  if (rec && until) rec.until = until
  return rec
}

function parseRule(s) {
  const whenDone = / when done$/.test(s)
  if (whenDone) s = s.slice(0, -' when done'.length).trim()
  let m = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(s)
  if (m) return { unit: m[2], n: Math.max(1, +(m[1] || 1)), whenDone }
  if (s === 'every weekday') return { unit: 'week', n: 1, weekdays: [1, 2, 3, 4, 5], whenDone }
  if (s === 'every weekend') return { unit: 'week', n: 1, weekdays: [0, 6], whenDone }
  m = new RegExp(`^every (?:(\\d+) )?weeks? on (${LIST})$`).exec(s)
  if (m) return { unit: 'week', n: Math.max(1, +(m[1] || 1)), weekdays: daysIn(m[2]), whenDone }
  m = new RegExp(`^every (${LIST})$`).exec(s)
  if (m) return { unit: 'week', n: 1, weekdays: daysIn(m[1]), whenDone }
  return null
}

const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** The canonical text of a rule object */
export function formatRecurrence(rec) {
  if (!rec) return ''
  let s
  const wd = rec.weekdays
  if (wd && rec.n === 1 && wd.join() === '1,2,3,4,5') s = 'every weekday'
  else if (wd && rec.n === 1 && wd.join() === '0,6') s = 'every weekend'
  else if (wd && rec.n === 1) s = `every ${wd.map((d) => NAMES[d]).join(', ')}`
  else if (wd) s = `every ${rec.n} weeks on ${wd.map((d) => NAMES[d]).join(', ')}`
  else s = rec.n === 1 ? `every ${rec.unit}` : `every ${rec.n} ${rec.unit}s`
  if (rec.whenDone) s += ' when done'
  return rec.until ? `${s} until ${rec.until}` : s
}

/** A short label for the UI: "Weekdays", "Every 2 weeks", "Mon, Fri" */
export function describeRecurrence(rule) {
  const rec = typeof rule === 'string' ? parseRecurrence(rule) : rule
  if (!rec) return rule ? String(rule) : ''
  const cap = (x) => x[0].toUpperCase() + x.slice(1)
  const t = formatRecurrence({ ...rec, until: null })
  const base = rec.weekdays && rec.n === 1 && rec.weekdays.join() === '1,2,3,4,5' ? 'Weekdays' + (rec.whenDone ? ' (when done)' : '') : cap(t)
  return rec.until ? `${base} until ${rec.until}` : base
}

/** The first date the rule gives strictly after `from` (anchored to `anchor`, the series start) */
export function nextOccurrence(rec, from, anchor = from) {
  if (rec.weekdays) {
    for (let i = 1; i <= 7 * rec.n + 7; i++) {
      const d = addDays(from, i)
      if (!rec.weekdays.includes(weekdayOf(d))) continue
      if (rec.n > 1) {
        const weeks = Math.floor(daysBetween(weekStartOf(anchor, 1), weekStartOf(d, 1)) / 7)
        if (weeks % rec.n !== 0) continue
      }
      return d
    }
    return addDays(from, 7)
  }
  switch (rec.unit) {
    case 'day':
      return addDays(from, rec.n)
    case 'week':
      return addDays(from, 7 * rec.n)
    case 'month':
      return addMonthsAnchored(anchor, from, rec.n)
    default:
      return addMonthsAnchored(anchor, from, 12 * rec.n)
  }
}

// months keep the anchor's day of month where they can (31st → 30th → 31st again)
function addMonthsAnchored(anchor, from, n) {
  const months = (+from.slice(0, 4) - +anchor.slice(0, 4)) * 12 + (+from.slice(5, 7) - +anchor.slice(5, 7))
  return addMonths(anchor, months + n)
}

/**
 * Every date the series starting on `start` lands on within [from, to] (inclusive),
 * minus `skip`. Bounded so a bad rule can't loop forever.
 */
export function occurrencesBetween(rule, start, from, to, { skip = [], max = 1000 } = {}) {
  const rec = typeof rule === 'string' ? parseRecurrence(rule) : rule
  if (!rec) return start >= from && start <= to ? [start] : []
  const until = rec.until || null
  const out = []
  const skipped = new Set(skip)
  let d = start
  // first occurrence: the start itself only counts if it matches a weekday rule
  if (rec.weekdays && !rec.weekdays.includes(weekdayOf(d))) d = nextOccurrence(rec, d, start)
  // jump close to `from` for day/week rules without walking every step
  if (!rec.weekdays && (rec.unit === 'day' || rec.unit === 'week') && d < from) {
    const step = rec.unit === 'day' ? rec.n : rec.n * 7
    const k = Math.floor(daysBetween(d, from) / step)
    if (k > 0) d = addDays(d, k * step)
  }
  for (let i = 0; i < 20000 && out.length < max; i++) {
    if (d > to || (until && d > until)) break
    if (d >= from && !skipped.has(d)) out.push(d)
    d = nextOccurrence(rec, d, start)
  }
  return out
}
