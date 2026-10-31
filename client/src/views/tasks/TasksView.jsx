// Today, Inbox, Upcoming and every list: grouped task rows, quick add, a board
// for lists, and the task panel on the right.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, ChevronRight, Columns3, List, MoreHorizontal, Plus, Sun } from 'lucide-react'
import { Button, ColorDot, EmptyState, Menu, Segmented } from '../../components/ui/index.js'
import { useAllItems, useCalendars, useConfig, useLists, inboxPath } from '../../store/hooks.js'
import { usePrefs, setPrefs } from '../../store/prefs.js'
import { useUI } from '../../store/ui.js'
import { navigate } from '../../lib/router.js'
import { addTask, deleteItem, moveItem, moveItemToFile, toggleTask, updateItem, updateListMeta } from '../../lib/actions.js'
import { addSection } from '../../../../shared/items.js'
import { useWorkspace } from '../../store/workspace.js'
import { addDays, dayName, dayOfMonth, formatTime, monthName, todayIso } from '../../../../shared/dates.js'
import { expand, onDay } from '../../../../shared/calendar.js'
import { useShortcut } from '../../shell/shortcuts.js'
import { ListEditor } from '../../shell/ListEditor.jsx'
import { QuickAdd } from './QuickAdd.jsx'
import { TaskRow } from './TaskRow.jsx'
import { CardDialog } from '../boards/CardDialog.jsx'
import { BoardView } from './BoardView.jsx'
import { listGroups, todayGroups, upcomingGroups } from './taskQueries.js'
import './tasks.css'

function InlineAdd({ onAdd, label = 'Add task' }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <button type="button" className="inline-add" onClick={() => setOpen(true)}>
        <Plus size={14} /> {label}
      </button>
    )
  return (
    <div className="inline-add-row">
      <QuickAdd
        onAdd={(f) => onAdd(f)}
        placeholder="Task name"
        ref={(r) => r?.focus()}
      />
      <button type="button" className="inline-add-done" onClick={() => setOpen(false)}>
        Done
      </button>
    </div>
  )
}

