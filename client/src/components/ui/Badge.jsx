export function Badge({ tone = 'default', className = '', children, ...props }) {
  const classes = ['ui-badge', tone !== 'default' ? `ui-badge--${tone}` : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  )
}
