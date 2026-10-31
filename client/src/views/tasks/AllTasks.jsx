// Every card from every board on one board: grouped by status, due date,
// priority or board, with filters, and a schedule beside it to drop cards on
// a day.
import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, ListFilter, PanelRight, Plus, Search } from 'lucide-react'
import { IconButton, Menu, Segmented } from '../../components/ui/index.js'
import { useLists } from '../../store/hooks.js'
import { usePrefs } from '../../store/prefs.js'
import { useWorkspace } from '../../store/workspace.js'
import { navigate } from '../../lib/router.js'
import { updateItem } from '../../lib/actions.js'
import { addCard, moveCard } from '../../lib/boardActions.js'
import { addDays, addMonths, dayOfMonth, monthGrid, monthName, relativeDay, todayIso } from '../../../../shared/dates.js'
import { boardOf } from '../../../../shared/board.js'
import { compareItems, isOpen, itemDay, priorityRank } from '../../../../shared/items.js'
import { Card } from '../boards/Card.jsx'
import { Composer } from '../boards/Composer.jsx'
import { CardDialog } from '../boards/CardDialog.jsx'
import '../boards/boards.css'
import './alltasks.css'

const GROUPS = [
  { value: 'status', label: 'Status' },
  { value: 'date', label: 'Due' },
  { value: 'priority', label: 'Priority' },
  { value: 'board', label: 'Board' },
]

function columnsFor(group, today, lists) {
  switch (group) {
    case 'date':
      return [
        { id: 'late', label: 'Overdue', color: 'red', test: (i) => itemDay(i) && itemDay(i) < today, patch: null },
        { id: 'today', label: 'Today', color: 'amber', test: (i) => itemDay(i) === today, patch: { date: today } },
        { id: 'tomorrow', label: 'Tomorrow', color: 'blue', test: (i) => itemDay(i) === addDays(today, 1), patch: { date: addDays(today, 1) } },
        { id: 'week', label: 'This week', color: 'indigo', test: (i) => itemDay(i) > addDays(today, 1) && itemDay(i) <= addDays(today, 7), patch: { date: addDays(today, 3) } },
        { id: 'later', label: 'Later', color: 'violet', test: (i) => itemDay(i) > addDays(today, 7), patch: { date: addDays(today, 14) } },
        { id: 'none', label: 'No date', color: 'gray', test: (i) => !itemDay(i), patch: { date: null, scheduled: null, start: null } },
      ]
    case 'priority':
      return [
        { id: 'highest', label: 'Urgent', color: 'red', test: (i) => i.priority === 'highest', patch: { priority: 'highest' } },
        { id: 'high', label: 'High', color: 'orange', test: (i) => i.priority === 'high', patch: { priority: 'high' } },
        { id: 'medium', label: 'Medium', color: 'blue', test: (i) => i.priority === 'medium', patch: { priority: 'medium' } },
        { id: 'none', label: 'No priority', color: 'gray', test: (i) => !i.priority, patch: { priority: null } },
        { id: 'low', label: 'Low', color: 'teal', test: (i) => i.priority === 'low' || i.priority === 'lowest', patch: { priority: 'low' } },
      ]
    case 'board':
      return lists.map((l) => ({ id: l.path, label: l.name, color: l.color || 'gray', test: (i) => i.path === l.path, board: l.path }))
    default:
      return [
        { id: 'todo', label: 'To do', color: 'gray', test: (i) => i.status === ' ', patch: { status: ' ' } },
        { id: 'doing', label: 'Doing', color: 'blue', test: (i) => i.status === '/', patch: { status: '/' } },
        { id: 'done', label: 'Done', color: 'green', test: (i) => !isOpen(i.status), patch: { status: 'x' } },
      ]
  }
}

