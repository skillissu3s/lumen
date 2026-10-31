import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverPosition } from './Popover.jsx'

export function Tooltip({ label, children, side = 'top', className = '', ...props }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const timer = useRef(null)
  const id = useId()
  const { popupRef, style } = usePopoverPosition(anchorRef, side, open)

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  function show(delay) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }

  function hide() {
    clearTimeout(timer.current)
    setOpen(false)
  }

  return (
    <>
      <span
        ref={anchorRef}
        className={`ui-tooltip-anchor ${className}`.trim()}
        aria-describedby={open ? id : undefined}
        {...props}
        onMouseEnter={() => show(400)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
      >
        {children}
      </span>
      {open && label
        ? createPortal(
            <div ref={popupRef} id={id} role="tooltip" className="ui-tooltip" style={style}>
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
