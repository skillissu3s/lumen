// Dates are ISO strings (yyyy-mm-dd) and times are "HH:MM", worked out in UTC so
// no time zone or daylight-saving change can shift a day. "Today" is the only
// thing read from the local clock.

const ISO = /^\d{4}-\d{2}-\d{2}$/
export const DAY_MS = 86400000
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10)
const pad = (n) => String(n).padStart(2, '0')

export const isIsoDate = (s) => typeof s === 'string' && ISO.test(s) && fromUtc(utc(s)) === s
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
export const addDays = (iso, n) => fromUtc(utc(iso) + n * DAY_MS)
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS)
/** 0 = Sunday */
export const weekdayOf = (iso) => new Date(utc(iso)).getUTCDay()

/** n months on, staying within the month (31 Jan + 1 month = 28/29 Feb) */
export function addMonths(iso, n) {
  const first = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return fromUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(+iso.slice(8, 10), last)))
}

/** The first day of the week `iso` is in (`startDay`: 0 Sunday, 1 Monday …) */
export const weekStartOf = (iso, startDay = 1) => addDays(iso, -((weekdayOf(iso) - startDay + 7) % 7))

/** The days of the whole weeks that make up the month `iso` is in */
export function monthGrid(iso, startDay = 1) {
  const first = `${iso.slice(0, 8)}01`
  const start = weekStartOf(first, startDay)
  const weeks = Math.ceil(daysBetween(start, addMonths(first, 1)) / 7)
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
}

/** ISO 8601 week number */
export function isoWeek(iso) {
  const d = new Date(utc(iso))
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

export const rangeDays = (from, count) => Array.from({ length: count }, (_, i) => addDays(from, i))

// ---------- times ----------

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/
export const isTime = (s) => typeof s === 'string' && HM.test(s)
export const normTime = (s) => {
  const m = HM.exec(String(s || ''))
  return m ? `${pad(+m[1])}:${m[2]}` : null
}
/** "09:30" → 570 */
export const toMinutes = (t) => {
  const m = HM.exec(t || '')
  return m ? +m[1] * 60 + +m[2] : null
}
/** 570 → "09:30" (wraps within the day) */
export const fromMinutes = (n) => {
  const v = ((Math.round(n) % 1440) + 1440) % 1440
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`
}
export const nowMinutes = (now = new Date()) => now.getHours() * 60 + now.getMinutes()

/** "09:30" → "9:30 AM" (12h) or "09:30" (24h) */
export function formatTime(t, h12 = false) {
  const m = toMinutes(t)
  if (m == null) return ''
  if (!h12) return t
  const h = Math.floor(m / 60)
  const mm = m % 60
  const hh = h % 12 || 12
  return `${hh}${mm ? `:${pad(mm)}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

// ---------- durations ----------

/** "1h30m", "90m", "1.5h", "45 min", "2 hours" → minutes, or null */
export function parseDuration(s) {
  const str = String(s || '').trim().toLowerCase()
  if (!str) return null
  if (/^\d+$/.test(str)) return +str
  let total = 0
  let any = false
  const re = /(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m)(?![a-z])/g
  let m
  let consumed = ''
  while ((m = re.exec(str))) {
    any = true
    consumed += m[0]
    total += m[2].startsWith('h') ? parseFloat(m[1]) * 60 : parseFloat(m[1])
  }
  if (!any || consumed.replace(/\s/g, '').length !== str.replace(/\s/g, '').length) return null
  return Math.max(1, Math.round(total))
}

/** 90 → "1h30m", 45 → "45m", 120 → "2h" */
export function formatDuration(min) {
  const n = Math.max(0, Math.round(min || 0))
  const h = Math.floor(n / 60)
  const m = n % 60
  return h ? `${h}h${m ? `${m}m` : ''}` : `${m}m`
}

/** Human form: "1 h 30 min" */
export function humanDuration(min) {
  const n = Math.max(0, Math.round(min || 0))
  const h = Math.floor(n / 60)
  const m = n % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

// ---------- labels ----------

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const dayName = (iso, short = false) => {
  const n = DAY_NAMES[weekdayOf(iso)]
  return short ? n.slice(0, 3) : n
}
export const monthName = (iso, short = false) => {
  const n = MONTH_NAMES[+iso.slice(5, 7) - 1]
  return short ? n.slice(0, 3) : n
}
export const dayOfMonth = (iso) => +iso.slice(8, 10)

/** "Today", "Tomorrow", "Yesterday", "Mon 3 Nov", or "Mon 3 Nov 2027" in another year */
export function relativeDay(iso, today = todayIso()) {
  if (!iso) return ''
  const d = daysBetween(today, iso)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d === -1) return 'Yesterday'
  const base = `${dayName(iso, true)} ${dayOfMonth(iso)} ${monthName(iso, true)}`
  return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${iso.slice(0, 4)}`
}

/** Local Date for a day + time */
export const toDate = (iso, time = '00:00') => {
  const m = toMinutes(time) || 0
  return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), Math.floor(m / 60), m % 60)
}
export const isoOf = (date) => todayIso(date)
export const timeOf = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`
