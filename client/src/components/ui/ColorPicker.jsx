import { useRef } from 'react'
import { ColorDot, ITEM_COLORS } from './ColorDot.jsx'

export function ColorPicker({ value, onChange, className = '', ...props }) {
  const refs = useRef([])
  const index = ITEM_COLORS.indexOf(value)

  function move(from, delta) {
    const next = (from + delta + ITEM_COLORS.length) % ITEM_COLORS.length
    onChange?.(ITEM_COLORS[next])
    refs.current[next]?.focus()
  }

  function onKeyDown(event, at) {
    const keys = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    }
    if (keys[event.key]) {
      event.preventDefault()
      move(at, keys[event.key])
    } else if (event.key === 'Home') {
      event.preventDefault()
      onChange?.(ITEM_COLORS[0])
      refs.current[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      onChange?.(ITEM_COLORS[ITEM_COLORS.length - 1])
      refs.current[ITEM_COLORS.length - 1]?.focus()
    }
  }

  return (
    <div className={`ui-color-picker ${className}`.trim()} role="radiogroup" aria-label="Colour" {...props}>
      {ITEM_COLORS.map((color, i) => (
        <button
          key={color}
          ref={(node) => {
            refs.current[i] = node
          }}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          title={color}
          className={`ui-color-picker-option ${value === color ? 'is-selected' : ''}`.trim()}
          tabIndex={value === color || (index < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange?.(color)}
          onKeyDown={(event) => onKeyDown(event, i)}
        >
          <ColorDot color={color} size={14} />
        </button>
      ))}
    </div>
  )
}
