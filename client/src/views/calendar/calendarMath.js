// The arithmetic behind the calendar views, kept pure so it can be tested.
import { addDays, addMonths, daysBetween, monthGrid, rangeDays, weekStartOf, dayName, dayOfMonth, monthName } from '../../../../shared/dates.js'

export const VIEWS = [
  { id: 'timeline', label: 'Timeline', key: '1' },
  { id: 'day', label: 'Day', key: '2' },
  { id: '3day', label: '3 days', key: '3' },
  { id: 'week', label: 'Week', key: '4' },
  { id: 'month', label: 'Month', key: '5' },
  { id: 'agenda', label: 'Agenda', key: '6' },
]

/** The days a view shows around `date` */
export function viewDays(view, date, { weekStart = 1, showWeekends = true } = {}) {
  switch (view) {
    case 'week': {
      const days = rangeDays(weekStartOf(date, weekStart), 7)
      return showWeekends ? days : days.filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))
    }
    case '3day':
      return rangeDays(date, 3)
    case 'month':
      return monthGrid(date, weekStart)
    case 'agenda':
      return rangeDays(date, 30)
    default:
      return [date]
  }
}

/** Where ‹ › go from `date` */
export function stepDate(view, date, dir) {
  switch (view) {
    case 'week':
      return addDays(date, 7 * dir)
    case '3day':
      return addDays(date, 3 * dir)
    case 'month':
      return addMonths(date, dir)
    case 'agenda':
      return addDays(date, 30 * dir)
    default:
      return addDays(date, dir)
  }
}

/** "November 2026", "2 – 8 Nov 2026", "Mon 2 Nov" */
export function periodTitle(view, days) {
  const first = days[0]
  const last = days[days.length - 1]
  const year = first.slice(0, 4)
  if (view === 'month') {
    const mid = days[Math.floor(days.length / 2)]
    return `${monthName(mid)} ${mid.slice(0, 4)}`
  }
  if (days.length === 1) return `${dayName(first)}, ${dayOfMonth(first)} ${monthName(first)}`
  const sameMonth = first.slice(0, 7) === last.slice(0, 7)
  return sameMonth
    ? `${dayOfMonth(first)} – ${dayOfMonth(last)} ${monthName(first, true)} ${year}`
    : `${dayOfMonth(first)} ${monthName(first, true)} – ${dayOfMonth(last)} ${monthName(last, true)} ${last.slice(0, 4)}`
}

export const snapTo = (min, step) => Math.round(min / step) * step

/** y (px from the top of the hours area) → minutes since midnight, snapped and clamped */
export function yToMinutes(y, { hourHeight, dayStart, snap = 15 }) {
  const m = dayStart * 60 + (y / hourHeight) * 60
  return Math.max(0, Math.min(24 * 60, snapTo(m, snap)))
}

export const minutesToY = (min, { hourHeight, dayStart }) => ((min - dayStart * 60) / 60) * hourHeight

/** x (px from the left of the day columns) → column index */
export const xToColumn = (x, width, count) => Math.max(0, Math.min(count - 1, Math.floor((x / width) * count)))

/** The fields a drag from `a` to `b` minutes on `day` creates (at least one snap long) */
export function dragRange(day, a, b, snap) {
  const start = Math.min(a, b)
  const end = Math.max(a, b, start + snap)
  return { date: day, startMin: start, duration: end - start }
}

/** The colour an occurrence is drawn in */
export function colorOf(item, colorBy) {
  if (colorBy === 'priority') return { highest: 'red', high: 'orange', medium: 'blue', low: 'gray', lowest: 'gray' }[item.priority] || 'gray'
  if (colorBy === 'item' && item.color) return item.color
  return item.color && colorBy !== 'calendar' ? item.color : item.source?.color || (item.kind === 'task' ? 'gray' : 'blue')
}

/** Which field holds the day a task sits on (moving it changes that one) */
export const dateKeyOf = (item) => (item.kind === 'event' ? 'date' : item.date ? 'date' : item.scheduled ? 'scheduled' : item.start ? 'start' : 'date')

/** The patch that moves an occurrence of `item` that was on `fromDay` to `toDay`/`time` */
export function movePatch(item, fromDay, toDay, time) {
  const key = dateKeyOf(item)
  const base = item[key] || fromDay
  const patch = { [key]: daysBetween(fromDay, toDay) ? addDays(base, daysBetween(fromDay, toDay)) : base }
  if (item.endDate) patch.endDate = addDays(item.endDate, daysBetween(fromDay, toDay))
  if (time !== undefined) patch.time = time
  return patch
}
