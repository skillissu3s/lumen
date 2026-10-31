const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

const LABELS = {
  Ctrl: MAC ? '⌘' : 'Ctrl',
  Cmd: MAC ? '⌘' : 'Ctrl',
  Alt: MAC ? '⌥' : 'Alt',
  Shift: MAC ? '⇧' : 'Shift',
  Enter: MAC ? '↵' : 'Enter',
}

export function Kbd({ keys = [], className = '', ...props }) {
  return (
    <span className={`ui-kbd-group ${className}`.trim()} {...props}>
      {keys.map((key, i) => (
        <kbd key={`${key}-${i}`}>{LABELS[key] || key}</kbd>
      ))}
    </span>
  )
}
