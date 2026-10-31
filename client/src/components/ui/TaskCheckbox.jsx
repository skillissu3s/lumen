import { Check } from 'lucide-react'

const NEXT = {
  ' ': 'x',
  '/': 'x',
  x: ' ',
  '-': ' ',
}

export function TaskCheckbox({
  status = ' ',
  color,
  onToggle,
  label,
  className = '',
  ...props
}) {
  const state = NEXT[status] ? status : ' '
  const style = color
    ? { '--tc': `var(--c-${color}-fg)`, '--tc-ink': `var(--c-${color}-bg)` }
    : undefined

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === '/' ? 'mixed' : state === 'x'}
      aria-label={label || 'Toggle task'}
      title={label || undefined}
      data-status={state}
      className={`ui-task-checkbox ${className}`.trim()}
      style={style}
      onClick={() => onToggle?.(NEXT[state])}
      {...props}
    >
      {state === 'x' ? (
        <Check className="ui-task-checkbox-icon" size={11} strokeWidth={3} aria-hidden="true" />
      ) : null}
    </button>
  )
}
