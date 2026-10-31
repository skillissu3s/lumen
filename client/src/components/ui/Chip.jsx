import { X } from 'lucide-react'

export function Chip({ color, icon: Icon, onRemove, className = '', children, ...props }) {
  const style = color
    ? {
        '--chip-bg': `var(--c-${color}-bg)`,
        '--chip-fg': `var(--c-${color}-fg)`,
        '--chip-hover': `var(--c-${color})`,
      }
    : undefined

  return (
    <span className={`ui-chip ${className}`.trim()} style={style} {...props}>
      {Icon ? <Icon className="ui-chip-icon" size={13} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span className="ui-chip-label">{children}</span>
      {onRemove ? (
        <button
          type="button"
          className="ui-chip-remove"
          onClick={onRemove}
          aria-label="Remove"
          title="Remove"
        >
          <X size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  )
}
