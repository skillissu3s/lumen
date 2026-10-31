import { useRef } from 'react'

export function Segmented({ value, onChange, options = [], label, className = '', ...props }) {
  const refs = useRef([])
  const selected = options.findIndex((option) => option.value === value)

  function choose(index) {
    const next = options[index]
    if (!next) return
    onChange?.(next.value)
    refs.current[index]?.focus()
  }

  function onKeyDown(event, index) {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (delta) {
      event.preventDefault()
      choose((index + delta + options.length) % options.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      choose(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      choose(options.length - 1)
    }
  }

  return (
    <div
      className={`ui-segmented ${className}`.trim()}
      role="radiogroup"
      aria-label={label}
      {...props}
    >
      {options.map((option, i) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[i] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ui-segmented-option ${active ? 'is-selected' : ''}`.trim()}
            tabIndex={active || (selected < 0 && i === 0) ? 0 : -1}
            onClick={() => choose(i)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            {Icon ? <Icon size={15} strokeWidth={1.75} aria-hidden="true" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
