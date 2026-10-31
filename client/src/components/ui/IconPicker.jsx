// Picking an icon (by name) from Lumen's icon set, with a search.
import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { ICONS, ICON_NAMES } from '../../shell/icons.js'

export function IconPicker({ value, onChange, color, className = '' }) {
  const [q, setQ] = useState('')
  const gridRef = useRef(null)
  const names = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? ICON_NAMES.filter((n) => n.includes(needle)) : ICON_NAMES
  }, [q])
  const move = (e) => {
    const buttons = [...gridRef.current.querySelectorAll('button')]
    const i = buttons.indexOf(document.activeElement)
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[e.key]
    if (step == null || i < 0) return
    e.preventDefault()
    buttons[Math.max(0, Math.min(buttons.length - 1, i + step))]?.focus()
  }
  return (
    <div className={`icon-picker ${className}`.trim()} style={color ? { '--ip': `var(--c-${color})` } : undefined}>
      <label className="icon-picker-search">
        <Search size={14} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons" aria-label="Search icons" />
      </label>
      <div className="icon-picker-grid" role="radiogroup" aria-label="Icon" ref={gridRef} onKeyDown={move}>
        {names.map((n) => {
          const Icon = ICONS[n]
          return (
            <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={n.replace(/-/g, ' ')} title={n.replace(/-/g, ' ')} className="icon-picker-option" onClick={() => onChange(n)}>
              <Icon size={16} />
            </button>
          )
        })}
        {!names.length && <p className="icon-picker-empty">No icon matches “{q}”.</p>}
      </div>
    </div>
  )
}

/** An icon (by name) on a soft square in its colour — how boards and calendars are shown */
export function IconBadge({ name, color = 'gray', size = 22, fallback }) {
  const Icon = ICONS[String(name || '').toLowerCase()] || fallback
  return (
    <span className="icon-badge" style={{ '--ib': `var(--c-${color})`, '--ib-bg': `var(--c-${color}-bg)`, width: size, height: size }}>
      {Icon ? <Icon size={Math.round(size * 0.62)} strokeWidth={2} /> : null}
    </span>
  )
}
