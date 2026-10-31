// Day, 3-day and week views: hours down the side, a column per day. Drag on
// empty space to create, drag a block to move it, drag its bottom edge to
// resize; everything also works from the keyboard.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Repeat } from 'lucide-react'
import { addDays, dayName, dayOfMonth, formatTime, fromMinutes, isoWeek, nowMinutes, todayIso, toMinutes, humanDuration } from '../../../../shared/dates.js'
import { layoutDay } from '../../../../shared/calendar.js'
import { isOpen } from '../../../../shared/items.js'
import { colorOf, dragRange, minutesToY, xToColumn, titleOf, yToMinutes } from './calendarMath.js'

const HOURS = (from, to) => Array.from({ length: to - from }, (_, i) => from + i)

// side by side while each block still has room for a few words; in a narrow
// column, overlapping blocks stack like cards instead, each a little to the right
function placeBlock(o, colWidth) {
  if (o.cols === 1) return { left: 4, right: 6 }
  if (colWidth / o.cols >= 72) return { left: `calc(${(o.col / o.cols) * 100}% + 4px)`, width: `calc(${100 / o.cols}% - 7px)` }
  const step = Math.min(14, (colWidth - 48) / (o.cols - 1))
  return { left: 4 + o.col * step, right: 6, zIndex: 2 + o.col }
}

export function blockLabel(o, h12) {
  const t = o.allDay ? 'all day' : `${formatTime(o.time, h12)} to ${formatTime(fromMinutes(toMinutes(o.time) + (o.duration || 0)), h12)}`
  return `${titleOf(o.item)}, ${t}, ${dayName(o.date)} ${dayOfMonth(o.date)}${o.item.recurrence ? ', repeats' : ''}${o.item.kind === 'task' ? (isOpen(o.item.status) ? ', task' : ', done') : ''}`
}

