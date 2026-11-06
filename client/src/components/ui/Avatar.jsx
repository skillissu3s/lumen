export const AVATAR_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink']

export function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorFor(name = '') {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/**
 * Initials on a colour, or a photo. `color` is the person's own choice; without
 * it the colour comes from the name, so it stays the same everywhere.
 */
export function Avatar({ name = '', color, src, size = 24, className = '', ...props }) {
  const tone = AVATAR_COLORS.includes(color) ? color : colorFor(name)
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(9, Math.round(size * 0.4)),
    '--avatar-bg': `var(--c-${tone}-bg)`,
    '--avatar-fg': `var(--c-${tone}-fg)`,
  }

  return (
    <span
      className={`ui-avatar${src ? ' has-photo' : ''} ${className}`.trim()}
      style={style}
      role="img"
      aria-label={name || 'Unknown'}
      title={name || undefined}
      {...props}
    >
      {src ? <img src={src} alt="" draggable={false} /> : initialsOf(name)}
    </span>
  )
}

/** A signed-in person, or anyone the server listed: { name, handle, color, avatar } */
export function UserAvatar({ user, size, ...props }) {
  return <Avatar name={user?.name || user?.handle || ''} color={user?.color} src={user?.avatar} size={size} {...props} />
}
