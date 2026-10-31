import { X } from 'lucide-react'
import { IconButton } from './IconButton.jsx'

export function Toaster({ toasts = [], onDismiss, className = '', ...props }) {
  return (
    <div
      className={`ui-toaster ${className}`.trim()}
      aria-live="polite"
      aria-relevant="additions"
      {...props}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`ui-toast ui-toast--${toast.tone || 'default'}`}
          role="status"
        >
          <span className="ui-toast-message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="ui-toast-action"
              onClick={() => {
                toast.action.run?.()
                onDismiss?.(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <IconButton icon={X} label="Dismiss" size="sm" onClick={() => onDismiss?.(toast.id)} />
        </div>
      ))}
    </div>
  )
}
