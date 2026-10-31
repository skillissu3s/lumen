import { Loader2 } from 'lucide-react'

export function Spinner({ size = 16, className = '', ...props }) {
  return (
    <span className={`ui-spinner ${className}`.trim()} {...props}>
      <Loader2 size={size} strokeWidth={1.75} aria-hidden="true" />
    </span>
  )
}
