// Typing an item in plain words: "Gym tomorrow 7am for 1h every mon !high".
// Each understood phrase is taken out of the title and shown as a chip; its ×
// puts the words back (they go in `ignore`). Adapted from obi's quick add, with
// times, time ranges and durations added for time-blocking.

import { addDays, addMonths, isIsoDate, todayIso, weekdayOf, weekStartOf, fromMinutes } from './dates.js'
import { parseRecurrence } from './recurrence.js'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
// "sat", "sun" and "wed" are words of their own, so they only count in full or after on/next/this
const WEEKDAY_ANY = '(monday|mon|tuesday|tues|tue|wednesday|thursday|thurs|thur|thu|friday|fri|saturday|sunday)'
const WEEKDAY_SHORT_AFTER = '(sat|sun|wed)'
const DAY_RE = '(?:sun|mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur)(?:day)?'
const DAY_LIST = `${DAY_RE}(?:(?:, and |, | and )${DAY_RE})*`
const weekdayIndex = (w) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(w.slice(0, 3))
const PRIORITY_WORDS = { 1: 'highest', '!!!': 'highest', highest: 'highest', urgent: 'highest', 2: 'high', '!!': 'high', high: 'high', 3: 'medium', medium: 'medium', med: 'medium', 4: 'low', low: 'low', lowest: 'lowest' }

const comingWeekday = (today, wd) => addDays(today, (wd - weekdayOf(today) + 7) % 7 || 7)

function comingDate(today, month, day) {
  let year = +today.slice(0, 4)
  const make = (y) => `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isIsoDate(make(year))) return null
  if (make(year) < today) year++
  return isIsoDate(make(year)) ? make(year) : null
}

// 7, 30, 'pm' → minutes since midnight
function clock(h, m, ap) {
  let hh = +h
  const mm = +(m || 0)
  if (hh > 23 || mm > 59) return null
  if (ap) {
    if (hh < 1 || hh > 12) return null
    if (ap.toLowerCase() === 'pm' && hh !== 12) hh += 12
    if (ap.toLowerCase() === 'am' && hh === 12) hh = 0
  }
  return hh * 60 + mm
}

const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`

// Each kind of phrase, in the order they're looked for. The first match of a kind wins.
const PHRASES = [
  {
    kind: 'recurrence',
    re: new RegExp(String.raw`\bevery (?:(?:\d+ )?(?:day|week|month|year)s?(?: on ${DAY_LIST})?|weekday|weekend|${DAY_LIST})(?: when done)?\b`, 'gi'),
    value: (m) => (parseRecurrence(m[0]) ? m[0].toLowerCase().replace(/\s+/g, ' ') : null),
  },
  // 9-10am, 9:30–11, from 2pm to 3:30pm
  {
    kind: 'timeRange',
    re: new RegExp(String.raw`\b(?:from )?${T}\s*(?:-|–|to|until)\s*${T}\b`, 'gi'),
    value: (m) => {
      if (!m[3] && !m[6] && !m[2] && !m[5]) return null // "3-4" alone is not a time
      const endAp = m[6]
      const flip = (ap) => (ap.toLowerCase() === 'pm' ? 'am' : 'pm')
      const b = clock(m[4], m[5], endAp)
      let a = clock(m[1], m[2], m[3] || endAp)
      // "12-1pm" is noon to one, "11-1pm" eleven in the morning to one
      if (!m[3] && endAp && a != null && b != null && a >= b) a = clock(m[1], m[2], flip(endAp))
      if (a == null || b == null || b <= a) return null
      return { time: fromMinutes(a), duration: b - a }
    },
  },
  {
    kind: 'time',
    re: /\b(?:at |@ ?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat (\d{1,2})(?::(\d{2}))?\b|\b(\d{1,2}):(\d{2})\b|\b(?:at )?(noon|midnight)\b/gi,
    value: (m) => {
      if (m[8]) return fromMinutes(m[8].toLowerCase() === 'noon' ? 720 : 0)
      const v = m[1] ? clock(m[1], m[2], m[3]) : m[4] ? clock(m[4], m[5], +m[4] < 7 ? 'pm' : null) : clock(m[6], m[7])
      return v == null ? null : fromMinutes(v)
    },
  },
  {
    kind: 'duration',
    re: /\bfor (?:(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:in(?:ute)?s?)?|(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?))\b|\bfor (an hour|half an hour)\b/gi,
    value: (m) => {
      if (m[5]) return m[5].toLowerCase() === 'an hour' ? 60 : 30
      if (m[1]) return +m[1] * 60 + +m[2]
      const n = parseFloat(m[3])
      const v = m[4].toLowerCase().startsWith('h') ? Math.round(n * 60) : Math.round(n)
      return v > 0 && v <= 24 * 60 ? v : null
    },
  },
  { kind: 'date', re: /\b(?:(?:on|by|due) )?(\d{4}-\d{2}-\d{2})\b/gi, date: (m) => (isIsoDate(m[1]) ? m[1] : null) },
  { kind: 'date', re: /\b(?:(?:on|by|due) )?today\b|\btonight\b/gi, date: (m, t) => t },
  { kind: 'date', re: /\b(?:(?:by|due) )?(?:tomorrow|tmrw)\b/gi, date: (m, t) => addDays(t, 1) },
  { kind: 'date', re: /\bnext week\b/gi, date: (m, t) => weekStartOf(addDays(t, 7), 1) },
  { kind: 'date', re: /\bnext month\b/gi, date: (m, t) => addMonths(t, 1) },
  { kind: 'date', re: /\bin (\d{1,3}) (day|week|month)s?\b/gi, date: (m, t) => (m[2].toLowerCase() === 'month' ? addMonths(t, +m[1]) : addDays(t, +m[1] * (m[2].toLowerCase() === 'week' ? 7 : 1))) },
  { kind: 'date', re: new RegExp(String.raw`\b(?:(?:on|by|due) )?(\d{1,2})(?:st|nd|rd|th)? ${MONTH}\b`, 'gi'), date: (m, t) => comingDate(t, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1]) },
  { kind: 'date', re: new RegExp(String.raw`\b(?:(?:on|by|due) )?${MONTH} (\d{1,2})(?:st|nd|rd|th)?\b`, 'gi'), date: (m, t) => comingDate(t, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]) },
  { kind: 'date', re: new RegExp(String.raw`\b(?:(next|this|on|by|due) )?${WEEKDAY_ANY}\b`, 'gi'), date: (m, t) => addDays(comingWeekday(t, weekdayIndex(m[2].toLowerCase())), m[1]?.toLowerCase() === 'next' ? 7 : 0) },
  { kind: 'date', re: new RegExp(String.raw`\b(next|this|on|by|due) ${WEEKDAY_SHORT_AFTER}\b`, 'gi'), date: (m, t) => addDays(comingWeekday(t, weekdayIndex(m[2].toLowerCase())), m[1].toLowerCase() === 'next' ? 7 : 0) },
  { kind: 'priority', re: /(?<=^|\s)!(highest|urgent|high|medium|med|lowest|low|[1-4]|!!|!)(?=\s|$)/gi, value: (m) => PRIORITY_WORDS[m[1].toLowerCase() === '!' ? '!!' : m[1].toLowerCase() === '!!' ? '!!!' : m[1].toLowerCase()] },
]

