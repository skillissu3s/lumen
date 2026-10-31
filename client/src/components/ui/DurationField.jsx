import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatDuration, parseDuration } from '../../../../shared/dates.js'

const PRESETS = [15, 30, 45, 60, 90, 120, 180]

export function DurationField({ value = null, onChange, className = '', ...props }) {
  const [text, setText] = useState(value ? formatDuration(value) : '')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const optionRefs = useRef([])
  const typed = useRef(false)
  const listId = useId()

  useEffect(() => {
    setText(value ? formatDuration(value) : '')
  }, [value])

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
    const parsed = parseDuration(text)
    if (parsed) {
      onChange?.(parsed)
      setText(formatDuration(parsed))
    } else {
      setText(value ? formatDuration(value) : '')
    }
  }

  function choose(minutes) {
    typed.current = false
    onChange?.(minutes)
    setText(formatDuration(minutes))
    setOpen(false)
    inputRef.current?.focus()
  }

  function openList() {
    typed.current = false
    const at = PRESETS.indexOf(value)
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
        return (start + delta + PRESETS.length) % PRESETS.length
      })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (!typed.current && open && highlighted >= 0) choose(PRESETS[highlighted])
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
    <div ref={wrapRef} className={`ui-duration-field ${className}`.trim()} {...props}>
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        className="ui-input ui-duration-input"
        placeholder="1h 30m"
        value={text}
        onChange={(event) => {
          typed.current = true
          setText(event.target.value)
          if (!open) setOpen(true)
        }}
        onFocus={openList}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label="Duration"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
      />
      <button
        type="button"
        className="ui-duration-toggle"
        aria-label="Choose duration"
        title="Choose duration"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ui-duration-list" id={listId} role="listbox" aria-label="Durations">
          {PRESETS.map((minutes, i) => (
            <button
              key={minutes}
              ref={(node) => {
                optionRefs.current[i] = node
              }}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={minutes === value}
              className={[
                'ui-duration-option',
                minutes === value ? 'is-selected' : '',
                i === highlighted ? 'is-focused' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => choose(minutes)}
            >
              {formatDuration(minutes)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
