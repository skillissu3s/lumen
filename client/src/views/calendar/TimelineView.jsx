// The day as a timeline, after Structured: each timed item is a coloured pill
// on a line, sized by how long it takes, with free time between them visible.
import { Check, Plus } from 'lucide-react'
import { formatTime, fromMinutes, humanDuration, nowMinutes, todayIso, toMinutes, dayName, dayOfMonth, monthName } from '../../../../shared/dates.js'
import { freeGaps, layoutDay } from '../../../../shared/calendar.js'
import { isOpen } from '../../../../shared/items.js'
import { colorOf } from './calendarMath.js'
import { blockLabel } from './TimeGrid.jsx'

function Pill({ o, color, onToggle, height }) {
  const done = o.item.kind === 'task' && !isOpen(o.item.status)
  return (
    <span className={`tl-pill${done ? ' is-done' : ''}`} style={{ height, '--c': `var(--c-${color})`, '--c-bg': `var(--c-${color}-bg)` }}>
      <span className="tl-pill-icon">{o.item.icon || (o.item.kind === 'task' ? '' : '•')}</span>
      {o.item.kind === 'task' && !o.ghost && (
        <button
          type="button"
          className="tl-check"
          aria-label={done ? 'Mark as open' : 'Complete'}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(o)
          }}
        >
          {done && <Check size={10} strokeWidth={3} />}
        </button>
      )}
    </span>
  )
}

export function TimelineView({ date, occs, settings, h12, onCreate, onOpen, onToggle }) {
  const { colorBy, dayStart, dayEnd, timeline } = settings
  const today = todayIso()
  const isToday = date === today
  const now = nowMinutes()
  const untimed = occs.filter((o) => o.allDay && o.date <= date && o.endDate >= date)
  const timed = layoutDay(occs.filter((o) => !o.allDay && o.date === date))
  const gaps = timeline?.showGaps === false ? [] : freeGaps(timed, dayStart * 60, dayEnd * 60, 30)

  // one sorted stream of rows: items, gaps and "now"
  const rows = [
    ...timed.map((o) => ({ kind: 'item', at: o.top, o })),
    ...gaps.map((g) => ({ kind: 'gap', at: g.from, g })),
    ...(isToday ? [{ kind: 'now', at: now }] : []),
  ].sort((a, b) => a.at - b.at || (a.kind === 'now' ? -1 : b.kind === 'now' ? 1 : 0))

  const pillHeight = (d) => Math.min(160, 44 + Math.max(0, d - 15) * 0.9)

  return (
    <div className="timeline">
      <div className="tl-day">
        <h2 className="tl-date">
          {dayName(date)} <span className="faint">{dayOfMonth(date)} {monthName(date)}</span>
        </h2>
        {untimed.length > 0 && (
          <div className="tl-untimed" aria-label="All day">
            {untimed.map((o) => {
              const color = colorOf(o.item, colorBy)
              const done = o.item.kind === 'task' && !isOpen(o.item.status)
              return (
                <div key={o.key} className={`tl-untimed-item${done ? ' is-done' : ''}`} style={{ '--c': `var(--c-${color})`, '--c-bg': `var(--c-${color}-bg)` }}>
                  {o.item.kind === 'task' ? (
                    <button type="button" className="tl-mini-check" aria-label={done ? 'Mark as open' : 'Complete'} onClick={() => onToggle(o)}>
                      {done && <Check size={9} strokeWidth={3} />}
                    </button>
                  ) : (
                    <span className="tl-mini-dot" />
                  )}
                  <button type="button" className="tl-untimed-title" onClick={(e) => onOpen(o, e.currentTarget)} aria-label={blockLabel(o, h12)}>
                    {o.item.icon && <span>{o.item.icon}</span>}
                    {o.item.label || o.item.title}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <ol className="tl-rows" aria-label={`Schedule for ${dayName(date)}`}>
          {rows.map((r, i) => {
            if (r.kind === 'now')
              return (
                <li key="now" className="tl-now" aria-label={`Now, ${formatTime(fromMinutes(now), h12)}`}>
                  <span className="tl-time tabular">{formatTime(fromMinutes(now), h12)}</span>
                  <span className="tl-now-line" />
                </li>
              )
            if (r.kind === 'gap') {
              const len = r.g.to - r.g.from
              return (
                <li key={`gap-${i}`} className="tl-gap">
                  <span className="tl-time" />
                  <span className="tl-rail" />
                  <button type="button" className="tl-gap-add" onClick={(e) => onCreate({ date, time: fromMinutes(r.g.from), duration: Math.min(len, settings.defaultDuration), allDay: false }, e.currentTarget)}>
                    <Plus size={13} /> Free · {humanDuration(len)}
                  </button>
                </li>
              )
            }
            const o = r.o
            const color = colorOf(o.item, colorBy)
            const end = fromMinutes(toMinutes(o.time) + o.duration)
            const past = isToday && toMinutes(o.time) + o.duration < now
            return (
              <li key={o.key} className={`tl-item${past ? ' is-past' : ''}${o.ghost ? ' is-ghost' : ''}`}>
                <span className="tl-time tabular">
                  {formatTime(o.time, h12)}
                  <span className="tl-end">{formatTime(end, h12)}</span>
                </span>
                <span className="tl-rail">
                  <Pill o={o} color={color} onToggle={onToggle} height={pillHeight(o.duration)} />
                </span>
                <button type="button" className="tl-body" aria-label={blockLabel(o, h12)} onClick={(e) => onOpen(o, e.currentTarget)}>
                  <span className={`tl-title${o.item.kind === 'task' && !isOpen(o.item.status) ? ' is-done' : ''}`}>{o.item.label || o.item.title}</span>
                  <span className="tl-meta">
                    {humanDuration(o.duration)}
                    {o.item.source?.name ? ` · ${o.item.source.name}` : ''}
                    {o.item.location ? ` · ${o.item.location}` : ''}
                  </span>
                </button>
              </li>
            )
          })}
          {!timed.length && !untimed.length && (
            <li className="tl-empty">
              <span>Nothing planned.</span>
              <button type="button" className="tl-gap-add" onClick={(e) => onCreate({ date, time: fromMinutes(Math.max(dayStart * 60, Math.ceil(now / 30) * 30)), duration: settings.defaultDuration, allDay: false }, e.currentTarget)}>
                <Plus size={13} /> Add something
              </button>
            </li>
          )}
        </ol>
      </div>
    </div>
  )
}
