import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatTime, fromMinutes } from '../../../../shared/dates.js'

const pad = (n) => String(n).padStart(2, '0')

export function parseTimeInput(text) {
  const raw = String(text || '').trim().toLowerCase().replace(/\s+/g, '')
  if (!raw) return null

  const ap = /(am|pm)$/.exec(raw)?.[1]
  const body = ap ? raw.slice(0, -2) : raw
  let hours
  let minutes

  if (body.includes(':') || body.includes('.')) {
    const [a, b] = body.split(/[:.]/)
    hours = a
    minutes = b
  } else if (/^\d{3,4}$/.test(body)) {
    hours = body.slice(0, -2)
    minutes = body.slice(-2)
  } else if (/^\d{1,2}$/.test(body)) {
    hours = body
    minutes = '0'
  } else {
    return null
  }

  if (!/^\d{1,2}$/.test(hours) || !/^\d{1,2}$/.test(minutes)) return null
  let h = +hours
  const m = +minutes
  if (m > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  } else if (h > 23) {
    return null
  }

  return fromMinutes(h * 60 + m)
}

export function TimeField({
  value = null,
  onChange,
  h12 = false,
  step = 15,
  className = '',
  ...props
}) {
  const [text, setText] = useState(value ? formatTime(value, h12) : '')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const optionRefs = useRef([])
  const listId = useId()
  const typed = useRef(false)

  const options = useMemo(() => {
    const size = Number(step) > 0 ? Number(step) : 15
    const list = []
    for (let minute = 0; minute < 1440; minute += size) list.push(fromMinutes(minute))
    return list
  }, [step])

  useEffect(() => {
    setText(value ? formatTime(value, h12) : '')
  }, [value, h12])

  useEffect(() => {
    if (open && highlighted >= 0) optionRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' })
  }, [open, highlighted])

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  function commit() {
    if (!text.trim()) {
      onChange?.(null)
      setText('')
      return
    }
    const parsed = parseTimeInput(text)
    if (parsed) {
      onChange?.(parsed)
      setText(formatTime(parsed, h12))
    } else {
      setText(value ? formatTime(value, h12) : '')
    }
  }

  function choose(time) {
    typed.current = false
    onChange?.(time)
    setText(formatTime(time, h12))
    setOpen(false)
    inputRef.current?.focus()
  }

  function openList() {
    typed.current = false
    const at = options.indexOf(value)
    setHighlighted(at >= 0 ? at : 0)
    setOpen(true)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openList()
        return
      }
      typed.current = false
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setHighlighted((at) => {
        const start = at < 0 ? 0 : at
        return (start + delta + options.length) % options.length
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!typed.current && open && highlighted >= 0) choose(options[highlighted])
      else {
        commit()
        setOpen(false)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className={`ui-time-field ${className}`.trim()} {...props}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        className="ui-input ui-time-input"
        placeholder={h12 ? '9:30 AM' : '09:30'}
        value={text}
        onChange={(event) => {
          typed.current = true
          setText(event.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={openList}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label="Time"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
      />
      <button
        type="button"
        className="ui-time-toggle"
        aria-label="Choose time"
        title="Choose time"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ui-time-list" id={listId} role="listbox" aria-label="Times">
          {options.map((time, i) => (
            <button
              key={time}
              ref={(node) => {
                optionRefs.current[i] = node
              }}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={time === value}
              className={[
                'ui-time-option',
                time === value ? 'is-selected' : '',
                i === highlighted ? 'is-focused' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => choose(time)}
            >
              {formatTime(time, h12)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
