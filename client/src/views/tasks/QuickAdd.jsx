// "Call Sam tomorrow 3pm !high" — typed words become a dated task. Recognised
// phrases show as chips; removing one keeps those words in the title.
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, Flag, Plus, Repeat } from 'lucide-react'
import { parseQuickAdd } from '../../../../shared/quickadd.js'
import { relativeDay, formatTime, humanDuration, todayIso } from '../../../../shared/dates.js'
import { describeRecurrence } from '../../../../shared/recurrence.js'
import { usePrefs } from '../../store/prefs.js'

const PRIORITY_LABEL = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' }

export const QuickAdd = forwardRef(function QuickAdd({ onAdd, placeholder = 'Add a task', hint }, ref) {
  const [text, setText] = useState('')
  const [ignore, setIgnore] = useState([])
  const inputRef = useRef(null)
  const prefs = usePrefs()
  const h12 = prefs.timeFormat === '12h'
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }))

  const parsed = useMemo(() => parseQuickAdd(text, { today: todayIso(), ignore }), [text, ignore])
  const chips = parsed.found.map((f) => {
    switch (f.kind) {
      case 'date':
        return { ...f, icon: CalendarDays, label: relativeDay(f.value) }
      case 'time':
        return { ...f, icon: Clock, label: formatTime(f.value, h12) }
      case 'timeRange':
        return { ...f, icon: Clock, label: `${formatTime(f.value.time, h12)} · ${humanDuration(f.value.duration)}` }
      case 'duration':
        return { ...f, icon: Clock, label: humanDuration(f.value) }
      case 'recurrence':
        return { ...f, icon: Repeat, label: describeRecurrence(f.value) }
      default:
        return { ...f, icon: Flag, label: PRIORITY_LABEL[f.value] }
    }
  })

  const submit = () => {
    if (!parsed.title.trim()) return
    const fields = { title: parsed.title }
    for (const k of ['date', 'time', 'duration', 'priority', 'recurrence']) if (parsed[k]) fields[k] = parsed[k]
    onAdd(fields)
    setText('')
    setIgnore([])
  }

  return (
    <div className={`quick-add${text ? ' has-text' : ''}`}>
      <Plus size={16} className="quick-add-plus" aria-hidden="true" />
      <input
        ref={inputRef}
        className="quick-add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            setText('')
            setIgnore([])
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        aria-label="New task"
        aria-describedby="quick-add-hint"
      />
      {chips.length > 0 && (
        <div className="quick-add-chips">
          {chips.map((c) => (
            <button key={c.kind} type="button" className="qa-chip" title={`“${c.text}” — click to keep as text`} onClick={() => setIgnore([...ignore, c.text.toLowerCase()])}>
              <c.icon size={12} />
              {c.label}
              <span className="qa-chip-x" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
        </div>
      )}
      <span id="quick-add-hint" className="sr-only">
        {hint || 'Type a task. Dates, times, durations, repeats and priority like “tomorrow 3pm for 1h !high” are understood. Press Enter to add.'}
      </span>
    </div>
  )
})
