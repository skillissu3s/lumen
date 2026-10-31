import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MARGIN = 8
const GAP = 4

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function elementOf(anchor) {
  if (!anchor) return null
  if (anchor.nodeType === 1) return anchor
  return anchor.current || null
}

function rectOf(anchor) {
  if (!anchor) return null
  if (typeof anchor.x === 'number' && typeof anchor.y === 'number') {
    return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y, width: 0, height: 0 }
  }
  const node = elementOf(anchor)
  if (!node || typeof node.getBoundingClientRect !== 'function') return null
  return node.getBoundingClientRect()
}

function mergeRefs(...refs) {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(node)
      else ref.current = node
    }
  }
}

export function usePopoverPosition(anchor, placement = 'bottom-start', open = true) {
  const popupRef = useRef(null)
  const [actual, setActual] = useState(placement)
  const [style, setStyle] = useState({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return undefined

    function update() {
      const rect = rectOf(anchor)
      const popup = popupRef.current
      if (!rect || !popup) return

      const [side, align] = placement.split('-')
      const width = popup.offsetWidth
      const height = popup.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const gap = rect.width === 0 && rect.height === 0 ? 0 : GAP

      let resolved = side
      if (side === 'bottom' && rect.bottom + gap + height > vh - MARGIN && rect.top - gap - height >= MARGIN) {
        resolved = 'top'
      } else if (side === 'top' && rect.top - gap - height < MARGIN && rect.bottom + gap + height <= vh - MARGIN) {
        resolved = 'bottom'
      } else if (side === 'right' && rect.right + gap + width > vw - MARGIN && rect.left - gap - width >= MARGIN) {
        resolved = 'left'
      } else if (side === 'left' && rect.left - gap - width < MARGIN && rect.right + gap + width <= vw - MARGIN) {
        resolved = 'right'
      }

      let top
      let left
      if (resolved === 'bottom' || resolved === 'top') {
        top = resolved === 'bottom' ? rect.bottom + gap : rect.top - height - gap
        if (align === 'end') left = rect.right - width
        else if (!align || align === 'center') left = rect.left + rect.width / 2 - width / 2
        else left = rect.left
      } else {
        left = resolved === 'right' ? rect.right + gap : rect.left - width - gap
        if (align === 'end') top = rect.bottom - height
        else if (!align || align === 'center') top = rect.top + rect.height / 2 - height / 2
        else top = rect.top
      }

      left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN))
      top = Math.max(MARGIN, Math.min(top, vh - height - MARGIN))

      setActual(resolved)
      setStyle({ position: 'fixed', top, left, visibility: 'visible' })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchor, placement, open])

  return { popupRef, style, placement: actual }
}

export function Popover({
  open,
  onOpenChange,
  anchor,
  trigger,
  placement = 'bottom-start',
  className = '',
  children,
  ...props
}) {
  const triggerRef = useRef(null)
  const anchorRef = anchor || triggerRef
  const { popupRef, style } = usePopoverPosition(anchorRef, placement, open)
  const previousFocus = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const node = popupRef.current
    previousFocus.current = document.activeElement
    const first = node?.querySelector(FOCUSABLE)
    ;(first || node)?.focus()
    return () => {
      const active = document.activeElement
      if (previousFocus.current?.isConnected && (active === document.body || node?.contains(active))) {
        previousFocus.current.focus()
      }
    }
  }, [open, popupRef])

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event) {
      const node = popupRef.current
      const anchorNode = elementOf(anchorRef)
      if (node?.contains(event.target)) return
      if (anchorNode?.contains?.(event.target)) return
      onOpenChange?.(false)
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onOpenChange?.(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange, anchorRef, popupRef])

  let triggerNode = null
  if (trigger) {
    triggerNode = cloneElement(trigger, {
      ref: mergeRefs(trigger.props.ref, triggerRef),
      'aria-haspopup': trigger.props['aria-haspopup'] || 'dialog',
      'aria-expanded': open,
      onClick: (event) => {
        trigger.props.onClick?.(event)
        if (!event.defaultPrevented) onOpenChange?.(!open)
      },
    })
  }

  return (
    <>
      {triggerNode}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              className={`ui-popover ${className}`.trim()}
              style={style}
              tabIndex={-1}
              {...props}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
