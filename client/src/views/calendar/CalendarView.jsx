// The calendar: events and dated tasks together, in six views, every option
// adjustable, every action available from the keyboard.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, MoreHorizontal, PanelLeft, Plus, Search, SlidersHorizontal, Upload } from 'lucide-react'
import { Button, Checkbox, ColorDot, Dialog, IconButton, Menu, MiniMonth, Popover, Segmented, Select, Switch, Tooltip } from '../../components/ui/index.js'
import { useCalendars, useLists } from '../../store/hooks.js'
import { usePrefs, setPrefs } from '../../store/prefs.js'
import { useUI } from '../../store/ui.js'
import { navigate } from '../../lib/router.js'
import { addEvent, addTask, createCalendar, deleteCalendar, deleteItem, detachOccurrence, endSeriesBefore, exportIcs, importIcs, moveItemToFile, skipOccurrence, toggleTask, updateCalendarMeta, updateItem } from '../../lib/actions.js'
import { addDays, daysBetween, formatTime, relativeDay, todayIso } from '../../../../shared/dates.js'
import { expand } from '../../../../shared/calendar.js'
import { isOpen, itemDay, undoPatch } from '../../../../shared/items.js'
import { useShortcut } from '../../shell/shortcuts.js'
import { ListEditor } from '../../shell/ListEditor.jsx'
import { VIEWS, dateKeyOf, movePatch, periodTitle, stepDate, titleOf, viewDays } from './calendarMath.js'
import { TimeGrid } from './TimeGrid.jsx'
import { TimelineView } from './TimelineView.jsx'
import { AgendaView, MonthView } from './MonthView.jsx'
import { EventEditor } from './EventEditor.jsx'
import './calendar.css'