function Group({ group, children, actions, count }) {
  const [collapsed, setCollapsed] = useState(!!group.collapsed)
  if (!group.label) return <div className="tgroup">{children}</div>
  return (
    <section className="tgroup" aria-label={group.label}>
      <header className="tgroup-head">
        <button type="button" className={`tgroup-toggle${collapsed ? '' : ' is-open'}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <ChevronRight size={13} />
          <span className="tgroup-label">{group.label}</span>
          <span className="tgroup-count">{count ?? group.items.length}</span>
        </button>
        <div className="tgroup-actions">{actions}</div>
      </header>
      {!collapsed && children}
    </section>
  )
}

function TodaySchedule({ today }) {
  const calendars = useCalendars()
  const items = useAllItems()
  const prefs = usePrefs()
  const occ = useMemo(() => {
    const events = calendars.flatMap((c) => c.items.map((i) => ({ ...i, path: c.path, source: { color: c.color, name: c.name } })))
    const timedTasks = items.filter((i) => i.kind === 'task' && i.time)
    return onDay(expand([...events, ...timedTasks], today, today, { showDone: false }), today).slice(0, 8)
  }, [calendars, items, today])
  if (!occ.length) return null
  const h12 = prefs.timeFormat === '12h'
  return (
    <a className="schedule" href={`#/calendar?view=timeline&date=${today}`}>
      <span className="schedule-label">
        <CalendarDays size={13} /> Schedule
      </span>
      <span className="schedule-items">
        {occ.map((o) => (
          <span key={o.key} className="schedule-item" style={{ '--c': `var(--c-${o.item.color || o.item.source?.color || 'blue'})` }}>
            <span className="schedule-time tabular">{o.allDay ? 'All day' : formatTime(o.time, h12)}</span>
            {o.item.icon && <span>{o.item.icon}</span>}
            <span className="schedule-title">{o.item.label || o.item.title}</span>
          </span>
        ))}
      </span>
      <ArrowRight size={14} className="schedule-go" />
    </a>
  )
}

export default function TasksView({ route }) {
  const kind = route.parts[0] || 'today'
  const listId = kind === 'list' ? route.parts[1] : null
  const config = useConfig()
  const lists = useLists()
  const allItems = useAllItems()
  const prefs = usePrefs()
  const today = todayIso()
  const inbox = inboxPath(config)
  const quickRef = useRef(null)
  const [selected, setSelected] = useState(null) // "path#id"
  const [panel, setPanel] = useState(null) // { path, id }
  const [renaming, setRenaming] = useState(null)
  const [keep, setKeep] = useState(() => new Set())
  const [editList, setEditList] = useState(false)
  const titleRef = useRef(null)
  const h12 = prefs.timeFormat === '12h'

  const listPath = kind === 'inbox' ? inbox : listId ? `lists/${listId}.md` : null
  const list = lists.find((l) => l.path === listPath)
  const tasks = useMemo(() => allItems.filter((i) => i.kind === 'task' && i.path.startsWith('lists/')), [allItems])
  const defaultList = prefs.tasks.defaultList && lists.some((l) => l.path === prefs.tasks.defaultList) ? prefs.tasks.defaultList : inbox
  const listView = list ? (list.meta?.view || prefs.tasks.view) : 'list'
  const listPrefs = { groupBy: prefs.tasks.groupBy, sort: prefs.tasks.sort, showCompleted: prefs.tasks.showCompleted }

  // a task opened from elsewhere (palette, calendar): ?task=<id>
  useEffect(() => {
    if (route.query.task && listPath) setPanel({ path: listPath, id: route.query.task })
  }, [route.query.task, listPath])
  useEffect(() => {
    setSelected(null)
    setKeep(new Set())
  }, [route.path])

  const page = useMemo(() => {
    const withList = (arr) => arr.map((i) => ({ ...i }))
    if (kind === 'today' || route.path === '/') {
      const g = todayGroups(tasks, today)
      return {
        title: 'Today',
        icon: <Sun size={16} />,
        subtitle: `${dayName(today)}, ${dayOfMonth(today)} ${monthName(today)}`,
        showList: true,
        addTo: defaultList,
        addDefaults: { date: today },
        groups: [
          ...(g.overdue.length ? [{ id: 'overdue', label: 'Overdue', items: g.overdue, overdue: true }] : []),
          { id: 'today', label: g.overdue.length ? 'Today' : null, items: g.today, sameDay: true },
          ...(g.done.length ? [{ id: 'done', label: 'Done today', items: g.done, collapsed: true }] : []),
        ],
        empty: g.today.length + g.overdue.length === 0,
      }
    }
    if (kind === 'upcoming') {
      return {
        title: 'Upcoming',
        icon: <CalendarDays size={16} />,
        showList: true,
        addTo: defaultList,
        groups: upcomingGroups(tasks, today, 14).map((g) => ({ ...g, items: withList(g.items), addDate: g.date, sameDay: !!g.date })),
      }
    }
    if (!list) return null
    const groups = listGroups(list, { ...listPrefs, today, keep }).map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, path: list.path, source: { name: list.name, color: list.color, icon: list.icon } })) }))
    return {
      title: list.name,
      icon: list.icon ? <span className="view-title-emoji">{list.icon}</span> : list.path === inbox ? null : <ColorDot color={list.color || 'gray'} size={9} />,
      subtitle: null,
      showList: false,
      addTo: list.path,
      list,
      groups,
      empty: groups.every((g) => !g.items.length),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, route.path, tasks, list, today, keep, defaultList, prefs.tasks.groupBy, prefs.tasks.sort, prefs.tasks.showCompleted])

  // every visible row in order, for the keyboard
  const rows = useMemo(() => (page ? page.groups.flatMap((g) => g.items) : []), [page])
  const keyOf = (i) => `${i.path}#${i.id}`
  const current = rows.find((i) => keyOf(i) === selected)

  const add = useCallback(
    (fields, extra = {}) => {
      if (!page) return
      const f = { ...(page.addDefaults || {}), ...extra.defaults, ...fields }
      if (fields.date) f.date = fields.date
      addTask(page.addTo, f, extra.where || {})
    },
    [page],
  )

  useEffect(() => {
    const focus = () => quickRef.current?.focus()
    window.addEventListener('lumen:quick-add', focus)
    return () => window.removeEventListener('lumen:quick-add', focus)
  }, [])

  const move = (delta) => {
    if (!rows.length) return
    const at = rows.findIndex((i) => keyOf(i) === selected)
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + delta))]
    setSelected(keyOf(next))
  }
  const onCurrent = (fn) => () => current && fn(current)
  const when = () => !!current
  const G = 'Tasks'
  useShortcut('j', () => move(1), { description: 'Next task', group: G })
  useShortcut('k', () => move(-1), { description: 'Previous task', group: G })
  useShortcut('down', () => move(1), { group: G })
  useShortcut('up', () => move(-1), { group: G })
  useShortcut('enter', onCurrent((i) => setPanel({ path: i.path, id: i.id })), { description: 'Open task', group: G, when })
  useShortcut('x', onCurrent((i) => {
    setKeep((k) => new Set(k).add(i.id))
    toggleTask(i.path, i.id)
  }), { description: 'Complete task', group: G, when })
  useShortcut('space', onCurrent((i) => {
    setKeep((k) => new Set(k).add(i.id))
    toggleTask(i.path, i.id)
  }), { group: G, when })
  useShortcut('e', onCurrent((i) => setRenaming(keyOf(i))), { description: 'Rename task', group: G, when })
  useShortcut('f2', onCurrent((i) => setRenaming(keyOf(i))), { group: G, when })
  useShortcut('del', onCurrent((i) => {
    move(1)
    deleteItem(i.path, i.id)
  }), { description: 'Delete task', group: G, when })
  useShortcut('t', onCurrent((i) => updateItem(i.path, i.id, { date: today })), { description: 'Due today', group: G, when })
  useShortcut('m', onCurrent((i) => updateItem(i.path, i.id, { date: addDays(today, 1) })), { description: 'Due tomorrow', group: G, when })
  useShortcut('shift+d', onCurrent((i) => updateItem(i.path, i.id, { date: null, scheduled: null, start: null })), { description: 'Remove date', group: G, when })
  useShortcut('1', onCurrent((i) => updateItem(i.path, i.id, { priority: 'highest' })), { description: 'Priority: urgent', group: G, when })
  useShortcut('2', onCurrent((i) => updateItem(i.path, i.id, { priority: 'high' })), { description: 'Priority: high', group: G, when })
  useShortcut('3', onCurrent((i) => updateItem(i.path, i.id, { priority: 'medium' })), { description: 'Priority: medium', group: G, when })
  useShortcut('4', onCurrent((i) => updateItem(i.path, i.id, { priority: 'low' })), { description: 'Priority: low', group: G, when })
  useShortcut('0', onCurrent((i) => updateItem(i.path, i.id, { priority: null })), { description: 'No priority', group: G, when })
  useShortcut('alt+up', onCurrent((i) => {
    const sib = rows[rows.indexOf(i) - 1]
    if (sib && sib.path === i.path && !i.parent) moveItem(i.path, i.id, { before: sib.id })
  }), { description: 'Move up', group: G, when })
  useShortcut('alt+down', onCurrent((i) => {
    const sib = rows[rows.indexOf(i) + 1]
    if (sib && sib.path === i.path && !i.parent) moveItem(i.path, i.id, { after: sib.id })
  }), { description: 'Move down', group: G, when })
  useShortcut('n', () => quickRef.current?.focus(), { description: 'New task', group: G })
  useShortcut('esc', () => (panel ? setPanel(null) : setSelected(null)), { group: G })

  useEffect(() => {
    if (!page) return
    return useUI.getState().registerCommands('tasks', [
      { id: 'tasks.new', title: 'New task', section: 'Tasks', shortcut: 'q', run: () => quickRef.current?.focus() },
      ...(page.list
        ? [
            { id: 'tasks.board', title: listView === 'board' ? 'Show as list' : 'Show as board', section: 'Tasks', run: () => updateListMeta(page.list.path, { view: listView === 'board' ? 'list' : 'board' }) },
            { id: 'tasks.completed', title: prefs.tasks.showCompleted ? 'Hide completed tasks' : 'Show completed tasks', section: 'Tasks', run: () => setPrefs({ tasks: { showCompleted: !prefs.tasks.showCompleted } }) },
          ]
        : []),
    ])
  }, [page, listView, prefs.tasks.showCompleted])

  if (!page)
    return (
      <div className="view">
        <EmptyState title="This list doesn’t exist" action={<Button onClick={() => navigate('/inbox')}>Go to Inbox</Button>}>
          It may have been deleted or renamed.
        </EmptyState>
      </div>
    )

  const dropOn = (dragged, target, where) => {
    if (dragged.id === target.id) return
    if (dragged.path !== target.path) return moveItemToFile(dragged.path, dragged.id, target.path, { [where]: target.id })
    moveItem(target.path, dragged.id, { [where]: target.id })
  }

  const listMenu = page.list && [
    { label: 'Show completed', checked: prefs.tasks.showCompleted, onSelect: () => setPrefs({ tasks: { showCompleted: !prefs.tasks.showCompleted } }) },
    'separator',
    { section: 'Group by' },
    ...['section', 'date', 'priority', 'none'].map((g) => ({ label: { section: 'Sections', date: 'Date', priority: 'Priority', none: 'Nothing' }[g], checked: prefs.tasks.groupBy === g, onSelect: () => setPrefs({ tasks: { groupBy: g } }) })),
    { section: 'Sort' },
    ...['manual', 'date', 'priority', 'title'].map((s) => ({ label: { manual: 'As written', date: 'Date', priority: 'Priority', title: 'Title' }[s], checked: prefs.tasks.sort === s, onSelect: () => setPrefs({ tasks: { sort: s } }) })),
    'separator',
    {
      label: 'Add section',
      onSelect: () => {
        const name = `Section ${page.list.sections.length + 1}`
        useWorkspace.getState().edit(page.list.path, (t) => addSection(t, name))
        setPrefs({ tasks: { groupBy: 'section' } })
      },
    },
    { label: 'Edit list…', onSelect: () => setEditList(true) },
  ]

  return (
    <div className="view tasks-view">
      <div className="tasks-main">
        <header className="view-header">
          <h1 className="view-title" ref={titleRef}>
            {page.icon}
            <span>{page.title}</span>
            {page.subtitle && <span className="view-subtitle">{page.subtitle}</span>}
          </h1>
          <div className="view-actions">
            {page.list && (
              <Segmented
                label="Layout"
                value={listView}
                onChange={(v) => updateListMeta(page.list.path, { view: v })}
                options={[
                  { value: 'list', label: 'List', icon: List },
                  { value: 'board', label: 'Board', icon: Columns3 },
                ]}
              />
            )}
            {listMenu && (
              <Menu
                align="end"
                items={listMenu}
                trigger={
                  <button type="button" className="ui-icon-button" aria-label="List options">
                    <MoreHorizontal size={16} />
                  </button>
                }
              />
            )}
          </div>
        </header>

        {page.list && listView === 'board' ? (
          <div className="view-body">
            <BoardView list={page.list} group={page.list.meta?.board || 'status'} onOpen={(i) => setPanel({ path: i.path, id: i.id })} />
          </div>
        ) : (
          <div className="view-body">
            <div className="tasks-column">
              <QuickAdd ref={quickRef} onAdd={(f) => add(f)} placeholder={kind === 'today' ? 'Add a task for today' : 'Add a task'} />
              {kind === 'today' && <TodaySchedule today={today} />}
              {page.empty && (
                <div className="tasks-empty">
                  {kind === 'today' ? 'Nothing planned for today.' : page.list?.path === inbox ? 'Inbox zero.' : 'No tasks yet.'}
                  <span className="faint"> Try “Review notes tomorrow 9am for 30m”.</span>
                </div>
              )}
              <div role="list" aria-label={page.title}>
                {page.groups.map((g) => (
                  <Group
                    key={g.id}
                    group={g}
                    actions={
                      g.overdue ? (
                        <button type="button" className="tgroup-action" onClick={() => g.items.forEach((i) => updateItem(i.path, i.id, { date: today }))}>
                          Move all to today
                        </button>
                      ) : null
                    }
                  >
                    {g.items.map((item) => (
                      <TaskRow
                        key={keyOf(item)}
                        item={item}
                        lists={lists}
                        showList={page.showList}
                        hideDay={g.sameDay}
                        h12={h12}
                        selected={selected === keyOf(item)}
                        renaming={renaming === keyOf(item)}
                        onRenamed={() => setRenaming(null)}
                        onSelect={(i) => setSelected(keyOf(i))}
                        onOpen={(i) => setPanel({ path: i.path, id: i.id })}
                        onDropOn={dropOn}
                      />
                    ))}
                    {g.section !== undefined && g.label && <InlineAdd onAdd={(f) => add(f, { where: { section: g.section } })} />}
                    {g.addDate && <InlineAdd onAdd={(f) => add(f, { defaults: { date: g.addDate } })} />}
                  </Group>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {panel && <CardDialog path={panel.path} id={panel.id} onClose={() => setPanel(null)} />}
      {page.list && (
        <ListEditor open={editList} onOpenChange={setEditList} anchor={titleRef} initial={page.list} onSave={(v) => updateListMeta(page.list.path, v)} />
      )}
    </div>
  )
}
