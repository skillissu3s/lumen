import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MARGIN = 8
const GAP = 4
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

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

      // measure at its natural height: the cap below is set here, outside
      // React's style, so it can be lifted and put back in one go
      const scrolled = popup.scrollTop
      popup.style.maxHeight = ''
      popup.style.overflowY = ''
      const [side, align] = placement.split('-')
      const width = popup.offsetWidth
      const height = popup.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const gap = rect.width === 0 && rect.height === 0 ? 0 : GAP
      const room = {
        bottom: vh - MARGIN - rect.bottom - gap,
        top: rect.top - gap - MARGIN,
        right: vw - MARGIN - rect.right - gap,
        left: rect.left - gap - MARGIN,
      }
      const vertical = side === 'top' || side === 'bottom'

      // flip when it doesn't fit this side and the other side has more room
      let resolved = side
      if (room[side] < (vertical ? height : width) && room[OPPOSITE[side]] > room[side]) resolved = OPPOSITE[side]

      // taller than the room it has: scroll inside. Beside its anchor that is
      // the whole window; above or below it, the room on that side, unless
      // that is a sliver, when it covers the anchor and takes the window
      let avail = vh - 2 * MARGIN
      if (vertical && room[resolved] >= Math.min(height, 160)) avail = room[resolved]
      const h = Math.min(height, avail)
      if (height > avail) {
        popup.style.maxHeight = `${avail}px`
        popup.style.overflowY = 'auto'
        popup.scrollTop = scrolled
      }

      let top
      let left
      if (resolved === 'bottom' || resolved === 'top') {
        top = resolved === 'bottom' ? rect.bottom + gap : rect.top - h - gap
        if (align === 'end') left = rect.right - width
        else if (!align || align === 'center') left = rect.left + rect.width / 2 - width / 2
        else left = rect.left
      } else {
        left = resolved === 'right' ? rect.right + gap : rect.left - width - gap
        if (align === 'end') top = rect.bottom - h
        else if (!align || align === 'center') top = rect.top + rect.height / 2 - h / 2
        else top = rect.top
      }

      left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN))
      top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN))

      setActual(resolved)
      // a new object only when something moved, so the size watcher below
      // can't feed itself
      setStyle((s) => (s.top === top && s.left === left && s.visibility === 'visible' ? s : { position: 'fixed', top, left, visibility: 'visible' }))
    }

    // scrolling inside the popup (or a list in it) doesn't move it
    const onScroll = (e) => {
      if (!popupRef.current?.contains(e.target)) update()
    }
    update()
    // content that grows or shrinks after opening (more options, a list that
    // loads) moves it again
    const watch = typeof ResizeObserver === 'function' && popupRef.current ? new ResizeObserver(() => update()) : null
    if (watch) watch.observe(popupRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      watch?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', onScroll, true)
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
    // the field marked data-autofocus, else the first thing that takes focus;
    // just after it has been placed (a hidden field can't take focus)
    const later = setTimeout(() => {
      const first = node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE)
      if (!node?.contains(document.activeElement)) (first || node)?.focus()
    }, 0)
    return () => {
      clearTimeout(later)
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
