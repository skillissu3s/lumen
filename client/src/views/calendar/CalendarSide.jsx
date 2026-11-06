// The calendar's panel, on the right: a small month to jump with, the day you
// are on at a glance, which calendars and boards show (a coloured square per
// source, filled when it shows), and tasks still waiting for a day. Each
// section folds away, and remembers it on this device. In your candle the
// calendars come in groups, one per space (yours, each workspace, each person
// sharing with you), and a whole space can be shown or hidden at once.
import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Eye as EyeIcon, EyeOff, MoreHorizontal, Plus } from 'lucide-react'
import { Menu, MiniMonth } from '../../components/ui/index.js'
import { formatTime, relativeDay } from '../../../../shared/dates.js'
import { expand } from '../../../../shared/calendar.js'
import { isOpen, itemDay } from '../../../../shared/items.js'
import { colorOf, titleOf } from './calendarMath.js'

const FOLDED = 'lumen.cal.folded'
function readFolded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDED) || '[]'))
  } catch {
    return new Set()
  }
}

function Section({ id, title, count, folded, onFold, action, children }) {
  const open = !folded.has(id)
  return (
    <section className={`cal-side-section${open ? '' : ' is-folded'}`}>
      <div className="cal-side-head">
        <button type="button" className="cal-side-fold" aria-expanded={open} onClick={() => onFold(id)}>
          <ChevronDown size={13} />
          <span>{title}</span>
          {count != null && <span className="cal-side-count">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="cal-side-body">{children}</div>}
    </section>
  )
}

// one source that can be shown or hidden: a colour dot, and an eye that says
// which (always there while hidden, on hover otherwise)
function Source({ id, name, color, on, note, onToggle, menu }) {
  const Eye = on ? EyeIcon : EyeOff
  return (
    <div id={id} className={`cal-src${on ? '' : ' is-hidden'}`}>
      <button type="button" aria-pressed={on} aria-label={`${on ? 'Hide' : 'Show'} ${name}`} className="cal-src-toggle" style={{ '--sc': `var(--c-${color})` }} onClick={onToggle}>
        <span className="cal-src-dot" aria-hidden="true" />
        <span className="cal-src-name">{name}</span>
        {note && <span className="cal-src-note">{note}</span>}
        <Eye size={14} className="cal-src-eye" aria-hidden="true" />
      </button>
      {menu && <Menu align="end" items={menu} trigger={<button type="button" className="cal-src-more" aria-label={`${name} options`}><MoreHorizontal size={14} /></button>} />}
    </div>
  )
}

// a space's heading among the calendars, with its own show/hide (not for your candle)
function SpaceHead({ label, on, onToggle }) {
  const Eye = on ? EyeIcon : EyeOff
  if (!onToggle) return <div className="cal-src-group-head">{label}</div>
  return (
    <button type="button" className={`cal-src-group-head is-toggle${on ? '' : ' is-hidden'}`} aria-pressed={on} aria-label={`${on ? 'Hide' : 'Show'} ${label}`} onClick={onToggle}>
      <span>{label}</span>
      <Eye size={13} aria-hidden="true" />
    </button>
  )
}

