// A card's front: cover, labels, title and a row of small badges.
import { memo, useState } from 'react'
import { AlignLeft, CalendarDays, Clock, Flag, ListChecks, Repeat } from 'lucide-react'
import { TaskCheckbox } from '../../components/ui/index.js'
import { toggleTask } from '../../lib/actions.js'
import { colorFor, splitTitle } from '../../lib/colors.js'
import { formatTime, relativeDay, todayIso, addDays } from '../../../../shared/dates.js'
import { isOpen, itemDay } from '../../../../shared/items.js'
import { progressOf } from '../tasks/taskQueries.js'
import { Label } from './CardDialog.jsx'

export const PRIORITY_COLOR = { highest: 'red', high: 'orange', medium: 'blue', low: 'gray', lowest: 'gray' }
const PRIORITY_NAME = { highest: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' }

export function dueTone(day, status, today) {
  if (!day || !isOpen(status)) return ''
  if (day < today) return 'late'
  if (day === today) return 'today'
  return day === addDays(today, 1) ? 'soon' : ''
}

export const Card = memo(function Card({ item, labelColors = {}, cover, showBoard, h12, onOpen, dragging, dropAt }) {
  const today = todayIso()
  const { text, tags } = splitTitle(item.title)
  const day = itemDay(item)
  const tone = dueTone(day, item.status, today)
  const prog = progressOf(item)
  const done = !isOpen(item.status)
  const [settling, setSettling] = useState(false)
  // a moment to see the tick before the card moves or dims
  const toggle = () => {
    if (done) return toggleTask(item.path, item.id)
    setSettling(true)
    setTimeout(() => {
      setSettling(false)
      toggleTask(item.path, item.id)
    }, 220)
  }
  return (
    <article
      className={`card${done || settling ? ' is-done' : ''}${item.status === '/' ? ' is-doing' : ''}${dragging ? ' is-dragging' : ''}${dropAt ? ` drop-${dropAt}` : ''}`}
      tabIndex={0}
      draggable
      data-card={item.id}
      aria-label={`${text}${day ? `, due ${relativeDay(day, today)}` : ''}${done ? ', done' : ''}`}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-lumen-item', JSON.stringify({ path: item.path, id: item.id }))
        e.dataTransfer.setData('text/plain', text)
      }}
      onClick={(e) => !e.target.closest('button') && onOpen(item)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') onOpen(item)
        else if (e.key === ' ') {
          e.preventDefault()
          toggle()
        }
      }}
    >
      {cover && <div className="card-cover" style={{ '--cv': `var(--c-${cover})` }} />}
      {tags.length > 0 && (
        <div className="card-labels">
          {tags.map((t) => (
            <Label key={t} tag={t} color={labelColors[t] || colorFor(t)} />
          ))}
        </div>
      )}
      <div className="card-title">
        <TaskCheckbox status={settling ? 'x' : item.status} color={PRIORITY_COLOR[item.priority] && item.priority !== 'low' ? PRIORITY_COLOR[item.priority] : undefined} label={done ? 'Mark as open' : 'Complete'} onToggle={toggle} tabIndex={-1} />
        <span className="card-text">{text || 'Untitled card'}</span>
      </div>
      {(day || item.time || item.priority || item.recurrence || item.notes || prog.total > 0 || showBoard) && (
        <div className="card-badges">
          {day && (
            <span className={`badge badge-due${tone ? ` is-${tone}` : ''}`} title={`Due ${day}`}>
              <CalendarDays size={12} />
              {relativeDay(day, today)}
            </span>
          )}
          {item.time && (
            <span className="badge">
              <Clock size={12} />
              {formatTime(item.time, h12)}
            </span>
          )}
          {item.priority && item.priority !== 'low' && item.priority !== 'lowest' && (
            <span className="badge badge-pri" style={{ '--pc': `var(--c-${PRIORITY_COLOR[item.priority]})` }} title={`${PRIORITY_NAME[item.priority]} priority`}>
              <Flag size={12} />
              {PRIORITY_NAME[item.priority]}
            </span>
          )}
          {item.recurrence && (
            <span className="badge" title={`Repeats ${item.recurrence}`}>
              <Repeat size={12} />
            </span>
          )}
          {item.notes && (
            <span className="badge" title="Has a description">
              <AlignLeft size={12} />
            </span>
          )}
          {prog.total > 0 && (
            <span className={`badge${prog.done === prog.total ? ' is-full' : ''}`} title={`${prog.done} of ${prog.total} checklist items`}>
              <ListChecks size={12} />
              {prog.done}/{prog.total}
            </span>
          )}
          {showBoard && item.source && (
            <span className="badge badge-board" style={{ '--bc': `var(--c-${item.source.color || 'gray'})` }}>
              <i />
              {item.source.name}
            </span>
          )}
        </div>
      )}
    </article>
  )
})
