export function Separator({ orientation = 'horizontal', className = '', ...props }) {
  const classes = ['ui-separator', orientation === 'vertical' ? 'ui-separator--vertical' : '', className]
    .filter(Boolean)
    .join(' ')

  return <hr className={classes} aria-orientation={orientation} {...props} />
}
