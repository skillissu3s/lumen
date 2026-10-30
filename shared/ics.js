// iCalendar (.ics) import and export, so a calendar can move in and out of Lumen.
// Export writes floating (local) times; import converts UTC and TZID times to
// this computer's time zone.

import { addDays, daysBetween, formatDuration, isoOf, timeOf, toDate, toMinutes, fromMinutes } from './dates.js'
import { parseRecurrence, formatRecurrence, occurrencesBetween } from './recurrence.js'
import { splitIcon } from './items.js'

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const unesc = (s) => String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
const ymd = (iso) => iso.replace(/-/g, '')
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// lines longer than 75 octets are folded (approximately: by characters)
function fold(line) {
  if (line.length <= 74) return line
  const parts = []
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73))
  return parts.join('\r\n')
}

function rrule(rec) {
  const parts = []
  if (rec.weekdays) parts.push('FREQ=WEEKLY', `BYDAY=${rec.weekdays.map((d) => DAYS[d]).join(',')}`)
  else parts.push(`FREQ=${{ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[rec.unit]}`)
  if (rec.n > 1) parts.push(`INTERVAL=${rec.n}`)
  if (rec.until) parts.push(`UNTIL=${ymd(rec.until)}`)
  return parts.join(';')
}

/** `items` (with `date`) → .ics text */
export function toIcs(items, { name = 'Lumen', stamp = new Date() } = {}) {
  const now = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lumen//Lumen Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`]
  for (const it of items) {
    const day = it.date || it.scheduled || it.start
    if (!day) continue
    out.push('BEGIN:VEVENT', `UID:${it.id}@lumen`, `DTSTAMP:${now}`, `SUMMARY:${esc(it.title)}`)
    if (it.time) {
      const start = toDate(day, it.time)
      const end = new Date(start.getTime() + (it.duration || 30) * 60000)
      const fmt = (d) => `${ymd(isoOf(d))}T${timeOf(d).replace(':', '')}00`
      out.push(`DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`)
    } else {
      out.push(`DTSTART;VALUE=DATE:${ymd(day)}`, `DTEND;VALUE=DATE:${ymd(addDays(it.endDate || day, 1))}`)
    }
    const rec = it.recurrence && parseRecurrence(it.recurrence)
    if (rec) out.push(`RRULE:${rrule(rec)}`)
    for (const s of it.skip || []) out.push(it.time ? `EXDATE:${ymd(s)}T${it.time.replace(':', '')}00` : `EXDATE;VALUE=DATE:${ymd(s)}`)
    if (it.location) out.push(`LOCATION:${esc(it.location)}`)
    if (it.notes) out.push(`DESCRIPTION:${esc(it.notes)}`)
    if (it.kind === 'task' && (it.status === 'x' || it.status === 'X')) out.push('STATUS:CONFIRMED', 'X-LUMEN-DONE:TRUE')
    out.push('END:VEVENT')
  }
  out.push('END:VCALENDAR')
  return out.map(fold).join('\r\n') + '\r\n'
}

// ---------- import ----------

function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function prop(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  if (colon < 0) return null
  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...params] = head.split(';')
  const p = {}
  for (const x of params) {
    const [k, v] = x.split('=')
    if (k) p[k.toUpperCase()] = (v || '').replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params: p, value }
}

// the offset (ms) of zone `tz` at instant `ms`
function tzOffset(ms, tz) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
    return asUtc - ms
  } catch {
    return null
  }
}

/** an ICS date value → { date, time|null } in local time */
function when(p) {
  const v = p.value.trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (!m[4] || p.params.VALUE === 'DATE') return { date, time: null }
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))
  let instant = null
  if (m[7]) instant = wall
  else if (p.params.TZID) {
    const off = tzOffset(wall, p.params.TZID)
    if (off != null) {
      instant = wall - off
      const off2 = tzOffset(instant, p.params.TZID)
      if (off2 != null && off2 !== off) instant = wall - off2
    }
  }
  if (instant == null) return { date, time: `${m[4]}:${m[5]}` } // floating
  const d = new Date(instant)
  return { date: isoOf(d), time: timeOf(d) }
}

function duration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  return (+(m[2] || 0) * 7 + +(m[3] || 0)) * 1440 + +(m[4] || 0) * 60 + +(m[5] || 0)
}

