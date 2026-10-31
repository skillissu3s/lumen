import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { FOCUSABLE } from './Popover.jsx'
import { IconButton } from './IconButton.jsx'

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className = '',
  ...props
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef(null)
  const previous = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    previous.current = document.activeElement
    const node = dialogRef.current
    const first = node?.querySelector(FOCUSABLE)
    ;(first || node)?.focus()

    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = overflow
      if (previous.current?.isConnected) previous.current.focus()
    }
  }, [open])

  if (!open) return null

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose?.()
      return
    }
    if (event.key !== 'Tab') return

    const node = dialogRef.current
    if (!node) return
    const list = Array.from(node.querySelectorAll(FOCUSABLE))
    if (!list.length) {
      event.preventDefault()
      node.focus()
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="ui-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`ui-dialog ui-dialog--${size} ${className}`.trim()}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        {...props}
      >
        <div className="ui-dialog-head">
          <div className="ui-dialog-title-wrap">
            <div className="ui-dialog-title" id={titleId}>
              {title}
            </div>
            {description ? (
              <div className="ui-dialog-desc" id={descriptionId}>
                {description}
              </div>
            ) : null}
          </div>
          <IconButton icon={X} label="Close" className="ui-dialog-close" onClick={onClose} />
        </div>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
