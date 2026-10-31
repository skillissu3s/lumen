// A card's front, the way obi (and Trello) draws one: an optional cover, labels
// as thin bars of colour (a click shows their names), the title with a tick that
// appears where it starts, and a row of small badges.
import { memo, useCallback, useEffect, useState } from 'react'
import { AlignLeft, Calendar, CalendarPlus, Circle, CircleCheckBig, CircleDashed, Clock, Flag, ListChecks, Repeat, Tag } from 'lucide-react'
import { Popover } from '../../components/ui/index.js'
import { toggleTask } from '../../lib/actions.js'
import { useSettle } from '../../lib/celebrate.js'
import { colorFor, splitTitle } from '../../lib/colors.js'
import { addDays, formatTime, relativeDay, todayIso } from '../../../../shared/dates.js'
import { isOpen, itemDay } from '../../../../shared/items.js'
import { progressOf } from '../tasks/taskQueries.js'
import { DuePicker, LabelPicker, PriorityPicker } from './pickers.jsx'
import './boards.css'

export const PRIORITY_COLOR = { highest: 'red', high: 'orange', medium: 'blue', low: 'gray', lowest: 'gray' }
export const PRIORITY_NAME = { highest: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' }

/** How a due date reads: done, overdue, today, soon (tomorrow), or plain ('') */
export function dueTone(day, status, today) {
  if (!day) return ''
  if (!isOpen(status)) return 'done'
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  return day === addDays(today, 1) ? 'soon' : ''
}

/** The round check: open, in progress (dashed) or done */
export function StatusIcon({ status }) {
  if (!isOpen(status)) return <CircleCheckBig />
  return status === '/' ? <CircleDashed /> : <Circle />
}

/** A #tag as a label, in the colour the board gave it (else the one its name gives it) */
export function Label({ tag, color, onRemove, onClick }) {
  return (
    <span className={`pb-label${onClick ? ' pickable' : ''}`} style={{ '--label': `var(--c-${color || colorFor(tag)})` }} title={`#${tag}`} onClick={onClick}>
      {tag}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${tag}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}

// labels as thin bars or with their names: one choice, remembered for every board
const NAMES_KEY = 'lumen.labelNames'
let namesShown = (() => {
  try {
    return localStorage.getItem(NAMES_KEY) === '1'
  } catch {
    return false
  }
})()
const namesListeners = new Set()
export function useLabelNames() {
  const [on, setOn] = useState(namesShown)
  const toggle = useCallback(() => {
    namesShown = !namesShown
    try {
      localStorage.setItem(NAMES_KEY, namesShown ? '1' : '0')
    } catch {
      /* fine */
    }
    for (const fn of namesListeners) fn(namesShown)
  }, [])
  useEffect(() => {
    namesListeners.add(setOn)
    return () => namesListeners.delete(setOn)
  }, [])
  return [on, toggle]
}

/**
 * `onPress` (pointer drag on a board) or, without it, the browser's drag and
 * drop (All tasks, onto the calendar or the sidebar). `hidden`: being dragged.
 */
export const Card = memo(function Card({ item, labelColors = {}, labels, cover, showBoard, h12, onOpen, onPress, onMenu, hidden, quiet }) {
  const today = todayIso()
  const { text, tags } = splitTitle(item.title)
  const day = itemDay(item)
  const done = !isOpen(item.status)
  const tone = dueTone(day, item.status, today)
  const prog = progressOf(item)
  const [names, toggleNames] = useLabelNames()
  const [settling, settle] = useSettle(() => toggleTask(item.path, item.id))
  const toggle = (el) => (done ? toggleTask(item.path, item.id) : settle(el))
  const native = !onPress
  // the due date, priority and labels, picked right on the card
  const [picking, setPicking] = useState(null) // { kind, anchor }
  const pick = (kind) => (e) => {
    e.stopPropagation()
    setPicking({ kind, anchor: { current: e.currentTarget } })
  }
  const stop = (e) => e.stopPropagation()
  return (
    <article
      className={`pb-card${done ? ' done' : ''}${item.status === '/' ? ' doing' : ''}${settling ? ' settling' : ''}${hidden ? ' is-dragging' : ''}${picking ? ' is-picking' : ''}`}
      data-card={item.id}
      tabIndex={0}
      draggable={native || undefined}
      aria-label={`${text}${day ? `, due ${relativeDay(day, today)}` : ''}${done ? ', done' : ''}`}
      onPointerDown={onPress}
      onDragStart={
        native
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-lumen-item', JSON.stringify({ path: item.path, id: item.id }))
              e.dataTransfer.setData('text/plain', text)
            }
          : undefined
      }
      onClick={(e) => {
        if (quiet?.()) return // (the click that ends a drag)
        if (!e.target.closest('button')) onOpen(item)
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen(item)
        } else if (e.key === ' ') {
          e.preventDefault()
          toggle(e.currentTarget.querySelector('.pb-check'))
        }
      }}
      onContextMenu={onMenu}
    >
      {cover && <div className="pb-cover" style={{ '--lc': `var(--c-${cover})` }} />}
      {tags.length > 0 && (
        <div
          className={`pb-labels${names ? '' : ' thin'}`}
          title={names ? undefined : tags.map((t) => `#${t}`).join('  ')}
          onClick={(e) => {
            e.stopPropagation()
            toggleNames()
          }}
        >
          {tags.map((t) => (
            <Label key={t} tag={t} color={labelColors[t]} />
          ))}
        </div>
      )}
      <div className="pb-card-title">
        <button type="button" className={`pb-check${done ? ' on' : ''}`} aria-label={done ? 'Mark not done' : 'Mark done'} title={done ? 'Mark not done' : item.status === '/' ? 'In progress — mark done' : 'Mark done'} onClick={(e) => toggle(e.currentTarget)}>
          <StatusIcon status={settling ? 'x' : item.status} />
        </button>
        <span className="pb-words">
          <span className="pb-strike">{text || 'Untitled card'}</span>
        </span>
      </div>
      <div className="pb-badges">
        {day ? (
          <button type="button" className={`pb-badge pb-pick due ${tone}`} title={`Due ${day} — change`} onClick={pick('due')}>
            <Calendar />
            {relativeDay(day, today)}
          </button>
        ) : (
          !done && (
            <button type="button" className="pb-badge pb-pick pb-unset" title="Set a due date" aria-label="Set a due date" onClick={pick('due')}>
              <CalendarPlus />
            </button>
          )
        )}
        {item.time && (
          <span className="pb-badge" title="Time">
            <Clock />
            {formatTime(item.time, h12)}
          </span>
        )}
        {item.priority ? (
          <button type="button" className={`pb-badge pb-pick task-pri pri-${item.priority}`} title={`${PRIORITY_NAME[item.priority]} priority — change`} onClick={pick('priority')}>
            <Flag />
          </button>
        ) : (
          !done && (
            <button type="button" className="pb-badge pb-pick pb-unset" title="Set a priority" aria-label="Set a priority" onClick={pick('priority')}>
              <Flag />
            </button>
          )
        )}
        {!done && labels && (
          <button type="button" className="pb-badge pb-pick pb-unset" title="Labels" aria-label="Labels" onClick={pick('labels')}>
            <Tag />
          </button>
        )}
        {item.recurrence && (
          <span className="pb-badge" title={`Repeats ${item.recurrence}`}>
            <Repeat />
          </span>
        )}
        {item.notes && (
          <span className="pb-badge" title="This card has a description">
            <AlignLeft />
          </span>
        )}
        {prog.total > 0 && (
          <span className={`pb-badge${prog.done === prog.total ? ' full' : ''}`} title={`${prog.done} of ${prog.total} checklist items done`}>
            <ListChecks />
            {prog.done}/{prog.total}
          </span>
        )}
        {showBoard && item.source && (
          <span className="pb-badge pb-board" style={{ '--bc': `var(--c-${item.source.color || 'gray'})` }}>
            <i />
            {item.source.name}
          </span>
        )}
      </div>
      {picking && (
        // (a popover renders elsewhere in the page, but its events still pass through the card: keep them there)
        <span onClick={stop} onPointerDown={stop} onKeyDown={stop} onContextMenu={stop}>
          <Popover open onOpenChange={(o) => !o && setPicking(null)} anchor={picking.anchor} placement="bottom-start" className={picking.kind === 'labels' ? 'label-pop' : 'qp-pop'}>
            {picking.kind === 'due' && <DuePicker item={item} onClose={() => setPicking(null)} />}
            {picking.kind === 'priority' && <PriorityPicker item={item} onClose={() => setPicking(null)} />}
            {picking.kind === 'labels' && <LabelPicker item={item} settings={{ labels: labelColors }} known={labels} onClose={() => setPicking(null)} />}
          </Popover>
        </span>
      )}
    </article>
  )
})
