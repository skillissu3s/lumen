// When each GitHub connection runs next (Repo Sync Protocol §11). Pure
// functions of the connection and the time, so the worker stays small and the
// rules can be tested without waiting for 03:00.
//
//   manual         only Sync now
//   after-changes  { quiet: minutes (10), max: minutes (60) }
//   interval       { every: hours (1–24) }
//   daily          { at: 'HH:MM', tz }
//   weekly         { at: 'HH:MM', tz, day: 0 (Sunday) – 6 }

const MIN = 60000
const HOUR = 60 * MIN
export const MODES = ['manual', 'after-changes', 'interval', 'daily', 'weekly']
export const FULL_EVERY = 7 * 24 * HOUR

const int = (v, d, lo, hi) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

const validZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** A schedule from a request, with defaults and limits; throws on a bad mode */
export function cleanSchedule(mode, s = {}) {
  if (!MODES.includes(mode)) throw Object.assign(new Error('Choose when to sync.'), { status: 400 })
  if (mode === 'manual') return null
  if (mode === 'after-changes') return { quiet: int(s.quiet, 10, 1, 240), max: int(s.max, 60, 5, 1440) }
  if (mode === 'interval') return { every: int(s.every, 6, 1, 24) }
  const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at) ? s.at : '03:00'
  const tz = s.tz && validZone(s.tz) ? s.tz : 'UTC'
  return mode === 'daily' ? { at, tz } : { at, tz, day: int(s.day, 0, 0, 6) }
}

// how far `tz` is ahead of UTC at instant `t`, in ms
function offset(t, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(t))
      .map((p) => [p.type, Number(p.value)]),
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(t / 1000) * 1000
}

/** The instant of wall-clock y-m-d hh:mm in `tz` */
function zoned(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m, d, hh, mm)
  const first = guess - offset(guess, tz)
  // across a DST change the offset at the answer can differ from the guess's
  return guess - offset(first, tz)
}

/** The next time after `now` that is `at` in `tz` (on weekday `day`, if given) */
export function nextAt(now, { at, tz, day }) {
  const [hh, mm] = at.split(':').map(Number)
  const local = new Date(now + offset(now, tz))
  for (let i = 0; i < 9; i++) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i))
    if (day != null && d.getUTCDay() !== day) continue
    const t = zoned(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm, tz)
    if (t > now) return t
  }
  return null
}

// up to 2 minutes, the same for a connection every time, so 03:00 isn't a stampede
const spread = (id) => {
  let h = 0
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % (2 * MIN)
}

/** After a run (or when the schedule changes): when the next timed run is */
export function nextRun(conn, now) {
  const s = conn.schedule || {}
  if (conn.mode === 'interval') return (conn.last_run_at ? Math.max(now, conn.last_run_at + s.every * HOUR) : now) + spread(conn.id)
  if (conn.mode === 'daily' || conn.mode === 'weekly') return nextAt(now, s) + spread(conn.id)
  // after-changes waits for a change; manual waits for the person
  return null
}

/** A change to what the connection mirrors: after-changes moves its next run */
export function afterChange(conn, now) {
  if (conn.mode !== 'after-changes') return null
  const first = conn.first_change_at || now
  return { first_change_at: first, next_run_at: Math.min(first + conn.schedule.max * MIN, now + conn.schedule.quiet * MIN) }
}

/** Retrying a failed run: 1, 2, 4 … minutes, at most 6 hours */
export const backoff = (failures) => Math.min(6 * HOUR, 2 ** Math.max(0, failures - 1) * MIN)