export function CalendarSide({ date, today, weekStart, marks, items, settings, calendars, lists, groups, where = {}, hidden, defaultCal, calMenu, inbox, onPick, onOpen, onNew, onNewCalendar, onToggleHidden, onToggleSpace }) {
  const [folded, setFolded] = useState(readFolded)
  const newRef = useRef(null)
  const fold = (id) =>
    setFolded((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      try {
        localStorage.setItem(FOLDED, JSON.stringify([...n]))
      } catch {
        /* fine */
      }
      return n
    })
  // the day's items: all-day ones first, then by time
  const day = useMemo(
    () =>
      expand(items, date, date, { defaultDuration: settings.defaultDuration, showDone: settings.showCompleted })
        .filter((o) => !o.ghost)
        .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || (a.time || '').localeCompare(b.time || '')),
    [items, date, settings.defaultDuration, settings.showCompleted],
  )
  const dayName = relativeDay(date)

  return (
    <aside className="cal-side" aria-label="Calendar panel">
      <MiniMonth value={date} onChange={onPick} weekStart={weekStart} marks={marks} today={today} />

      <Section
        id="day"
        title={dayName}
        count={day.length || null}
        folded={folded}
        onFold={fold}
        action={
          <button type="button" className="cal-side-add" aria-label={`New event on ${dayName}`} onClick={(e) => onNew(date, e.currentTarget)}>
            <Plus size={14} />
          </button>
        }
      >
        {day.length ? (
          <ul className="cal-day">
            {day.map((o) => (
              <li key={o.key}>
                <button type="button" className={`cal-day-item${o.item.kind === 'task' && !isOpen(o.item.status) ? ' is-done' : ''}`} style={{ '--ec': `var(--c-${colorOf(o.item, settings.colorBy)})` }} onClick={(e) => onOpen(o, e.currentTarget)}>
                  <span className="cal-day-time tabular">{o.allDay ? 'All day' : formatTime(o.time, settings.h12)}</span>
                  <span className="cal-day-title">{titleOf(o.item)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cal-side-hint">Nothing planned{date === today ? ' today' : ''}.</p>
        )}
      </Section>

      <Section
        id="calendars"
        title="Calendars"
        folded={folded}
        onFold={fold}
        action={
          <button ref={newRef} type="button" className="cal-side-add" aria-label="New calendar" onClick={() => onNewCalendar(newRef.current)}>
            <Plus size={14} />
          </button>
        }
      >
        {(groups || [{ prefix: '', on: true, calendars }]).map((g) => (
          <div key={g.prefix || 'here'} className="cal-src-group">
            {groups && groups.length > 1 && <SpaceHead label={g.label} on={g.on} onToggle={g.prefix ? () => onToggleSpace(g.prefix) : null} />}
            {g.on &&
              g.calendars.map((cal) => (
                <Source key={cal.path} id={`cal-${cal.id}`} name={cal.name} color={cal.color || 'blue'} on={!hidden.has(cal.path)} note={calendars.length > 1 && defaultCal?.path === cal.path ? 'Default' : null} onToggle={() => onToggleHidden(cal.path)} menu={calMenu(cal)} />
              ))}
          </div>
        ))}
        <p className="cal-side-hint">{calendars.length > 1 ? 'Each event belongs to one calendar; pick it when you add the event. Hide a calendar to see the rest.' : 'One calendar is enough. Add another to keep, say, work and personal apart, each with its own colour.'}</p>
      </Section>

      {settings.showTasks && lists.length > 0 && (
        <Section id="boards" title="Tasks from boards" folded={folded} onFold={fold}>
          {lists.map((l) => (
            <Source key={l.path} name={where[l.space] ? `${l.name} · ${where[l.space]}` : l.name} color={l.color || 'gray'} on={!hidden.has(l.path)} onToggle={() => onToggleHidden(l.path)} />
          ))}
        </Section>
      )}

      <Section id="inbox" title="To schedule" count={inbox.length || null} folded={folded} onFold={fold}>
        {inbox.length ? (
          <>
            <p className="cal-side-hint">Drag one onto the calendar to give it a time.</p>
            {inbox.slice(0, 40).map((i) => (
              <div
                key={`${i.path}#${i.id}`}
                className="cal-inbox-item"
                draggable
                style={{ '--ec': `var(--c-${i.source.color || 'gray'})` }}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-lumen-item', JSON.stringify({ path: i.path, id: i.id }))
                  e.dataTransfer.effectAllowed = 'move'
                }}
              >
                <span className="cal-inbox-title">{titleOf(i)}</span>
                {itemDay(i) && <span className="cal-inbox-late">{relativeDay(itemDay(i))}</span>}
              </div>
            ))}
          </>
        ) : (
          <p className="cal-side-hint">Everything has a day.</p>
        )}
      </Section>
    </aside>
  )
}
