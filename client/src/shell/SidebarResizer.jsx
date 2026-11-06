// The sidebar's right edge, dragged to make it wider or narrower (as obi does
// it). While dragging, the width goes straight onto the frame once a frame,
// with the sidebar's slide switched off, so nothing re-renders behind the
// pointer; the width is saved when the pointer lets go. Double-click resets it.
import { useRef, useState } from 'react'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 420
export const SIDEBAR_DEFAULT = 248
const clamp = (w) => Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w)))

export function SidebarResizer({ frameRef, width, onCommit }) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef(null)
  const apply = (w) => frameRef.current?.style.setProperty('--sidebar-w', `${w}px`)
  const end = (w) => {
    drag.current = null
    frameRef.current?.classList.remove('is-resizing')
    document.body.classList.remove('is-col-resizing')
    setDragging(false)
    if (w && w !== width) onCommit(w)
  }
  return (
    <div
      className={`sidebar-resizer${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const left = frameRef.current?.getBoundingClientRect().left || 0
        drag.current = { left, x: e.clientX, raf: 0, width }
        frameRef.current?.classList.add('is-resizing')
        document.body.classList.add('is-col-resizing')
        setDragging(true)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.x = e.clientX
        if (d.raf) return
        d.raf = requestAnimationFrame(() => {
          d.raf = 0
          if (drag.current !== d) return
          d.width = clamp(d.x - d.left)
          apply(d.width)
        })
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        cancelAnimationFrame(d.raf)
        const w = clamp(e.clientX - d.left)
        apply(w)
        end(w)
      }}
      onPointerCancel={() => {
        const d = drag.current
        if (!d) return
        cancelAnimationFrame(d.raf)
        end(d.width)
      }}
      onDoubleClick={() => {
        apply(SIDEBAR_DEFAULT)
        onCommit(SIDEBAR_DEFAULT)
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8
        const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        if (!d) return
        e.preventDefault()
        const w = clamp(width + d)
        apply(w)
        onCommit(w)
      }}
    />
  )
}
