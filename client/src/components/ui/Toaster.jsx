import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

const ICON = { success: CircleCheck, danger: CircleAlert, default: Info }

// One note in the corner: an icon for its tone, the message, an action, and a
// thin line that runs down while it waits. It slides out before it is removed.
function Toast({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false)
  const Icon = ICON[toast.tone] || ICON.default
  const close = () => {
    setLeaving(true)
    setTimeout(() => onDismiss?.(toast.id), 160)
  }
  useEffect(() => {
    if (toast.leaving) setLeaving(true)
  }, [toast.leaving])
  return (
    <div className={`ui-toast ui-toast--${toast.tone || 'default'}${leaving ? ' is-leaving' : ''}`} role="status">
      <Icon size={16} className="ui-toast-icon" aria-hidden="true" />
      <span className="ui-toast-message">
        {toast.message}
        {toast.count > 1 && <span className="ui-toast-count">×{toast.count}</span>}
      </span>
      {toast.action ? (
        <button
          type="button"
          className="ui-toast-action"
          onClick={() => {
            toast.action.run?.()
            close()
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" className="ui-toast-close" aria-label="Dismiss" onClick={close}>
        <X size={14} />
      </button>
      {toast.timeout > 0 && <i key={toast.count} className="ui-toast-timer" style={{ animationDuration: `${toast.timeout}ms` }} aria-hidden="true" />}
    </div>
  )
}

export function Toaster({ toasts = [], onDismiss, className = '', ...props }) {
  return (
    <div className={`ui-toaster ${className}`.trim()} aria-live="polite" aria-relevant="additions" {...props}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
