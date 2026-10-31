// One task in a list: checkbox, title, and quiet details on the right.
import { memo, useEffect, useRef, useState } from 'react'
import { AlignLeft, ChevronRight, Clock, GripVertical, MoreHorizontal, Repeat } from 'lucide-react'
import { ColorDot, ContextMenu, Menu, TaskCheckbox } from '../../components/ui/index.js'
import { addDays, formatTime, humanDuration, relativeDay, todayIso } from '../../../../shared/dates.js'
import { describeRecurrence } from '../../../../shared/recurrence.js'
import { isOpen, itemDay } from '../../../../shared/items.js'
import { deleteItem, moveItemToFile, toggleTask, updateItem } from '../../lib/actions.js'
import { progressOf } from './taskQueries.js'

const PRIORITY_COLOR = { highest: 'red', high: 'orange', medium: 'blue' }

export function taskMenu(item, lists, extra = []) {
  const today = todayIso()
  const set = (patch) => () => updateItem(item.path, item.id, patch)
  const dateKey = item.date ? 'date' : item.scheduled ? 'scheduled' : item.start ? 'start' : 'date'
  return [
    { label: isOpen(item.status) ? 'Complete' : 'Mark as open', onSelect: () => toggleTask(item.path, item.id), shortcut: 'X' },
    item.status === '/' ? { label: 'Not started', onSelect: set({ status: ' ' }) } : { label: 'Start', onSelect: set({ status: '/' }) },
    'separator',
    { section: 'Date' },
    { label: 'Today', onSelect: set({ [dateKey]: today }), shortcut: 'T' },
    { label: 'Tomorrow', onSelect: set({ [dateKey]: addDays(today, 1) }), shortcut: 'M' },
    { label: 'Next week', onSelect: set({ [dateKey]: addDays(today, 7 - ((new Date().getDay() + 6) % 7)) }) },
    { label: 'No date', onSelect: set({ date: null, scheduled: null, start: null, time: null }) },
    'separator',
    { section: 'Priority' },
    ...['high', 'medium', 'low'].map((p) => ({ label: p[0].toUpperCase() + p.slice(1), checked: item.priority === p, onSelect: set({ priority: item.priority === p ? null : p }) })),
    'separator',
    ...(lists.length > 1 ? [{ section: 'Move to' }, ...lists.filter((l) => l.path !== item.path).slice(0, 8).map((l) => ({ label: `${l.icon ? `${l.icon} ` : ''}${l.name}`, onSelect: () => moveItemToFile(item.path, item.id, l.path, {}) })), 'separator'] : []),
    ...extra,
    { label: 'Delete', danger: true, onSelect: () => deleteItem(item.path, item.id), shortcut: 'Del' },
  ]
}

function Meta({ item, today, showList, h12, hideDay }) {
  const day = itemDay(item)
  const parts = []
  if (showList && item.source) {
    parts.push(
      <span key="list" className="tmeta tmeta-list">
        {item.source.icon ? <span>{item.source.icon}</span> : <ColorDot color={item.source.color || 'gray'} size={6} />}
        {item.source.name}
      </span>,
    )
  }
  const prog = progressOf(item)
  if (prog.total) parts.push(<span key="sub" className="tmeta tabular">{`${prog.done}/${prog.total}`}</span>)
  if (item.notes) parts.push(<AlignLeft key="notes" size={13} className="tmeta-icon" aria-label="Has notes" />)
  if (item.recurrence) parts.push(<Repeat key="rec" size={13} className="tmeta-icon" aria-label={describeRecurrence(item.recurrence)} />)
  if (item.time)
    parts.push(
      <span key="time" className="tmeta tabular">
        <Clock size={12} />
        {formatTime(item.time, h12)}
        {item.duration ? ` · ${humanDuration(item.duration)}` : ''}
      </span>,
    )
  if (day && !hideDay) {
    const late = isOpen(item.status) && day < today
    parts.push(
      <span key="day" className={`tmeta${late ? ' is-late' : day === today ? ' is-today' : ''}`}>
        {relativeDay(day, today)}
      </span>,
    )
  }
  return <span className="trow-meta">{parts}</span>
}