const EMPTY = () => ({ date: null, time: null, duration: null, priority: null, recurrence: null })

/**
 * Reads what was typed. Returns { title, date, time, duration, priority,
 * recurrence, found: [{ kind, text, value }] }. Links, code and the phrases in
 * `ignore` are left as words.
 */
export function parseQuickAdd(text, { today = todayIso(), ignore = [] } = {}) {
  const source = String(text || '')
  const masked = source.replace(/\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|`[^`]*`|https?:\/\/\S+/g, (m) => '\u0001'.repeat(m.length))
  const skip = new Set(ignore.map((s) => s.toLowerCase()))
  const out = { title: source.trim(), ...EMPTY(), found: [] }
  const taken = []
  const free = (a, b) => taken.every(([x, y]) => b <= x || a >= y)
  const done = new Set()
  for (const p of PHRASES) {
    const slot = p.kind === 'timeRange' ? 'time' : p.kind
    if (done.has(slot)) continue
    for (const m of masked.matchAll(p.re)) {
      const at = m.index
      const end = at + m[0].length
      if (skip.has(m[0].toLowerCase().trim()) || !free(at, end)) continue
      const value = p.date ? p.date(m, today) : p.value(m)
      if (value == null) continue
      if (p.kind === 'timeRange') {
        out.time = value.time
        out.duration = value.duration
        done.add('duration')
      } else out[p.kind] = value
      done.add(slot)
      taken.push([at, end])
      out.found.push({ kind: p.kind, text: source.slice(at, end), value })
      break
    }
  }
  if (!taken.length) return out
  let title = source
  for (const [a, b] of [...taken].sort((x, y) => y[0] - x[0])) title = title.slice(0, a) + title.slice(b)
  title = title.replace(/\s+/g, ' ').trim()
  if (!title) return { title: source.trim(), ...EMPTY(), found: [] }
  out.title = title
  return out
}