function download(name, text, type = 'text/calendar') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function Customize({ c, prefs, calendars, title = true }) {
  const set = (patch) => setPrefs({ calendar: patch })
  const hours = Array.from({ length: 25 }, (_, h) => ({ value: String(h), label: formatTime(`${String(h % 24).padStart(2, '0')}:00`, prefs.timeFormat === '12h').replace(/^12 AM$/, h === 24 ? 'Midnight' : '12 AM') }))
  return (
    <div className="customize">
      {title && <h3>Customize</h3>}
      <div className="cz-grid">
        <span>Default view</span>
        <Select value={c.view} onChange={(e) => set({ view: e.target.value })} options={VIEWS.map((v) => ({ value: v.id, label: v.label }))} />
        <span>Week starts on</span>
        <Select value={String(prefs.weekStart)} onChange={(e) => setPrefs({ weekStart: +e.target.value })} options={[{ value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' }, { value: '6', label: 'Saturday' }]} />
        <span>Time format</span>
        <Segmented label="Time format" value={prefs.timeFormat} onChange={(v) => setPrefs({ timeFormat: v })} options={[{ value: '24h', label: '24 h' }, { value: '12h', label: '12 h' }]} />
        <span>Day runs</span>
        <div className="cz-inline">
          <Select value={String(c.dayStart)} onChange={(e) => set({ dayStart: Math.min(+e.target.value, c.dayEnd - 1) })} options={hours.slice(0, 24)} aria-label="Day starts" />
          <span className="faint">to</span>
          <Select value={String(c.dayEnd)} onChange={(e) => set({ dayEnd: Math.max(+e.target.value, c.dayStart + 1) })} options={hours.slice(1)} aria-label="Day ends" />
        </div>
        <span>Working hours</span>
        <div className="cz-inline">
          <Select value={String(c.workStart)} onChange={(e) => set({ workStart: +e.target.value })} options={hours.slice(0, 24)} aria-label="Work starts" />
          <span className="faint">to</span>
          <Select value={String(c.workEnd)} onChange={(e) => set({ workEnd: +e.target.value })} options={hours.slice(1)} aria-label="Work ends" />
        </div>
        <span>Hour height</span>
        <input type="range" min="32" max="120" step="4" value={c.hourHeight} onChange={(e) => set({ hourHeight: +e.target.value })} aria-label="Hour height" />
        <span>Snap to</span>
        <Segmented label="Snap" value={String(c.snap)} onChange={(v) => set({ snap: +v })} options={['5', '10', '15', '30'].map((v) => ({ value: v, label: `${v}m` }))} />
        <span>New items last</span>
        <Select value={String(c.defaultDuration)} onChange={(e) => set({ defaultDuration: +e.target.value })} options={[15, 30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: m < 60 ? `${m} min` : `${m / 60} h` }))} />
        <span>Colour by</span>
        <Select value={c.colorBy} onChange={(e) => set({ colorBy: e.target.value })} options={[{ value: 'calendar', label: 'Calendar or board' }, { value: 'item', label: 'Item colour first' }, { value: 'priority', label: 'Priority' }]} />
        <span>New events go to</span>
        <Select value={c.defaultCalendar || ''} onChange={(e) => set({ defaultCalendar: e.target.value || null })} options={[{ value: '', label: 'Default calendar' }, ...calendars.map((x) => ({ value: x.path, label: x.name }))]} />
      </div>
      <div className="cz-switches">
        <Switch checked={c.showWeekends} onChange={(v) => set({ showWeekends: v })} label="Show weekends" />
        <Switch checked={c.showTasks} onChange={(v) => set({ showTasks: v })} label="Show tasks" />
        <Switch checked={c.showCompleted} onChange={(v) => set({ showCompleted: v })} label="Show completed" />
        <Switch checked={c.highlightWork} onChange={(v) => set({ highlightWork: v })} label="Highlight working hours" />
        <Switch checked={c.showWeekNumbers} onChange={(v) => set({ showWeekNumbers: v })} label="Week numbers" />
        <Switch checked={c.timeline?.showGaps !== false} onChange={(v) => set({ timeline: { showGaps: v } })} label="Free time in timeline" />
      </div>
    </div>
  )
}

export default function CalendarView({ route }) {
  const prefs = usePrefs()
  const c = prefs.calendar
  const h12 = prefs.timeFormat === '12h'
  const calendars = useCalendars()
  const lists = useLists()
  const today = todayIso()
  const view = VIEWS.some((v) => v.id === route.query.view) ? route.query.view : c.view
  const date = /^\d{4}-\d{2}-\d{2}$/.test(route.query.date || '') ? route.query.date : today
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  // the side panel starts closed on narrow screens unless it was opened before
  const [side, setSide] = useState(() => {
    try {
      const saved = localStorage.getItem('lumen.cal.side')
      return saved ? saved === '1' : window.innerWidth >= 1200
    } catch {
      return window.innerWidth >= 1200
    }
  })
  const [editor, setEditor] = useState(null) // { anchor, value, isNew, occ }
  const [scope, setScope] = useState(null) // { title, actions: { this, following, all } }
  const [calEdit, setCalEdit] = useState(null) // { anchor, cal? }
  const [customize, setCustomize] = useState(false)
  const [live, setLive] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const czRef = useRef(null)
  const newCalRef = useRef(null)
  const importRef = useRef(null)
  const importTarget = useRef(null)
  const toast = useUI((s) => s.toast)

  const go = useCallback((patch) => navigate(`/calendar?view=${patch.view || view}&date=${patch.date || date}`, { replace: true }), [view, date])
  const toggleSide = () => {
    setSide(!side)
    try {
      localStorage.setItem('lumen.cal.side', side ? '0' : '1')
    } catch {
      /* fine */
    }
  }

  const days = useMemo(() => viewDays(view, date, { weekStart: prefs.weekStart, showWeekends: c.showWeekends }), [view, date, prefs.weekStart, c.showWeekends])
  const hidden = useMemo(() => new Set(c.hidden || []), [c.hidden])
  const defaultCal = calendars.find((x) => x.path === c.defaultCalendar) || calendars.find((x) => x.default) || calendars[0]

  const items = useMemo(() => {
    const out = []
    for (const cal of calendars) {
      if (hidden.has(cal.path)) continue
      const source = { kind: 'calendar', name: cal.name, color: cal.color || 'blue', icon: cal.icon }
      for (const i of cal.items) out.push({ ...i, path: cal.path, source })
    }
    if (c.showTasks)
      for (const l of lists) {
        if (hidden.has(l.path)) continue
        const source = { kind: 'list', name: l.name, color: l.color || 'gray', icon: l.icon }
        for (const i of l.items) if (i.kind === 'task' && itemDay(i)) out.push({ ...i, path: l.path, source })
      }
    return out
  }, [calendars, lists, hidden, c.showTasks])

  const occs = useMemo(() => {
    const all = expand(items, days[0], days[days.length - 1], { defaultDuration: c.defaultDuration, showDone: c.showCompleted })
    const needle = q.trim().toLowerCase()
    return needle ? all.filter((o) => `${o.item.title} ${o.item.location || ''} ${o.item.notes || ''}`.toLowerCase().includes(needle)) : all
  }, [items, days, c.defaultDuration, c.showCompleted, q])

  const marks = useMemo(() => {
    const from = addDays(date, -45)
    return new Set(expand(items, from, addDays(date, 45), { showDone: false, ghosts: false }).map((o) => o.date))
  }, [items, date])

  const inbox = useMemo(
    () =>
      lists.flatMap((l) =>
        l.items.filter((i) => i.kind === 'task' && isOpen(i.status) && (!itemDay(i) || itemDay(i) < today)).map((i) => ({ ...i, path: l.path, source: { name: l.name, color: l.color } })),
      ),
    [lists, today],
  )

  const announce = (msg) => {
    setLive('')
    setTimeout(() => setLive(msg), 30)
  }

  // ---- editing ----
  const openNew = (draft, anchor) => {
    if (!defaultCal && !lists.length) return
    const kind = defaultCal ? 'event' : 'task'
    setEditor({
      anchor,
      isNew: true,
      value: { key: `new-${Date.now()}`, kind, path: kind === 'event' ? defaultCal.path : lists[0].path, title: '', date: draft.date, time: draft.allDay ? null : draft.time, duration: draft.duration || c.defaultDuration, recurrence: null, notes: '' },
    })
  }
  const openOcc = (o, anchor) => {
    const i = o.item
    setEditor({
      anchor,
      isNew: false,
      occ: o,
      value: { key: o.key, kind: i.kind, path: i.path, title: i.title, icon: i.icon, date: o.series ? o.date : itemDay(i), endDate: i.endDate, time: i.time, duration: i.duration || c.defaultDuration, recurrence: i.recurrence, color: i.color, location: i.location, notes: i.notes, priority: i.priority, series: o.series },
    })
  }

  const askScope = (title, actions) => setScope({ title, actions })

  const saveEditor = (fields, { kind, path }) => {
    const e = editor
    setEditor(null)
    if (e.isNew) {
      if (kind === 'event') addEvent(path, fields)
      else addTask(path, fields)
      announce(`Added ${fields.title}`)
      return
    }
    const o = e.occ
    const item = o.item
    const patch = { ...fields }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k]
    const dateKey = dateKeyOf(item)
    if (dateKey !== 'date') {
      patch[dateKey] = patch.date
      delete patch.date
    }
    const finish = () => {
      if (path !== item.path) moveItemToFile(item.path, item.id, path, {})
    }
    if (o.series) {
      const shift = daysBetween(o.date, fields.date || o.date)
      askScope('Change a repeating event', {
        this: () => detachOccurrence(item.path, item.id, o.date, { ...patch, recurrence: null }),
        following: () => {
          endSeriesBefore(item.path, item.id, o.date)
          addEvent(item.path, { ...patch, date: fields.date })
        },
        all: () => updateItem(item.path, item.id, { ...patch, date: addDays(item.date, shift) }),
      })
      return
    }
    updateItem(item.path, item.id, patch)
    finish()
  }

  const deleteOcc = (o) => {
    setEditor(null)
    const item = o.item
    if (o.series)
      return askScope('Delete a repeating event', {
        this: () => skipOccurrence(item.path, item.id, o.date),
        following: () => endSeriesBefore(item.path, item.id, o.date),
        all: () => deleteItem(item.path, item.id),
      })
    deleteItem(item.path, item.id)
  }

  const moveOcc = (o, to) => {
    const item = o.item
    const patch = { ...movePatch(item, o.date, to.date, o.allDay ? undefined : to.time) }
    if (!o.allDay && to.duration && to.duration !== o.duration) patch.duration = to.duration
    if (o.series) {
      askScope('Move a repeating event', {
        this: () => detachOccurrence(item.path, item.id, o.date, { date: to.date, time: to.time, duration: to.duration, recurrence: null }),
        following: () => {
          endSeriesBefore(item.path, item.id, o.date)
          addEvent(item.path, { title: item.title, date: to.date, time: to.time, duration: to.duration, recurrence: item.recurrence, location: item.location, color: item.color, notes: item.notes })
        },
        all: () => updateItem(item.path, item.id, patch),
      })
      return
    }
    const back = undoPatch(item, patch)
    updateItem(item.path, item.id, patch)
    const when = `${relativeDay(to.date)}${!o.allDay && to.time ? `, ${formatTime(to.time, h12)}` : ''}`
    toast(`Moved to ${when}`, { action: { label: 'Undo', run: () => updateItem(item.path, item.id, back) } })
    announce(`Moved ${item.label || item.title} to ${when}`)
  }

  const toggle = (o) => toggleTask(o.item.path, o.item.id)
  const dropItem = ({ path, id }, day, time) => {
    const list = lists.find((l) => l.path === path)
    const item = list?.all.get(id)
    if (!item) return
    updateItem(path, id, { [dateKeyOf(item)]: day, time: time || null, duration: time ? item.duration || c.defaultDuration : null })
    announce(`Scheduled ${item.label || item.title}`)
  }
  const moveDay = (occKey, itemRaw, day) => {
    if (occKey) {
      const o = occs.find((x) => x.key === occKey)
      if (o && o.date !== day) moveOcc(o, { date: day, time: o.time, duration: o.duration })
    } else if (itemRaw) dropItem(JSON.parse(itemRaw), day, null)
  }

  // ---- keyboard and commands ----
  const G = 'Calendar'
  useShortcut('t', () => go({ date: today }), { description: 'Go to today', group: G })
  useShortcut('left', () => go({ date: stepDate(view, date, -1) }), { description: 'Previous period', group: G })
  useShortcut('right', () => go({ date: stepDate(view, date, 1) }), { description: 'Next period', group: G })
  useShortcut('n', () => openNew({ date: days.includes(today) ? today : days[0], time: `${String(Math.min(22, new Date().getHours() + 1)).padStart(2, '0')}:00`, duration: c.defaultDuration }, { x: window.innerWidth / 2, y: 160 }), { description: 'New event', group: G })
  for (const v of VIEWS) useShortcut(v.key, () => go({ view: v.id }), { description: `${v.label} view`, group: G }) // eslint-disable-line react-hooks/rules-of-hooks
  useShortcut('/', () => setSearching(true), { description: 'Search the calendar', group: G })
  useEffect(() => {
    if (route.query.new) {
      navigate(`/calendar?view=${view}&date=${date}`, { replace: true })
      setTimeout(() => openNew({ date, time: '09:00', duration: c.defaultDuration }, { x: window.innerWidth / 2, y: 160 }), 50)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query.new])
  useEffect(
    () =>
      useUI.getState().registerCommands('calendar', [
        { id: 'cal.today', title: 'Calendar: go to today', run: () => go({ date: today }) },
        { id: 'cal.new', title: 'Calendar: new event', run: () => openNew({ date, time: '09:00', duration: c.defaultDuration }, { x: window.innerWidth / 2, y: 160 }) },
        ...VIEWS.map((v) => ({ id: `cal.view.${v.id}`, title: `Calendar: ${v.label.toLowerCase()} view`, run: () => go({ view: v.id }) })),
        { id: 'cal.export', title: 'Calendar: export all to .ics', run: () => download('lumen.ics', exportIcs('all')) },
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, date],
  )

  const calMenu = (cal) => [
    { label: 'Edit calendar…', onSelect: () => setCalEdit({ anchor: document.getElementById(`cal-${cal.id}`), cal }) },
    { label: 'Set as default', checked: defaultCal?.path === cal.path, onSelect: () => setPrefs({ calendar: { defaultCalendar: cal.path } }) },
    { label: 'Export .ics', icon: Download, onSelect: () => download(`${cal.id}.ics`, exportIcs(cal.path)) },
    {
      label: 'Import .ics…',
      icon: Upload,
      onSelect: () => {
        importTarget.current = cal.path
        importRef.current?.click()
      },
    },
    'separator',
    { label: 'Delete calendar…', danger: true, onSelect: () => setConfirmDel(cal) },
  ]
  const toggleHidden = (path) => setPrefs({ calendar: { hidden: hidden.has(path) ? [...hidden].filter((p) => p !== path) : [...hidden, path] } })

  const settings = { ...c, h12 }
  const common = { occs, settings, h12, onCreate: openNew, onOpen: openOcc, onToggle: toggle }

  return (
    <div className={`view cal${side ? ' has-side' : ''}`}>
      <header className="view-header has-border cal-header">
        <IconButton icon={PanelLeft} label={side ? 'Hide side panel' : 'Show side panel'} active={side} onClick={toggleSide} />
        <h1 className="view-title cal-title">{periodTitle(view, view === 'timeline' ? [date] : days)}</h1>
        <div className="cal-nav">
          <IconButton icon={ChevronLeft} label="Previous" onClick={() => go({ date: stepDate(view, date, -1) })} />
          <Button size="sm" onClick={() => go({ date: today })}>
            Today
          </Button>
          <IconButton icon={ChevronRight} label="Next" onClick={() => go({ date: stepDate(view, date, 1) })} />
        </div>
        <div className="view-actions">
          {searching ? (
            <div className="cal-search">
              <Search size={14} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" aria-label="Filter the calendar" onKeyDown={(e) => e.key === 'Escape' && (setQ(''), setSearching(false))} onBlur={() => !q && setSearching(false)} />
            </div>
          ) : (
            <IconButton icon={Search} label="Search the calendar" onClick={() => setSearching(true)} />
          )}
          <Segmented label="View" className="cal-views" value={view} onChange={(v) => go({ view: v })} options={VIEWS.map((v) => ({ value: v.id, label: v.label }))} />
          <Select className="cal-views-select" value={view} onChange={(e) => go({ view: e.target.value })} options={VIEWS.map((v) => ({ value: v.id, label: v.label }))} aria-label="View" />
          <Tooltip label="Customize">
            <button ref={czRef} type="button" className="ui-icon-button" aria-label="Customize the calendar" aria-pressed={customize} onClick={() => setCustomize(!customize)}>
              <SlidersHorizontal size={16} />
            </button>
          </Tooltip>
          <Button variant="primary" size="sm" icon={Plus} onClick={(e) => openNew({ date: days.includes(today) ? today : days[0], time: `${String(Math.min(22, new Date().getHours() + 1)).padStart(2, '0')}:00`, duration: c.defaultDuration }, e.currentTarget)}>
            New
          </Button>
        </div>
      </header>

      <div className="cal-body">
        {side && (
          <aside className="cal-side" aria-label="Calendars">
            <MiniMonth value={date} onChange={(d) => go({ date: d })} weekStart={prefs.weekStart} marks={marks} today={today} />
            <section className="cal-side-section">
              <div className="cal-side-head">
                <span>Calendars</span>
                <button ref={newCalRef} type="button" className="nav-section-add" aria-label="New calendar" onClick={() => setCalEdit({ anchor: newCalRef.current })}>
                  <Plus size={14} />
                </button>
              </div>
              {calendars.map((cal) => (
                <div key={cal.path} id={`cal-${cal.id}`} className="cal-src">
                  <Checkbox checked={!hidden.has(cal.path)} onChange={() => toggleHidden(cal.path)} label={<span className="cal-src-name"><ColorDot color={cal.color || 'blue'} size={8} /> {cal.name}{defaultCal?.path === cal.path && <span className="faint"> · default</span>}</span>} />
                  <Menu align="end" items={calMenu(cal)} trigger={<button type="button" className="cal-src-more" aria-label={`${cal.name} options`}><MoreHorizontal size={14} /></button>} />
                </div>
              ))}
            </section>
            {c.showTasks && (
              <section className="cal-side-section">
                <div className="cal-side-head">
                  <span>Boards</span>
                </div>
                {lists.map((l) => (
                  <div key={l.path} className="cal-src">
                    <Checkbox checked={!hidden.has(l.path)} onChange={() => toggleHidden(l.path)} label={<span className="cal-src-name"><ColorDot color={l.color || 'gray'} size={8} /> {l.name}</span>} />
                  </div>
                ))}
              </section>
            )}
            <section className="cal-side-section cal-inbox">
              <div className="cal-side-head">
                <span>To schedule</span>
                <span className="faint">{inbox.length}</span>
              </div>
              <p className="cal-side-hint">Drag onto the calendar to plan it.</p>
              {inbox.slice(0, 40).map((i) => (
                <div
                  key={`${i.path}#${i.id}`}
                  className="cal-inbox-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-lumen-item', JSON.stringify({ path: i.path, id: i.id }))
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <ColorDot color={i.source.color || 'gray'} size={6} />
                  <span className="cal-inbox-title">
                    {titleOf(i)}
                  </span>
                  {itemDay(i) && <span className="cal-inbox-late">{relativeDay(itemDay(i))}</span>}
                </div>
              ))}
              {!inbox.length && <p className="cal-side-hint">Everything has a day.</p>}
            </section>
          </aside>
        )}
        <div className="cal-main">
          {view === 'timeline' && <TimelineView date={date} {...common} />}
          {(view === 'day' || view === '3day' || view === 'week') && <TimeGrid days={days} {...common} onMove={moveOcc} onDropItem={dropItem} announce={announce} />}
          {view === 'month' && <MonthView days={days} focus={date} {...common} onMoveDay={moveDay} />}
          {view === 'agenda' && <AgendaView days={days} {...common} />}
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {live}
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          const r = importIcs(importTarget.current || defaultCal?.path, await file.text())
          toast(`Imported ${r.added} event${r.added === 1 ? '' : 's'}${r.warnings.length ? ` · ${r.warnings.length} couldn’t repeat exactly` : ''}`)
        }}
      />

      <Popover open={customize} onOpenChange={setCustomize} anchor={czRef} placement="bottom-end" className="customize-pop">
        <Customize c={c} prefs={prefs} calendars={calendars} />
      </Popover>

      {editor && (
        <EventEditor
          open
          anchor={editor.anchor}
          value={editor.value}
          isNew={editor.isNew}
          calendars={calendars}
          lists={lists}
          h12={h12}
          defaultDuration={c.defaultDuration}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
          onDelete={() => deleteOcc(editor.occ)}
        />
      )}

      <Dialog
        open={!!scope}
        onClose={() => setScope(null)}
        size="sm"
        title={scope?.title}
        description="This event repeats. What should change?"
        footer={
          <Button variant="ghost" onClick={() => setScope(null)}>
            Cancel
          </Button>
        }
      >
        <div className="scope-choices">
          {[
            ['this', 'This event', 'Only this occurrence'],
            ['following', 'This and following', 'From this one onwards'],
            ['all', 'All events', 'The whole series'],
          ].map(([k, label, hint]) => (
            <button
              key={k}
              type="button"
              className="scope-choice"
              onClick={() => {
                scope.actions[k]()
                setScope(null)
              }}
            >
              <span>{label}</span>
              <span className="faint">{hint}</span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        size="sm"
        title={`Delete “${confirmDel?.name}”?`}
        description="The calendar and all its events will be removed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteCalendar(confirmDel.path)
                setConfirmDel(null)
              }}
            >
              Delete calendar
            </Button>
          </>
        }
      />
      <ListEditor
        kind="calendar"
        open={!!calEdit}
        onOpenChange={(o) => !o && setCalEdit(null)}
        anchor={calEdit?.anchor}
        initial={calEdit?.cal || {}}
        onSave={(v) => (calEdit?.cal ? updateCalendarMeta(calEdit.cal.path, v) : createCalendar(v))}
      />
    </div>
  )
}