function Column({ col, cards, settingsOf, labels, onOpen, h12, defaultBoard }) {
  const [over, setOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const droppable = !!(col.patch || col.board)
  return (
    <section
      className={`pb-list${over ? ' over' : ''}`}
      style={{ '--lc': `var(--c-${col.color})` }}
      data-color={col.color}
      aria-label={`${col.label}, ${cards.length} cards`}
      onDragOver={(e) => {
        if (!droppable || !e.dataTransfer.types.includes('application/x-lumen-item')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const raw = e.dataTransfer.getData('application/x-lumen-item')
        if (!raw) return
        e.preventDefault()
        const { path, id } = JSON.parse(raw)
        if (col.board) {
          if (col.board !== path) moveCard(path, id, col.board, null)
          return
        }
        const patch = { ...col.patch }
        if (patch.status === undefined) patch.status = ' '
        updateItem(path, id, patch)
      }}
    >
      <header className="pb-list-head is-static">
        <i className="pb-list-dot" aria-hidden="true" />
        <h3>{col.label}</h3>
        <span className="pb-count">{cards.length}</span>
      </header>
      <div className="pb-cards">
        {cards.map((item) => (
          <Card key={`${item.path}#${item.id}`} item={item} labelColors={settingsOf(item.path).labels} labels={labels} cover={settingsOf(item.path).covers[item.id]} showBoard={!col.board} h12={h12} onOpen={onOpen} />
        ))}
        {!cards.length && <div className="pb-empty">{droppable ? 'Drop a card here' : 'Nothing here'}</div>}
      </div>
      {droppable &&
        col.id !== 'done' &&
        col.id !== 'late' &&
        (adding ? (
          <Composer onAdd={(t) => addCard(col.board || defaultBoard, null, t, col.patch || {})} onClose={() => setAdding(false)} />
        ) : (
          <button type="button" className="pb-add-card" onClick={() => setAdding(true)}>
            <Plus /> Add a card
          </button>
        ))}
    </section>
  )
}

function ScheduleRail({ cards, today, weekStart, onOpen, onHide }) {
  const [month, setMonth] = useState(today)
  const [selected, setSelected] = useState(today)
  const [over, setOver] = useState(null)
  const byDay = useMemo(() => {
    const m = new Map()
    for (const c of cards) if (isOpen(c.status) && itemDay(c)) (m.get(itemDay(c)) || m.set(itemDay(c), []).get(itemDay(c))).push(c)
    return m
  }, [cards])
  const days = monthGrid(month, weekStart)
  const here = byDay.get(selected) || []
  const names = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const dow = names.slice(weekStart).concat(names.slice(0, weekStart))
  return (
    <aside className="rail" aria-label="Schedule">
      <div className="rail-head">
        <button type="button" className="rail-title" onClick={() => navigate('/calendar')}>
          <CalendarDays size={15} /> Schedule
        </button>
        <IconButton icon={PanelRight} label="Hide the schedule" size="sm" onClick={onHide} />
      </div>
      <div className="rail-month">
        <span>
          {monthName(month)} {month.slice(0, 4)}
        </span>
        <IconButton icon={ChevronLeft} label="Previous month" size="sm" onClick={() => setMonth(addMonths(month, -1))} />
        <IconButton icon={ChevronRight} label="Next month" size="sm" onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div className="rail-grid">
        {dow.map((n, i) => (
          <span key={i} className="rail-dow">
            {n}
          </span>
        ))}
        {days.map((d) => {
          const n = byDay.get(d)?.length || 0
          return (
            <button
              key={d}
              type="button"
              className={`rail-day${d === today ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}${d.slice(0, 7) !== month.slice(0, 7) ? ' is-out' : ''}${over === d ? ' is-over' : ''}`}
              aria-label={`${relativeDay(d, today)}${n ? `, ${n} due` : ''}`}
              aria-pressed={d === selected}
              onClick={() => setSelected(d)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-lumen-item')) return
                e.preventDefault()
                setOver(d)
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null)
                const raw = e.dataTransfer.getData('application/x-lumen-item')
                if (!raw) return
                e.preventDefault()
                const { path, id } = JSON.parse(raw)
                updateItem(path, id, { date: d })
                setSelected(d)
              }}
            >
              {dayOfMonth(d)}
              {n > 0 && <i className={d < today ? 'is-late' : ''} />}
            </button>
          )
        })}
      </div>
      <div className="rail-day-title">
        {relativeDay(selected, today)}
        <span className="faint"> · {here.length ? `${here.length} due` : 'nothing due'}</span>
      </div>
      <div className="rail-list">
        {here.slice(0, 12).map((c) => (
          <button key={`${c.path}#${c.id}`} type="button" className="rail-chip" style={{ '--bc': `var(--c-${c.source?.color || 'gray'})` }} onClick={() => onOpen(c)}>
            <i />
            <span>{c.title.replace(/(^|\s)#\S+/g, '').trim()}</span>
          </button>
        ))}
        <p className="rail-hint">Drop a card on a day to give it that date.</p>
      </div>
    </aside>
  )
}

export default function AllTasks({ route }) {
  const lists = useLists()
  const files = useWorkspace((s) => s.files)
  const prefs = usePrefs()
  const today = todayIso()
  const group = GROUPS.some((g) => g.value === route.query.group) ? route.query.group : prefs.tasks.group || 'status'
  const [q, setQ] = useState('')
  const [board, setBoard] = useState('')
  const [label, setLabel] = useState('')
  const [showDone, setShowDone] = useState(group === 'status')
  const [rail, setRail] = useState(() => localStorage.getItem('lumen.tasks.rail') !== '0')
  const [open, setOpen] = useState(null)
  const h12 = prefs.timeFormat === '12h'

  const settingsOf = useMemo(() => {
    const cache = new Map()
    return (path) => {
      if (!cache.has(path)) cache.set(path, boardOf({ items: [], sections: [] }, files[path]?.text || '').settings)
      return cache.get(path)
    }
  }, [files])

  const all = useMemo(() => lists.flatMap((l) => l.items.filter((i) => i.kind === 'task').map((i) => ({ ...i, path: l.path, source: { name: l.name, color: l.color || 'gray', icon: l.icon } }))), [lists])
  const labels = useMemo(() => [...new Set(all.flatMap((i) => i.tags || []))].sort(), [all])
  const needle = q.trim().toLowerCase()
  const cards = all.filter((i) => (!board || i.path === board) && (!label || i.tags?.includes(label)) && (!needle || i.title.toLowerCase().includes(needle)))
  const columns = columnsFor(group, today, board ? lists.filter((l) => l.path === board) : lists)
  const defaultBoard = prefs.tasks.defaultList && lists.some((l) => l.path === prefs.tasks.defaultList) ? prefs.tasks.defaultList : lists[0]?.path

  const setGroup = (g) => navigate(`/tasks?group=${g}`, { replace: true })
  const toggleRail = () => {
    setRail(!rail)
    try {
      localStorage.setItem('lumen.tasks.rail', rail ? '0' : '1')
    } catch {
      /* fine */
    }
  }
  const filters = (board ? 1 : 0) + (label ? 1 : 0)

  return (
    <div className="view all-tasks">
      <header className="view-header">
        <h1 className="view-title">All tasks</h1>
        <span className="view-subtitle">{cards.filter((c) => isOpen(c.status)).length} open</span>
        <div className="view-actions">
          <label className="board-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
          </label>
          <Menu
            align="end"
            items={[
              { section: 'Board' },
              { label: 'Every board', checked: !board, onSelect: () => setBoard('') },
              ...lists.map((l) => ({ label: l.name, checked: board === l.path, onSelect: () => setBoard(l.path) })),
              ...(labels.length ? [{ section: 'Label' }, { label: 'Any label', checked: !label, onSelect: () => setLabel('') }, ...labels.map((t) => ({ label: t, checked: label === t, onSelect: () => setLabel(t) }))] : []),
              'separator',
              { label: 'Show finished', checked: showDone, onSelect: () => setShowDone(!showDone) },
            ]}
            trigger={
              <button type="button" className={`filter-button${filters ? ' is-active' : ''}`} aria-label="Filter">
                <ListFilter size={15} />
                Filter{filters ? ` · ${filters}` : ''}
              </button>
            }
          />
          <Segmented label="Group by" value={group} onChange={setGroup} options={GROUPS} />
          {!rail && <IconButton icon={CalendarDays} label="Show the schedule" onClick={toggleRail} />}
        </div>
      </header>
      <div className="all-tasks-body">
        <div className="pb-lanes">
          {columns
            .filter((c) => showDone || c.id !== 'done')
            .map((col) => {
              const list = cards.filter((i) => col.test(i) && (showDone || isOpen(i.status) || col.id === 'done'))
              const sorted = col.id === 'done' ? list.sort((a, b) => (b.done || '').localeCompare(a.done || '')).slice(0, 50) : list.sort((a, b) => compareItems(a, b) || priorityRank(b.priority) - priorityRank(a.priority))
              return <Column key={col.id} col={col} cards={sorted} settingsOf={settingsOf} labels={labels} onOpen={(i) => setOpen({ path: i.path, id: i.id })} h12={h12} defaultBoard={defaultBoard} />
            })}
        </div>
        {rail && <ScheduleRail cards={cards} today={today} weekStart={prefs.weekStart} onOpen={(i) => setOpen({ path: i.path, id: i.id })} onHide={toggleRail} />}
      </div>
      {open && <CardDialog path={open.path} id={open.id} onClose={() => setOpen(null)} />}
    </div>
  )
}
