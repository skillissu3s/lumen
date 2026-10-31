// The Lumen mark: a soft square with a ring of light.
export function Logo({ size = 22, className = '' }) {
  return (
    <svg className={`logo ${className}`.trim()} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <circle cx="16" cy="16" r="6.25" fill="none" stroke="var(--ink-text)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="1.9" fill="var(--ink-text)" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Logo size={22} />
      <span>Lumen</span>
    </span>
  )
}
