// Month and agenda views.
import { useState } from 'react'
import { Popover } from '../../components/ui/index.js'
import { dayName, dayOfMonth, formatTime, isoWeek, monthName, relativeDay, todayIso } from '../../../../shared/dates.js'
import { onDay } from '../../../../shared/calendar.js'
import { isOpen } from '../../../../shared/items.js'
import { colorOf } from './calendarMath.js'
import { blockLabel } from './TimeGrid.jsx'

function Chip({ o, colorBy, h12, onOpen, draggable }) {
  const color = colorOf(o.item, colorBy)
  const done = o.item.kind === 'task' && !isOpen(o.item.status)
  return (
    <button
      type="button"
      className={`mchip${o.allDay ? ' is-allday' : ''}${done ? ' is-done' : ''}${o.ghost ? ' is-ghost' : ''}`}
      style={{ '--c': `var(--c-${color})`, '--c-bg': `var(--c-${color}-bg)`, '--c-fg': `var(--c-${color}-fg)` }}
      aria-label={blockLabel(o, h12)}
      draggable={draggable && !o.ghost}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-lumen-occ', o.key)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(o, e.currentTarget)
      }}
    >
      {!o.allDay && <span className="mchip-dot" />}
      {!o.allDay && <span className="mchip-time tabular">{formatTime(o.time, h12)}</span>}
      {o.item.icon && <span>{o.item.icon}</span>}
      <span className="mchip-title">{o.item.label || o.item.title}</span>
    </button>
  )
}

export function MonthView({ days, focus, occs, settings, h12, onCreate, onOpen, onMoveDay }) {
  const today = todayIso()
  const month = focus.slice(0, 7)
  const [more, setMore] = useState(null) // { day, anchor }
  const [over, setOver] = useState(null)
  const weeks = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  const max = 4
  return (
    <div className="month" style={{ '--weeks': weeks.length }}>
      <div className="month-head">
        {settings.showWeekNumbers && <span className="month-wk" />}
        {weeks[0].map((d) => (
          <span key={d} className="month-dayname">
            {dayName(d, true)}
          </span>
        ))}
      </div>
      <div className="month-body" role="grid" aria-label={`${monthName(focus)} ${focus.slice(0, 4)}`}>
        {weeks.map((week) => (
          <div key={week[0]} className="month-week" role="row">
            {settings.showWeekNumbers && <span className="month-wk">{isoWeek(week[0])}</span>}
            {week.map((d) => {
              const list = onDay(occs, d)
              return (
                <div
                  key={d}
                  role="gridcell"
                  tabIndex={-1}
                  className={`month-cell${d.slice(0, 7) !== month ? ' is-outside' : ''}${d === today ? ' is-today' : ''}${over === d ? ' is-over' : ''}`}
                  onDoubleClick={(e) => onCreate({ date: d, time: null, duration: null, allDay: true }, e.currentTarget)}
                  onClick={(e) => e.target === e.currentTarget && onCreate({ date: d, time: null, duration: null, allDay: true }, e.currentTarget)}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('application/x-lumen-occ') && !e.dataTransfer.types.includes('application/x-lumen-item')) return
                    e.preventDefault()
                    setOver(d)
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => {
                    setOver(null)
                    e.preventDefault()
                    onMoveDay(e.dataTransfer.getData('application/x-lumen-occ'), e.dataTransfer.getData('application/x-lumen-item'), d)
                  }}
                >
                  <span className="month-num">{dayOfMonth(d)}</span>
                  {list.slice(0, max).map((o) => (
                    <Chip key={o.key} o={o} colorBy={settings.colorBy} h12={h12} onOpen={onOpen} draggable />
                  ))}
                  {list.length > max && (
                    <button type="button" className="month-more" onClick={(e) => setMore({ day: d, anchor: e.currentTarget })}>
                      {list.length - max} more
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <Popover open={!!more} onOpenChange={(o) => !o && setMore(null)} anchor={more?.anchor} placement="bottom-start" className="month-pop">
        {more && (
          <div className="month-pop-body">
            <div className="month-pop-title">{relativeDay(more.day)}</div>
            {onDay(occs, more.day).map((o) => (
              <Chip key={o.key} o={o} colorBy={settings.colorBy} h12={h12} onOpen={(x, a) => (setMore(null), onOpen(x, a))} />
            ))}
          </div>
        )}
      </Popover>
    </div>
  )
}

export function AgendaView({ days, occs, settings, h12, onOpen, onToggle }) {
  const today = todayIso()
  const groups = days.map((d) => ({ d, list: onDay(occs, d) })).filter((g) => g.list.length)
  if (!groups.length) return <div className="agenda-empty">Nothing in the next 30 days.</div>
  return (
    <div className="agenda">
      {groups.map(({ d, list }) => (
        <section key={d} className={`agenda-day${d === today ? ' is-today' : ''}`} aria-label={relativeDay(d)}>
          <div className="agenda-date">
            <span className="agenda-num">{dayOfMonth(d)}</span>
            <span className="agenda-dn">
              {dayName(d, true)} · {monthName(d, true)}
            </span>
          </div>
          <ul className="agenda-list">
            {list.map((o) => {
              const color = colorOf(o.item, settings.colorBy)
              const done = o.item.kind === 'task' && !isOpen(o.item.status)
              return (
                <li key={o.key} className={`agenda-item${done ? ' is-done' : ''}${o.ghost ? ' is-ghost' : ''}`} style={{ '--c': `var(--c-${color})` }}>
                  <span className="agenda-time tabular">{o.allDay ? 'All day' : `${formatTime(o.time, h12)}`}</span>
                  <span className="agenda-bar" />
                  {o.item.kind === 'task' && !o.ghost ? (
                    <button type="button" className={`tl-mini-check${done ? ' is-on' : ''}`} aria-label={done ? 'Mark as open' : 'Complete'} onClick={() => onToggle(o)} />
                  ) : null}
                  <button type="button" className="agenda-title" onClick={(e) => onOpen(o, e.currentTarget)} aria-label={blockLabel(o, h12)}>
                    {o.item.icon && <span>{o.item.icon}</span>}
                    {o.item.label || o.item.title}
                    {o.item.source?.name && <span className="faint"> · {o.item.source.name}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
