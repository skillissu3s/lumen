import { forwardRef } from 'react'

export const IconButton = forwardRef(function IconButton(
  {
    icon: Icon,
    label,
    size = 'md',
    active = false,
    variant = 'ghost',
    className = '',
    type = 'button',
    ...props
  },
  ref,
) {
  const classes = [
    'ui-icon-button',
    variant === 'secondary' ? 'ui-icon-button--secondary' : '',
    size === 'sm' ? 'ui-icon-button--sm' : '',
    active ? 'is-active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      {...props}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
})
