import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DAY_NAMES,
  addDays,
  addMonths,
  monthGrid,
  monthName,
  relativeDay,
  todayIso,
  weekStartOf,
} from '../../../../shared/dates.js'
import { IconButton } from './IconButton.jsx'

export function MiniMonth({
  value,
  onChange,
  weekStart = 1,
  marks,
  today = todayIso(),
  className = '',
  ...props
}) {
  const [view, setView] = useState(() => `${(value || today).slice(0, 7)}-01`)
  const [focused, setFocused] = useState(value || today)
  const refs = useRef({})
  const pending = useRef(null)

  useEffect(() => {
    if (!value) return
    setFocused(value)
    setView(`${value.slice(0, 7)}-01`)
  }, [value])

  const days = monthGrid(view, weekStart)
  const rows = []
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7))
  const activeFocus = days.includes(focused) ? focused : view
  const weekdays = Array.from({ length: 7 }, (_, i) => DAY_NAMES[(weekStart + i) % 7])

  useLayoutEffect(() => {
    if (!pending.current) return
    refs.current[pending.current]?.focus()
    pending.current = null
  }, [view, focused])

  function go(next) {
    pending.current = next
    setFocused(next)
    if (next.slice(0, 7) !== view.slice(0, 7)) setView(`${next.slice(0, 7)}-01`)
  }

  function onKeyDown(event) {
    const current = event.target.dataset?.day || focused
    let next = null
    if (event.key === 'ArrowLeft') next = addDays(current, -1)
    else if (event.key === 'ArrowRight') next = addDays(current, 1)
    else if (event.key === 'ArrowUp') next = addDays(current, -7)
    else if (event.key === 'ArrowDown') next = addDays(current, 7)
    else if (event.key === 'PageUp') next = addMonths(current, -1)
    else if (event.key === 'PageDown') next = addMonths(current, 1)
    else if (event.key === 'Home') next = weekStartOf(current, weekStart)
    else if (event.key === 'End') next = addDays(weekStartOf(current, weekStart), 6)
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChange?.(current)
      return
    }

    if (next) {
      event.preventDefault()
      go(next)
    }
  }

  function changeMonth(delta) {
    const next = addMonths(view, delta)
    setView(next)
    setFocused(next)
  }

  return (
    <div className={`ui-mini-month ${className}`.trim()} {...props}>
      <div className="ui-mini-month-head">
        <div className="ui-mini-month-title" aria-live="polite">
          {monthName(view)} {view.slice(0, 4)}
        </div>
        <div className="ui-mini-month-nav">
          <IconButton icon={ChevronLeft} label="Previous month" size="sm" onClick={() => changeMonth(-1)} />
          <IconButton icon={ChevronRight} label="Next month" size="sm" onClick={() => changeMonth(1)} />
        </div>
      </div>
      <div
        className="ui-mini-month-grid"
        role="grid"
        aria-label={`${monthName(view)} ${view.slice(0, 4)}`}
        onKeyDown={onKeyDown}
      >
        <div className="ui-mini-month-row" role="row">
          {weekdays.map((name) => (
            <div key={name} className="ui-mini-month-weekday" role="columnheader">
              {name.slice(0, 3)}
            </div>
          ))}
        </div>
        {rows.map((week) => (
          <div key={week[0]} className="ui-mini-month-row" role="row">
            {week.map((day) => {
              const outside = day.slice(0, 7) !== view.slice(0, 7)
              const selected = day === value
              const isToday = day === today
              return (
                <button
                  key={day}
                  ref={(node) => {
                    if (node) refs.current[day] = node
                  }}
                  type="button"
                  role="gridcell"
                  data-day={day}
                  aria-selected={selected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={relativeDay(day, today)}
                  tabIndex={day === activeFocus ? 0 : -1}
                  className={[
                    'ui-mini-month-day',
                    outside ? 'is-outside' : '',
                    selected ? 'is-selected' : '',
                    isToday ? 'is-today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onChange?.(day)}
                >
                  {+day.slice(8, 10)}
                  {marks?.has?.(day) ? <span className="ui-mini-month-dot" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