function Block({ o, style, color, h12, compact, onPointerDown, onOpen, onKey, onToggle, dragging }) {
  const done = o.item.kind === 'task' && !isOpen(o.item.status)
  return (
    <div
      role="button"
      tabIndex={0}
      data-key={o.key}
      aria-label={blockLabel(o, h12)}
      className={`block${compact ? ' is-compact' : ''}${done ? ' is-done' : ''}${o.ghost ? ' is-ghost' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{ ...style, '--c': `var(--c-${color})`, '--c-bg': `var(--c-${color}-bg)`, '--c-fg': `var(--c-${color}-fg)` }}
      onPointerDown={onPointerDown}
      onKeyDown={onKey}
      onClick={(e) => e.detail === 0 && onOpen(o, e.currentTarget)}
    >
      <div className="block-inner">
        <span className="block-title">
          {o.item.kind === 'task' && !o.ghost && (
            <button
              type="button"
              className="block-check"
              aria-label={done ? 'Mark as open' : 'Complete'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onToggle(o)
              }}
            >
              {done && <Check size={9} strokeWidth={3} />}
            </button>
          )}
          <span className="block-label">{titleOf(o.item)}</span>
        </span>
        {!compact && (
          <span className="block-time">
            {formatTime(o.time, h12)} – {formatTime(fromMinutes(toMinutes(o.time) + o.duration), h12)}
            {o.item.recurrence && <Repeat size={10} />}
          </span>
        )}
        {!compact && o.item.location && <span className="block-time">{o.item.location}</span>}
      </div>
      {!o.ghost && <div className="block-resize" data-resize aria-hidden="true" />}
    </div>
  )
}

/**
 * days: iso dates · occs: expanded occurrences · settings: prefs.calendar (+ h12, weekStart)
 * onCreate({ date, time, duration, allDay }, anchor) · onOpen(occ, anchor) · onMove(occ, { date, time, duration }) · onToggle(occ) · onDropItem({path,id}, date, time)
 */
export function TimeGrid({ days, occs, settings, h12, onCreate, onOpen, onMove, onToggle, onDropItem, onDay, draft, announce }) {
  const { dayStart, dayEnd, snap, colorBy, workStart, workEnd, highlightWork, showWeekNumbers } = settings
  const scrollRef = useRef(null)
  const colsRef = useRef(null)
  // the hours stretch to fill the window when the chosen height would leave space below
  const [box, setBox] = useState({ height: 0, colWidth: 200 })
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setBox({ height: el.clientHeight - 24, colWidth: (colsRef.current?.clientWidth || el.clientWidth) / days.length })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [days.length])
  const hourHeight = Math.max(settings.hourHeight, Math.floor(box.height / (dayEnd - dayStart)) || 0)
  const [drag, setDrag] = useState(null) // { type, occ?, day, start, end, startY, moved }
  const [now, setNow] = useState(nowMinutes())
  const [cursor, setCursor] = useState(null) // keyboard slot { day, min }
  const [hover, setHover] = useState(null) // the empty slot under the pointer { day, min }
  const today = todayIso()
  const geo = { hourHeight, dayStart, snap }
  const height = (dayEnd - dayStart) * hourHeight

  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 60000)
    return () => clearInterval(t)
  }, [])
  // start scrolled to a little before now (or the working day)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = days.includes(today) ? now - 90 : (workStart || 8) * 60 - 30
    el.scrollTop = Math.max(0, minutesToY(target, geo))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(), hourHeight])

  const byDay = useMemo(() => {
    const map = new Map(days.map((d) => [d, []]))
    for (const o of occs) if (!o.allDay && map.has(o.date)) map.get(o.date).push(o)
    return new Map([...map].map(([d, list]) => [d, layoutDay(list, { minHeight: 15 })]))
  }, [days, occs])

  const allDay = useMemo(() => {
    const rows = []
    const items = occs.filter((o) => o.allDay && o.endDate >= days[0] && o.date <= days[days.length - 1])
    items.sort((a, b) => a.date.localeCompare(b.date) || b.endDate.localeCompare(a.endDate))
    for (const o of items) {
      const from = Math.max(0, days.indexOf(o.date) < 0 ? 0 : days.indexOf(o.date))
      const lastIdx = days.indexOf(o.endDate)
      const to = lastIdx < 0 ? days.length - 1 : lastIdx
      let row = rows.findIndex((r) => r.every((x) => x.to < from || x.from > to))
      if (row < 0) row = rows.push([]) - 1
      rows[row].push({ o, from, to })
    }
    return rows
  }, [occs, days])

  const pointAt = (e) => {
    const rect = colsRef.current.getBoundingClientRect()
    const col = xToColumn(e.clientX - rect.left, rect.width, days.length)
    const min = yToMinutes(e.clientY - rect.top, geo)
    return { day: days[col], min }
  }

  // ---- pointer: create / move / resize ----
  const onGridPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('.block')) return
    const p = pointAt(e)
    setDrag({ type: 'create', day: p.day, start: p.min, end: p.min + snap, startY: e.clientY, moved: false })
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onBlockPointerDown = (o) => (e) => {
    if (e.button !== 0 || o.ghost) return
    e.stopPropagation()
    const resize = !!e.target.closest('[data-resize]')
    const p = pointAt(e)
    const start = toMinutes(o.time)
    setDrag({ type: resize ? 'resize' : 'move', occ: o, day: o.date, start, end: start + o.duration, grab: p.min - start, startY: e.clientY, moved: false, el: e.currentTarget })
    colsRef.current.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag) {
      // over empty space: show where a click would make something
      const empty = !e.target.closest('.block') && e.pointerType === 'mouse'
      const p = empty ? pointAt(e) : null
      const at = p && { day: p.day, min: Math.floor(p.min / snap) * snap }
      setHover((h) => (h?.day === at?.day && h?.min === at?.min ? h : at))
      return
    }
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < 4 && drag.type !== 'create') return
    const p = pointAt(e)
    setDrag((d) => {
      if (!d) return d
      if (d.type === 'create') return { ...d, end: p.min, moved: true }
      if (d.type === 'resize') return { ...d, end: Math.max(d.start + snap, p.min), moved: true }
      const len = d.end - d.start
      const start = Math.max(0, Math.min(1440 - len, p.min - d.grab))
      return { ...d, day: p.day, start, end: start + len, moved: true }
    })
  }
  const onPointerUp = (e) => {
    if (!drag) return
    const d = drag
    setDrag(null)
    if (d.type === 'create') {
      const r = dragRange(d.day, d.start, d.moved ? d.end : d.start + settings.defaultDuration, snap)
      onCreate({ date: r.date, time: fromMinutes(r.startMin), duration: r.duration, allDay: false }, { x: e.clientX, y: e.clientY })
      return
    }
    if (!d.moved) return onOpen(d.occ, d.el)
    onMove(d.occ, { date: d.day, time: fromMinutes(d.start), duration: d.end - d.start })
  }

  // ---- keyboard on a block ----
  const onBlockKey = (o) => (e) => {
    const start = toMinutes(o.time)
    const move = (patch, msg) => {
      e.preventDefault()
      onMove(o, { date: o.date, time: o.time, duration: o.duration, ...patch })
      announce?.(msg)
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      return onOpen(o, e.currentTarget)
    }
    if (e.key === ' ' && o.item.kind === 'task') {
      e.preventDefault()
      return onToggle(o)
    }
    if (!e.altKey) return
    if (e.shiftKey && e.key === 'ArrowDown') return move({ duration: o.duration + snap }, `${humanDuration(o.duration + snap)} long`)
    if (e.shiftKey && e.key === 'ArrowUp') return move({ duration: Math.max(snap, o.duration - snap) }, `${humanDuration(Math.max(snap, o.duration - snap))} long`)
    if (e.key === 'ArrowDown') return move({ time: fromMinutes(Math.min(1440 - o.duration, start + snap)) }, `Moved to ${formatTime(fromMinutes(start + snap), h12)}`)
    if (e.key === 'ArrowUp') return move({ time: fromMinutes(Math.max(0, start - snap)) }, `Moved to ${formatTime(fromMinutes(start - snap), h12)}`)
    if (e.key === 'ArrowRight') return move({ date: addDays(o.date, 1) }, `Moved to ${dayName(addDays(o.date, 1))}`)
    if (e.key === 'ArrowLeft') return move({ date: addDays(o.date, -1) }, `Moved to ${dayName(addDays(o.date, -1))}`)
  }

  // ---- keyboard on the grid: a slot cursor ----
  const onGridKey = (e) => {
    if (e.target !== e.currentTarget) return
    const c = cursor || { day: days.includes(today) ? today : days[0], min: Math.ceil(now / snap) * snap }
    const idx = days.indexOf(c.day)
    let next = c
    if (e.key === 'ArrowDown') next = { ...c, min: Math.min(1440 - snap, c.min + snap) }
    else if (e.key === 'ArrowUp') next = { ...c, min: Math.max(0, c.min - snap) }
    else if (e.key === 'ArrowRight' && idx < days.length - 1) next = { ...c, day: days[idx + 1] }
    else if (e.key === 'ArrowLeft' && idx > 0) next = { ...c, day: days[idx - 1] }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const rect = colsRef.current.getBoundingClientRect()
      return onCreate({ date: c.day, time: fromMinutes(c.min), duration: settings.defaultDuration, allDay: false }, { x: rect.left + (idx + 0.5) * (rect.width / days.length), y: rect.top + minutesToY(c.min, geo) })
    } else return
    e.preventDefault()
    setCursor(next)
    announce?.(`${dayName(next.day)} ${formatTime(fromMinutes(next.min), h12)}`)
  }

  // ---- dropping a task from the inbox ----
  const onDragOver = (e) => {
    if (!e.dataTransfer.types.includes('application/x-lumen-item')) return
    e.preventDefault()
    const p = pointAt(e)
    setCursor({ day: p.day, min: p.min, drop: true })
  }
  const onDrop = (e) => {
    const raw = e.dataTransfer.getData('application/x-lumen-item')
    setCursor(null)
    if (!raw) return
    e.preventDefault()
    const p = pointAt(e)
    onDropItem(JSON.parse(raw), p.day, fromMinutes(p.min))
  }

  const preview =
    drag && drag.moved
      ? drag.type === 'create'
        ? { day: drag.day, start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end, Math.min(drag.start, drag.end) + snap) }
        : { day: drag.day, start: drag.start, end: drag.end, occ: drag.occ }
      : null

  const cols = days.length
  return (
    <div className="tgrid" style={{ '--cols': cols, '--hour': `${hourHeight}px` }}>
      <div className="tgrid-head">
        <div className="tgrid-gutter">{showWeekNumbers && <span className="weeknum">W{isoWeek(days[0])}</span>}</div>
        {days.map((d) => (
          <button key={d} type="button" className={`tgrid-day${d === today ? ' is-today' : ''}${d < today ? ' is-past' : ''}`} onClick={() => onDay?.(d)} disabled={!onDay || days.length === 1} title={days.length > 1 ? `Open ${dayName(d)}` : undefined}>
            <span className="tgrid-dayname">{dayName(d, true)}</span>
            <span className="tgrid-daynum">{dayOfMonth(d)}</span>
          </button>
        ))}
      </div>
      {allDay.length > 0 && (
        <div className="tgrid-allday">
          <div className="tgrid-gutter tgrid-allday-label">all day</div>
          <div className="tgrid-allday-rows" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {allDay.flatMap((row, ri) =>
              row.map(({ o, from, to }) => {
                const color = colorOf(o.item, colorBy)
                const done = o.item.kind === 'task' && !isOpen(o.item.status)
                return (
                  <button
                    key={o.key}
                    type="button"
                    className={`allday-chip${done ? ' is-done' : ''}${o.ghost ? ' is-ghost' : ''}`}
                    style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: ri + 1, '--c': `var(--c-${color})`, '--c-bg': `var(--c-${color}-bg)`, '--c-fg': `var(--c-${color}-fg)` }}
                    aria-label={blockLabel(o, h12)}
                    onClick={(e) => onOpen(o, e.currentTarget)}
                  >
                    <span className="allday-title">{titleOf(o.item)}</span>
                  </button>
                )
              }),
            )}
          </div>
        </div>
      )}
      <div className="tgrid-scroll" ref={scrollRef}>
        <div className="tgrid-body" style={{ height }}>
          <div className="tgrid-gutter tgrid-hours" aria-hidden="true">
            {days.includes(today) && now >= dayStart * 60 && now <= dayEnd * 60 && (
              <span className="now-pill" style={{ top: minutesToY(now, geo) }}>
                {formatTime(fromMinutes(now), h12)}
              </span>
            )}
            {HOURS(dayStart, dayEnd).map((h) => (
              <span key={h} className="tgrid-hour" style={{ top: (h - dayStart) * hourHeight }}>
                {h === dayStart ? '' : formatTime(fromMinutes(h * 60), h12).replace(':00', '')}
              </span>
            ))}
          </div>
          <div
            ref={colsRef}
            className="tgrid-cols"
            role="grid"
            aria-label="Calendar time grid. Use arrow keys to move, Enter to add."
            tabIndex={0}
            onPointerDown={onGridPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onGridKey}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setCursor(null)}
            onDragOver={onDragOver}
            onDragLeave={() => setCursor(null)}
            onDrop={onDrop}
          >
            {days.map((d) => (
              <div key={d} className={`tgrid-col${d === today ? ' is-today' : ''}${d < today ? ' is-past' : ''}`} role="row" aria-label={`${dayName(d)} ${dayOfMonth(d)}`}>
                {d === today && now > dayStart * 60 && <div className="tgrid-past" style={{ height: minutesToY(Math.min(now, dayEnd * 60), geo) }} aria-hidden="true" />}
                {highlightWork && <div className="tgrid-work" style={{ top: minutesToY(workStart * 60, geo), height: (workEnd - workStart) * hourHeight }} />}
                {(byDay.get(d) || []).map((o) => {
                  const hidden = drag?.moved && drag.occ?.key === o.key
                  const top = minutesToY(o.top, geo)
                  const h = (o.height / 60) * hourHeight
                  return (
                    <Block
                      key={o.key}
                      o={o}
                      h12={h12}
                      color={colorOf(o.item, colorBy)}
                      compact={h < 38}
                      dragging={hidden}
                      style={{ top: top + 1, height: Math.max(h - 3, 16), ...placeBlock(o, box.colWidth) }}
                      onPointerDown={onBlockPointerDown(o)}
                      onOpen={onOpen}
                      onKey={onBlockKey(o)}
                      onToggle={onToggle}
                    />
                  )
                })}
                {d === today && now >= dayStart * 60 && now <= dayEnd * 60 && <div className="now-line" style={{ top: minutesToY(now, geo) }} aria-hidden="true" />}
                {hover && hover.day === d && !drag && !draft && (
                  <div className="slot-ghost" style={{ top: minutesToY(hover.min, geo) + 1, height: (settings.defaultDuration / 60) * hourHeight - 3 }} aria-hidden="true">
                    <span>+ {formatTime(fromMinutes(hover.min), h12)}</span>
                  </div>
                )}
                {draft && draft.date === d && draft.time && (
                  <div className="block is-preview is-draft" style={{ top: minutesToY(toMinutes(draft.time), geo) + 1, height: ((draft.duration || settings.defaultDuration) / 60) * hourHeight - 3, left: 4, right: 6 }} aria-hidden="true">
                    <div className="block-inner">
                      <span className="block-title">{titleOf(draft) || 'New'}</span>
                      <span className="block-time">
                        {formatTime(draft.time, h12)} – {formatTime(fromMinutes(toMinutes(draft.time) + (draft.duration || settings.defaultDuration)), h12)}
                      </span>
                    </div>
                  </div>
                )}
                {preview && preview.day === d && (
                  <div className="block is-preview" style={{ top: minutesToY(preview.start, geo), height: ((preview.end - preview.start) / 60) * hourHeight - 3, left: 4, right: 6, '--c': `var(--c-${preview.occ ? colorOf(preview.occ.item, colorBy) : 'gray'})`, '--c-bg': `var(--c-${preview.occ ? colorOf(preview.occ.item, colorBy) : 'gray'}-bg)`, '--c-fg': `var(--c-${preview.occ ? colorOf(preview.occ.item, colorBy) : 'gray'}-fg)` }} aria-hidden="true">
                    <div className="block-inner">
                      <span className="block-title">{preview.occ ? titleOf(preview.occ.item) : 'New'}</span>
                      <span className="block-time">
                        {formatTime(fromMinutes(preview.start), h12)} – {formatTime(fromMinutes(preview.end), h12)}
                      </span>
                    </div>
                  </div>
                )}
                {cursor && cursor.day === d && (
                  <div className={`slot-cursor${cursor.drop ? ' is-drop' : ''}`} style={{ top: minutesToY(cursor.min, geo), height: (snap / 60) * hourHeight }} aria-hidden="true">
                    <span>{formatTime(fromMinutes(cursor.min), h12)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
