import { forwardRef } from 'react'
import { Spinner } from './Spinner.jsx'

export const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    full = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    size === 'sm' ? 'ui-button--sm' : '',
    full ? 'ui-button--full' : '',
    loading ? 'ui-button--loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Spinner size={14} className="ui-button-spinner" />
      ) : Icon ? (
        <Icon className="ui-button-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : null}
      {children}
      {IconRight ? (
        <IconRight className="ui-button-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : null}
    </button>
  )
})
