const COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink']

export function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorFor(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return COLORS[hash % COLORS.length]
}

export function Avatar({ name = '', size = 24, className = '', ...props }) {
  const color = colorFor(name)
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.4)),
    '--avatar-bg': `var(--c-${color}-bg)`,
    '--avatar-fg': `var(--c-${color}-fg)`,
  }

  return (
    <span
      className={`ui-avatar ${className}`.trim()}
      style={style}
      role="img"
      aria-label={name || 'Unknown'}
      title={name || undefined}
      {...props}
    >
      {initialsOf(name)}
    </span>
  )
}
