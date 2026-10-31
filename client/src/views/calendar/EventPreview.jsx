// What a click on the calendar shows first: the item at a glance (when, where,
// how often, its notes), with the few things one does next. The full editor is
// one step further.
import { useEffect } from 'react'
import { AlignLeft, Copy, Kanban, MapPin, Pencil, Repeat, SquareArrowOutUpRight, Trash2, X } from 'lucide-react'
import { IconBadge, Popover, TaskCheckbox } from '../../components/ui/index.js'
import { dayName, dayOfMonth, formatTime, fromMinutes, humanDuration, monthName, relativeDay, toMinutes } from '../../../../shared/dates.js'
import { describeRecurrence } from '../../../../shared/recurrence.js'
import { isOpen } from '../../../../shared/items.js'
import { renderMarkdown } from '../docs/markdown.js'
import { colorOf, titleOf } from './calendarMath.js'

function when(o, h12) {
  const day = `${relativeDay(o.date)} · ${dayName(o.date)} ${dayOfMonth(o.date)} ${monthName(o.date, true)}`
  if (o.allDay) return { day, time: o.item.endDate && o.item.endDate > o.date ? `All day, until ${relativeDay(o.item.endDate)}` : 'All day' }
  const end = fromMinutes(toMinutes(o.time) + (o.duration || 0))
  return { day, time: `${formatTime(o.time, h12)} – ${formatTime(end, h12)}  ·  ${humanDuration(o.duration)}` }
}

/** `o`: an occurrence. onEdit · onDelete · onToggle · onOpenCard (tasks) · onDuplicate */
export function EventPreview({ o, anchor, h12, colorBy, onClose, onEdit, onDelete, onToggle, onOpenCard, onDuplicate }) {
  const item = o.item
  const task = item.kind === 'task'
  const done = task && !isOpen(item.status)
  const color = colorOf(item, colorBy)
  const w = when(o, h12)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea')) return
      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault()
        onEdit()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDelete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEdit, onDelete])
  return (
    <Popover open onOpenChange={(v) => !v && onClose()} anchor={anchor} placement="right-start" className="ev-preview" aria-label={titleOf(item)}>
      <div className="ev-tools">
        {task && (
          <button type="button" className="ev-tool" aria-label="Open the card" title="Open the card" onClick={onOpenCard}>
            <SquareArrowOutUpRight size={15} />
          </button>
        )}
        <button type="button" className="ev-tool" aria-label="Edit" title="Edit (E)" onClick={onEdit}>
          <Pencil size={15} />
        </button>
        {!o.series && (
          <button type="button" className="ev-tool" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
            <Copy size={15} />
          </button>
        )}
        <button type="button" className="ev-tool is-danger" aria-label="Delete" title="Delete (Del)" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
        <span className="ev-tools-sep" />
        <button type="button" className="ev-tool" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="ev-head">
        {task ? (
          <span className="ev-check">
            <TaskCheckbox status={item.status} label={done ? 'Mark as open' : 'Complete'} onToggle={onToggle} />
          </span>
        ) : (
          <span className="ev-swatch" style={{ '--c': `var(--c-${color})` }} />
        )}
        <div className="ev-title-wrap">
          <h3 className={`ev-title${done ? ' is-done' : ''}`}>{titleOf(item)}</h3>
          <p className="ev-when">
            {w.day}
            <br />
            <span className="faint">{w.time}</span>
          </p>
        </div>
      </div>
      <ul className="ev-facts">
        {item.recurrence && (
          <li>
            <Repeat size={14} />
            {describeRecurrence(item.recurrence)}
          </li>
        )}
        {item.location && (
          <li>
            <MapPin size={14} />
            {item.location}
          </li>
        )}
        {item.source && (
          <li>
            {task ? <Kanban size={14} /> : <IconBadge name={item.source.icon} color={item.source.color || 'gray'} size={14} />}
            {item.source.name}
          </li>
        )}
        {item.notes && (
          <li className="ev-notes">
            <AlignLeft size={14} />
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.notes) }} />
          </li>
        )}
      </ul>
    </Popover>
  )
}
