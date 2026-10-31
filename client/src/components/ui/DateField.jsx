import { useEffect, useRef, useState } from 'react'
import { Calendar, Search, X } from 'lucide-react'
import { addDays, relativeDay, todayIso, weekStartOf } from '../../../../shared/dates.js'
import { parseQuickAdd } from '../../../../shared/quickadd.js'
import { Input } from './FormControls.jsx'
import { Popover } from './Popover.jsx'
import { MiniMonth } from './MiniMonth.jsx'

export function DateField({
  value = null,
  onChange,
  placeholder = 'Set date',
  clearable = false,
  className = '',
  ...props
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const triggerRef = useRef(null)
  const today = todayIso()

  useEffect(() => {
    if (open) setText('')
  }, [open])

  const quick = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'Next week', value: weekStartOf(addDays(today, 7), 1) },
    { label: 'No date', value: null },
  ]

  function choose(next) {
    onChange?.(next)
    setOpen(false)
  }

  function commitTyped() {
    const parsed = parseQuickAdd(text, { today })
    if (parsed.date) choose(parsed.date)
  }

  return (
    <div className={`ui-date-field ${className}`.trim()} {...props}>
      <button
        ref={triggerRef}
        type="button"
        className={`ui-date-field-trigger ${clearable && value ? 'has-clear' : ''}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ui-date-field-icon">
          <Calendar size={15} strokeWidth={1.75} aria-hidden="true" />
        </span>
        {value ? (
          <span className="ui-date-field-value">{relativeDay(value, today)}</span>
        ) : (
          <span className="ui-date-field-placeholder">{placeholder}</span>
        )}
      </button>
      {clearable && value ? (
        <button
          type="button"
          className="ui-date-field-clear"
          aria-label="Clear date"
          title="Clear date"
          onClick={() => onChange?.(null)}
        >
          <X size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={triggerRef}
        placement="bottom-start"
        className="ui-date-popover"
        role="dialog"
        aria-label="Choose a date"
      >
        <div className="ui-date-search">
          <Input
            size="sm"
            icon={Search}
            placeholder="Type a date, e.g. tomorrow"
            aria-label="Type a date"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTyped()
              }
            }}
          />
        </div>
        <div className="ui-date-quick">
          {quick.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`ui-date-quick-button ${value === item.value ? 'is-active' : ''}`.trim()}
              onClick={() => choose(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="ui-date-sep" />
        <MiniMonth value={value || today} onChange={choose} today={today} />
      </Popover>
    </div>
  )
}
