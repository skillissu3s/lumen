// Making or changing a calendar item: title (typed in plain words for new
// ones), event or task, when, repeat, colour, place and notes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, MapPin, Repeat, Trash2 } from 'lucide-react'
import { Button, ColorPicker, DateField, DurationField, Popover, Segmented, Select, Switch, Textarea, TimeField } from '../../components/ui/index.js'
import { parseQuickAdd } from '../../../../shared/quickadd.js'
import { joinIcon, splitIcon } from '../../../../shared/items.js'
import { fromMinutes, formatTime, humanDuration, relativeDay, todayIso, toMinutes } from '../../../../shared/dates.js'
import { describeRecurrence } from '../../../../shared/recurrence.js'
import { RepeatField } from '../shared/RepeatField.jsx'

/**
 * `value`: { kind: 'event'|'task', path, title, icon, date, endDate, time, duration,
 * recurrence, color, location, notes, priority } — `isNew` shows the type switch.
 * onSave(fields, { kind, path }) · onDelete()
 */
export function EventEditor({ open, onClose, anchor, value, isNew, calendars, lists, h12, onSave, onDelete, defaultDuration = 30 }) {
  const [f, setF] = useState(value)
  const titleRef = useRef(null)
  useEffect(() => {
    if (open) {
      const { icon, label } = splitIcon(value.title || '')
      setF({ ...value, icon: value.icon ?? icon, label })
      setTimeout(() => titleRef.current?.focus(), 30)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value?.key])

  // a new item's title is read for "7am for 1h every mon"
  const parsed = useMemo(() => (isNew && f?.label ? parseQuickAdd(f.label, { today: todayIso() }) : null), [isNew, f?.label])
  if (!open || !f) return null
  // what was typed in the title wins over the fields, until a field is changed by hand
  const typed = {}
  for (const p of parsed?.found || []) {
    if (p.kind === 'timeRange') Object.assign(typed, { time: p.value.time, duration: p.value.duration })
    else if (p.kind !== 'priority' || f.kind === 'task') typed[p.kind] = p.value
  }
  const set = (patch) => {
    // changing a field by hand takes the words that set it out of the title
    const drop = (parsed?.found || []).filter((p) => Object.keys(patch).some((k) => k === p.kind || (p.kind === 'timeRange' && (k === 'time' || k === 'duration'))))
    setF((x) => {
      if (!drop.length) return { ...x, ...patch }
      let label = x.label
      for (const p of drop) label = label.replace(p.text, ' ')
      return { ...x, ...typed, ...patch, label: label.replace(/\s+/g, ' ').trim() }
    })
  }
  const v = { ...f, ...typed }
  const targets = f.kind === 'event' ? calendars : lists
  const allDay = !v.time

  const result = () => {
    const out = { ...f }
    if (parsed?.found.length) {
      out.label = parsed.title
      for (const k of ['date', 'time', 'duration', 'priority', 'recurrence']) if (parsed[k]) out[k] = parsed[k]
    }
    out.title = joinIcon(out.icon, (out.label || '').trim())
    return out
  }
  const save = (e) => {
    e?.preventDefault()
    const r = result()
    if (!r.label?.trim()) return
    const fields = {
      title: r.title,
      date: r.date || null,
      endDate: r.endDate && r.endDate > r.date ? r.endDate : null,
      time: r.time || null,
      duration: r.time ? r.duration || defaultDuration : null,
      recurrence: r.recurrence || null,
      color: r.color || null,
      location: r.kind === 'event' ? r.location?.trim() || null : undefined,
      notes: r.notes ?? '',
      priority: r.kind === 'task' ? r.priority || null : undefined,
    }
    onSave(fields, { kind: r.kind, path: r.path })
  }

  const preview = parsed?.found.length ? parsed : null
  const endTime = v.time ? fromMinutes(toMinutes(v.time) + (v.duration || defaultDuration)) : null

  return (
    <Popover open={open} onOpenChange={(o) => !o && onClose()} anchor={anchor} placement="right-start" className="editor" aria-label={isNew ? 'New item' : 'Edit item'}>
      <form onSubmit={save} className="editor-form" onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save(e)}>
        <div className="editor-title-row">
          <input
            ref={titleRef}
            className="editor-title"
            value={f.label || ''}
            placeholder={isNew ? 'Title — try “Gym 7am for 1h every mon”' : 'Title'}
            aria-label="Title"
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
        {preview && (
          <div className="editor-preview" aria-live="polite">
            {preview.found.map((p) => (
              <span key={p.kind}>
                {p.kind === 'date' ? <CalendarDays size={12} /> : p.kind === 'recurrence' ? <Repeat size={12} /> : <Clock size={12} />}
                {p.kind === 'date' ? relativeDay(p.value) : p.kind === 'recurrence' ? describeRecurrence(p.value) : p.kind === 'duration' ? humanDuration(p.value) : p.kind === 'timeRange' ? `${formatTime(p.value.time, h12)} · ${humanDuration(p.value.duration)}` : p.kind === 'time' ? formatTime(p.value, h12) : p.value}
              </span>
            ))}
          </div>
        )}

        {isNew && (
          <Segmented
            label="Type"
            value={f.kind}
            onChange={(kind) => set({ kind, path: (kind === 'event' ? calendars : lists)[0]?.path })}
            options={[
              { value: 'event', label: 'Event' },
              { value: 'task', label: 'Task' },
            ]}
          />
        )}

        <div className="editor-grid">
          <span className="editor-label">{f.kind === 'event' ? 'Calendar' : 'List'}</span>
          <Select value={f.path} onChange={(e) => set({ path: e.target.value })} options={targets.map((t) => ({ value: t.path, label: t.name }))} aria-label={f.kind === 'event' ? 'Calendar' : 'List'} disabled={!isNew && f.series} />

          <span className="editor-label">Date</span>
          <div className="editor-inline">
            <DateField value={v.date} onChange={(d) => set({ date: d })} />
            <Switch checked={allDay} onChange={(on) => set(on ? { time: null } : { time: '09:00', duration: v.duration || defaultDuration })} label="All day" />
          </div>

          {!allDay && (
            <>
              <span className="editor-label">Time</span>
              <div className="editor-inline">
                <TimeField value={v.time} h12={h12} onChange={(t) => t && set({ time: t })} />
                <span className="faint">to</span>
                <TimeField
                  value={endTime}
                  h12={h12}
                  onChange={(t) => {
                    if (!t) return
                    const d = toMinutes(t) - toMinutes(v.time)
                    set({ duration: d > 0 ? d : d + 1440 })
                  }}
                />
                <DurationField value={v.duration || defaultDuration} onChange={(d) => d && set({ duration: d })} />
              </div>
            </>
          )}
          {allDay && f.kind === 'event' && (
            <>
              <span className="editor-label">Until</span>
              <DateField value={f.endDate || null} onChange={(v) => set({ endDate: v })} placeholder="One day" clearable />
            </>
          )}

          <span className="editor-label">Repeat</span>
          <RepeatField value={v.recurrence || null} date={v.date} onChange={(r) => set({ recurrence: r })} />

          {f.kind === 'task' && (
            <>
              <span className="editor-label">Priority</span>
              <Segmented
                label="Priority"
                value={f.priority || ''}
                onChange={(v) => set({ priority: v || null })}
                options={[
                  { value: '', label: 'None' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Med' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </>
          )}

          {f.kind === 'event' && (
            <>
              <span className="editor-label">Place</span>
              <div className="editor-place">
                <MapPin size={14} className="faint" />
                <input value={f.location || ''} onChange={(e) => set({ location: e.target.value })} placeholder="Add a place" aria-label="Place" />
              </div>
            </>
          )}

          <span className="editor-label">Colour</span>
          <div className="editor-inline">
            <ColorPicker value={f.color || null} onChange={(c) => set({ color: c === f.color ? null : c })} />
            {f.color && (
              <button type="button" className="editor-reset" onClick={() => set({ color: null })}>
                Use {f.kind === 'event' ? 'calendar' : 'list'} colour
              </button>
            )}
          </div>
        </div>

        <Textarea value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes" aria-label="Notes" autoSize className="editor-notes" />

        <div className="editor-actions">
          {!isNew && (
            <Button type="button" variant="ghost" icon={Trash2} onClick={onDelete} className="editor-delete">
              Delete
            </Button>
          )}
          <span className="editor-hint faint">Ctrl Enter</span>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!f.label?.trim()}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </form>
    </Popover>
  )
}
