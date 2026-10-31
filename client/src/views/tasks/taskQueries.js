// Which tasks a page shows and in what groups. Pure functions over items from
// the workspace (each with `path` and `source`), so they're easy to test.
import { addDays, daysBetween, relativeDay } from '../../../../shared/dates.js'
import { compareItems, isOpen, itemDay, priorityRank } from '../../../../shared/items.js'

const isTask = (i) => i.kind === 'task'
const topLevel = (i) => !i.parent

/** Today: overdue, today (by time, then priority), and what was finished today */
export function todayGroups(items, today) {
  const tasks = items.filter((i) => isTask(i) && topLevel(i))
  const open = tasks.filter((i) => isOpen(i.status))
  const overdue = open.filter((i) => itemDay(i) && itemDay(i) < today).sort(compareItems)
  const due = open.filter((i) => itemDay(i) === today).sort(compareItems)
  const done = tasks.filter((i) => !isOpen(i.status) && (i.done === today || i.cancelled === today))
  return { overdue, today: due, done }
}

/** Upcoming: one group per day for `days` days from tomorrow, then later and undated */
export function upcomingGroups(items, today, days = 14) {
  const open = items.filter((i) => isTask(i) && topLevel(i) && isOpen(i.status))
  const groups = []
  for (let n = 1; n <= days; n++) {
    const day = addDays(today, n)
    groups.push({ id: day, date: day, label: relativeDay(day, today), items: open.filter((i) => itemDay(i) === day).sort(compareItems) })
  }
  const last = addDays(today, days)
  groups.push({ id: 'later', label: 'Later', items: open.filter((i) => itemDay(i) && itemDay(i) > last).sort(compareItems) })
  groups.push({ id: 'none', label: 'No date', items: open.filter((i) => !itemDay(i)), collapsed: true })
  return groups
}

const SORTS = {
  manual: () => 0,
  date: compareItems,
  priority: (a, b) => priorityRank(b.priority) - priorityRank(a.priority) || compareItems(a, b),
  title: (a, b) => (a.label || a.title).localeCompare(b.label || b.title),
}

/**
 * A list's groups: by its own `## sections` (in file order, tasks before the
 * first heading first), or by date / priority, or one group.
 */
export function listGroups(list, { groupBy = 'section', sort = 'manual', showCompleted = false, today, keep = new Set() } = {}) {
  const visible = list.items.filter((i) => isTask(i) && (showCompleted || isOpen(i.status) || keep.has(i.id)))
  const sorted = sort === 'manual' ? visible : [...visible].sort(SORTS[sort] || SORTS.manual)
  if (groupBy === 'section') {
    const groups = [{ id: '', label: null, section: null, items: sorted.filter((i) => !i.section) }]
    for (const s of list.sections) {
      if (groups.some((g) => g.section === s.name)) continue
      groups.push({ id: `s:${s.name}`, label: s.name, section: s.name, items: sorted.filter((i) => i.section === s.name) })
    }
    return groups
  }
  if (groupBy === 'priority') {
    const names = { highest: 'Highest', high: 'High', medium: 'Medium', none: 'No priority', low: 'Low', lowest: 'Lowest' }
    return ['highest', 'high', 'medium', 'none', 'low', 'lowest']
      .map((p) => ({ id: p, label: names[p], items: sorted.filter((i) => (i.priority || 'none') === p) }))
      .filter((g) => g.items.length)
  }
  if (groupBy === 'date') {
    const buckets = [
      { id: 'overdue', label: 'Overdue', test: (d) => d && d < today },
      { id: 'today', label: 'Today', test: (d) => d === today },
      { id: 'tomorrow', label: 'Tomorrow', test: (d) => d === addDays(today, 1) },
      { id: 'week', label: 'Next 7 days', test: (d) => d && daysBetween(today, d) > 1 && daysBetween(today, d) <= 7 },
      { id: 'later', label: 'Later', test: (d) => d && daysBetween(today, d) > 7 },
      { id: 'none', label: 'No date', test: (d) => !d },
    ]
    return buckets.map((b) => ({ id: b.id, label: b.label, items: sorted.filter((i) => b.test(itemDay(i))) })).filter((g) => g.items.length)
  }
  return [{ id: '', label: null, items: sorted }]
}

/** Board columns for a grouping and the patch that moving a card into one makes */
export const BOARD = {
  status: {
    columns: [
      { id: 'todo', label: 'To do' },
      { id: 'doing', label: 'In progress' },
      { id: 'done', label: 'Done' },
    ],
    of: (i) => (!isOpen(i.status) ? 'done' : i.status === '/' ? 'doing' : 'todo'),
    patch: (col) => ({ status: col === 'done' ? 'x' : col === 'doing' ? '/' : ' ' }),
  },
  priority: {
    columns: [
      { id: 'high', label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'none', label: 'No priority' },
      { id: 'low', label: 'Low' },
    ],
    of: (i) => (i.priority === 'highest' ? 'high' : i.priority === 'lowest' ? 'low' : i.priority || 'none'),
    patch: (col) => ({ priority: col === 'none' ? null : col }),
  },
  date: {
    columns: [
      { id: 'overdue', label: 'Overdue' },
      { id: 'today', label: 'Today' },
      { id: 'tomorrow', label: 'Tomorrow' },
      { id: 'later', label: 'Later' },
      { id: 'none', label: 'No date' },
    ],
    of: (i, today) => {
      const d = itemDay(i)
      if (!d) return 'none'
      if (d < today) return 'overdue'
      if (d === today) return 'today'
      if (d === addDays(today, 1)) return 'tomorrow'
      return 'later'
    },
    patch: (col, today) => {
      if (col === 'overdue') return null
      if (col === 'none') return { date: null, scheduled: null, start: null }
      return { date: col === 'today' ? today : col === 'tomorrow' ? addDays(today, 1) : addDays(today, 7) }
    },
  },
}

/** Subtask progress: { done, total } over every subtask below the item */
export function progressOf(item) {
  let done = 0
  let total = 0
  const walk = (list) => {
    for (const s of list) {
      total++
      if (!isOpen(s.status)) done++
      walk(s.subtasks || [])
    }
  }
  walk(item.subtasks || [])
  return { done, total }
}