export const TaskRow = memo(function TaskRow({ item, lists, showList, selected, onSelect, onOpen, depth = 0, h12, draggable = true, onDropOn, renaming, onRenamed, hideDay }) {
  const today = todayIso()
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [drop, setDrop] = useState(null) // 'before' | 'after'
  const titleRef = useRef(null)
  const rowRef = useRef(null)
  const done = !isOpen(item.status)
  const hasSubs = item.subtasks?.length > 0

  useEffect(() => {
    if (renaming) setEditing(true)
  }, [renaming])
  useEffect(() => {
    if (selected && document.activeElement !== titleRef.current) rowRef.current?.focus({ preventScroll: true })
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const finishRename = (save) => {
    const text = titleRef.current?.value.trim()
    if (save && text && text !== item.title) updateItem(item.path, item.id, { title: text })
    setEditing(false)
    onRenamed?.()
    rowRef.current?.focus()
  }

  const dragProps = draggable
    ? {
        draggable: !editing,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-lumen-item', JSON.stringify({ path: item.path, id: item.id }))
          e.dataTransfer.setData('text/plain', item.title)
        },
        onDragOver: (e) => {
          if (!onDropOn || !e.dataTransfer.types.includes('application/x-lumen-item')) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          setDrop(e.clientY < r.top + r.height / 2 ? 'before' : 'after')
        },
        onDragLeave: () => setDrop(null),
        onDrop: (e) => {
          const raw = e.dataTransfer.getData('application/x-lumen-item')
          const where = drop
          setDrop(null)
          if (!raw || !onDropOn) return
          e.preventDefault()
          onDropOn(JSON.parse(raw), item, where)
        },
      }
    : {}

  return (
    <>
      <ContextMenu items={taskMenu(item, lists)}>
        <div
          ref={rowRef}
          role="listitem"
          tabIndex={selected ? 0 : -1}
          aria-selected={selected}
          aria-label={`${item.title}${done ? ', completed' : ''}`}
          className={`trow${selected ? ' is-selected' : ''}${done ? ' is-done' : ''}${drop ? ` drop-${drop}` : ''}`}
          style={{ '--depth': depth }}
          onClick={(e) => {
            if (e.target.closest('button, input, a')) return
            onSelect?.(item, e)
            if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onOpen?.(item)
          }}
          onFocus={(e) => e.target === e.currentTarget && !selected && onSelect?.(item, e)}
          {...dragProps}
        >
          {draggable && <GripVertical size={14} className="trow-grip" aria-hidden="true" />}
          {hasSubs ? (
            <button type="button" className={`trow-expand${open ? ' is-open' : ''}`} aria-label={open ? 'Hide subtasks' : 'Show subtasks'} aria-expanded={open} onClick={() => setOpen(!open)}>
              <ChevronRight size={13} />
            </button>
          ) : (
            <span className="trow-expand-space" />
          )}
          <TaskCheckbox status={item.status} color={PRIORITY_COLOR[item.priority]} label={`Complete “${item.label || item.title}”`} onToggle={() => toggleTask(item.path, item.id)} tabIndex={-1} />
          {editing ? (
            <input
              ref={titleRef}
              className="trow-title-input"
              defaultValue={item.title}
              autoFocus
              aria-label="Task title"
              onBlur={() => finishRename(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename(true)
                if (e.key === 'Escape') finishRename(false)
                e.stopPropagation()
              }}
            />
          ) : (
            <span className="trow-title" onDoubleClick={() => setEditing(true)}>
              {item.icon && <span className="trow-icon">{item.icon}</span>}
              <TitleText text={item.label || item.title} />
            </span>
          )}
          <Meta item={item} today={today} showList={showList} h12={h12} hideDay={hideDay} />
          <Menu
            align="end"
            items={taskMenu(item, lists)}
            trigger={
              <button type="button" className="trow-more" aria-label="Task actions" tabIndex={-1}>
                <MoreHorizontal size={15} />
              </button>
            }
          />
        </div>
      </ContextMenu>
      {open &&
        item.subtasks.map((s) => (
          <TaskRow key={s.id} item={{ ...s, path: item.path, source: item.source }} lists={lists} depth={depth + 1} h12={h12} onOpen={onOpen} draggable={false} />
        ))}
    </>
  )
})

// tags in a title are shown softer than the words around them
function TitleText({ text }) {
  const parts = String(text).split(/(\s#[\p{L}\p{N}_\-/]+)/u)
  return (
    <span className="trow-text">
      {parts.map((p, i) =>
        /^\s#/.test(p) ? (
          <span key={i} className="trow-tag">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </span>
  )
}
