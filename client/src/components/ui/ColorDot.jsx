export const ITEM_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink']

export function ColorDot({ color, size = 8, className = '', ...props }) {
  const style = {
    width: size,
    height: size,
    '--dot': color ? `var(--c-${color})` : 'var(--text-faint)',
  }

  return (
    <span
      className={`ui-color-dot ${className}`.trim()}
      style={style}
      aria-hidden="true"
      {...props}
    />
  )
}