function fromRrule(value, start) {
  const r = Object.fromEntries(value.split(';').map((kv) => kv.split('=')))
  const n = Math.max(1, +(r.INTERVAL || 1))
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.FREQ]
  if (!unit) return null
  let rec = { unit, n }
  if (r.BYDAY && unit === 'week') {
    const days = r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0)
    if (days.length) rec.weekdays = [...new Set(days)].sort((a, b) => a - b)
  } else if (r.BYDAY && unit === 'day') {
    const days = r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0)
    if (days.length) rec = { unit: 'week', n: 1, weekdays: [...new Set(days)].sort((a, b) => a - b) }
  } else if (r.BYDAY || r.BYMONTHDAY || r.BYSETPOS) {
    // "the second Tuesday of every month" and the like: no text form for those yet
    return { unsupported: true, rec }
  }
  if (r.UNTIL) rec.until = `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}`
  else if (r.COUNT) {
    const all = occurrencesBetween(rec, start, start, addDays(start, 366 * 30), { max: +r.COUNT })
    if (all.length) rec.until = all[all.length - 1]
  }
  return { rec }
}

/**
 * .ics text → { items: [{ title, icon?, date, endDate?, time?, duration?, recurrence?,
 * skip?, location?, notes?, uid }], warnings: [] }
 */
export function fromIcs(text) {
  const items = []
  const warnings = []
  const overrides = []
  let cur = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = { props: [] }
      continue
    }
    if (line === 'END:VEVENT') {
      if (cur) {
        const ev = toItem(cur.props, warnings)
        if (ev) (ev.recurrenceId ? overrides : items).push(ev)
      }
      cur = null
      continue
    }
    if (!cur) continue
    const p = prop(line)
    if (p) cur.props.push(p)
  }
  // a changed single occurrence: its own item, and a gap in the series
  for (const o of overrides) {
    const master = items.find((i) => i.uid === o.uid)
    if (master) master.skip = [...new Set([...(master.skip || []), o.recurrenceId])].sort()
    delete o.recurrenceId
    delete o.recurrence
    items.push(o)
  }
  return { items, warnings }
}

function toItem(props, warnings) {
  const get = (n) => props.find((p) => p.name === n)
  const all = (n) => props.filter((p) => p.name === n)
  if (get('STATUS')?.value === 'CANCELLED') return null
  const s = get('DTSTART') && when(get('DTSTART'))
  if (!s) return null
  const summary = unesc(get('SUMMARY')?.value || 'Untitled')
  const { icon, label } = splitIcon(summary)
  const ev = { uid: get('UID')?.value || null, title: summary, icon, label, date: s.date }
  if (s.time) ev.time = s.time
  const e = get('DTEND') && when(get('DTEND'))
  const dur = get('DURATION') && duration(get('DURATION').value)
  if (s.time) {
    let mins = dur
    if (mins == null && e?.time) mins = daysBetween(s.date, e.date) * 1440 + toMinutes(e.time) - toMinutes(s.time)
    if (mins != null && mins > 0) {
      if (mins >= 1440) ev.endDate = addDays(s.date, Math.floor((toMinutes(s.time) + mins - 1) / 1440))
      ev.duration = mins >= 1440 ? Math.max(1, 1440 - toMinutes(s.time)) : mins
    }
  } else {
    const end = e ? addDays(e.date, -1) : dur ? addDays(s.date, Math.max(0, Math.round(dur / 1440) - 1)) : s.date
    if (end > s.date) ev.endDate = end
  }
  const rr = get('RRULE')
  if (rr) {
    const r = fromRrule(rr.value, s.date)
    if (r?.unsupported) warnings.push(`“${summary}” repeats in a way Lumen can't express yet (${rr.value}); imported as its first occurrence only.`)
    else if (r?.rec) ev.recurrence = formatRecurrence(r.rec)
  }
  const skip = all('EXDATE').flatMap((p) => p.value.split(',').map((v) => when({ ...p, value: v })?.date).filter(Boolean))
  if (skip.length) ev.skip = [...new Set(skip)].sort()
  const rid = get('RECURRENCE-ID')
  if (rid) ev.recurrenceId = when(rid)?.date
  if (get('LOCATION')?.value) ev.location = unesc(get('LOCATION').value).replace(/[🔁🛫⏳📅🔚⏰⏱📍🎨🚫➕✅❌🆔]/gu, '')
  if (get('DESCRIPTION')?.value) ev.notes = unesc(get('DESCRIPTION').value)
  return ev
}

export { formatDuration, fromMinutes }
