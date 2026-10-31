import { cloneElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { usePopoverPosition } from './Popover.jsx'
import { Kbd } from './Kbd.jsx'

function mergeRefs(...refs) {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(node)
      else ref.current = node
    }
  }
}

const isItem = (item) => item && typeof item === 'object' && !('section' in item)

function shortcutKeys(shortcut) {
  if (Array.isArray(shortcut)) return shortcut
  return String(shortcut)
    .split(/[+\s]+/)
    .filter(Boolean)
}

function MenuPopup({ anchor, align = 'start', items = [], onClose }) {
  const { popupRef, style } = usePopoverPosition(anchor, `bottom-${align}`, true)
  const itemRefs = useRef([])
  const search = useRef({ text: '', at: 0 })
  const skipRestore = useRef(false)

  const focusable = items
    .map((item, i) => (isItem(item) && !item.disabled ? i : -1))
    .filter((i) => i >= 0)

  useEffect(() => {
    const previous = document.activeElement
    const first = focusable[0]
    if (first != null) itemRefs.current[first]?.focus()
    else popupRef.current?.focus()
    return () => {
      if (!skipRestore.current && previous?.isConnected) previous.focus()
    }
    // Focus only when the menu mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onPointerDown(event) {
      if (popupRef.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [onClose, popupRef])

  function move(from, delta) {
    if (!focusable.length) return
    const at = focusable.indexOf(from)
    if (at < 0) {
      itemRefs.current[focusable[delta > 0 ? 0 : focusable.length - 1]]?.focus()
      return
    }
    const next = focusable[(at + delta + focusable.length) % focusable.length]
    itemRefs.current[next]?.focus()
  }

  function onKeyDown(event) {
    const active = itemRefs.current.findIndex((node) => node === document.activeElement)
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(active, 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(active, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      itemRefs.current[focusable[0]]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      itemRefs.current[focusable[focusable.length - 1]]?.focus()
    } else if (event.key === 'Tab') {
      skipRestore.current = true
      onClose()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      search.current.text = now - search.current.at > 600 ? event.key : search.current.text + event.key
      search.current.at = now
      const query = search.current.text.toLowerCase()
      const match = items.findIndex(
        (item) => isItem(item) && !item.disabled && String(item.label).toLowerCase().startsWith(query),
      )
      if (match >= 0) {
        event.preventDefault()
        itemRefs.current[match]?.focus()
      }
    }
  }

  function select(item) {
    if (item.disabled) return
    item.onSelect?.()
    onClose()
  }

  return createPortal(
    <div
      ref={popupRef}
      className="ui-menu"
      role="menu"
      style={style}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {items.map((item, i) => {
        if (!item) return null
        if (item === 'separator') return <div key={`sep-${i}`} className="ui-menu-separator" role="separator" />
        if (typeof item === 'object' && 'section' in item) {
          return (
            <div key={`section-${i}`} className="ui-menu-section" role="presentation">
              {item.section}
            </div>
          )
        }
        const Icon = item.icon
        const checked = 'checked' in item
        return (
          <button
            key={`item-${i}`}
            ref={(node) => {
              itemRefs.current[i] = node
            }}
            type="button"
            role={checked ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checked ? Boolean(item.checked) : undefined}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            className={[
              'ui-menu-item',
              item.danger ? 'is-danger' : '',
              item.disabled ? 'is-disabled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => select(item)}
          >
            {checked ? (
              <span className="ui-menu-check" aria-hidden="true">
                {item.checked ? <Check size={14} strokeWidth={1.75} /> : null}
              </span>
            ) : Icon ? (
              <span className="ui-menu-icon" aria-hidden="true">
                <Icon size={16} strokeWidth={1.75} />
              </span>
            ) : null}
            <span className="ui-menu-label">{item.label}</span>
            {item.shortcut ? (
              <Kbd keys={shortcutKeys(item.shortcut)} className="ui-menu-shortcut" aria-hidden="true" />
            ) : null}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

export function Menu({ trigger, items = [], align = 'start', className = '', ...props }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)

  if (!trigger) return null

  const triggerNode = cloneElement(trigger, {
    ...props,
    ref: mergeRefs(trigger.props.ref, triggerRef),
    className: [trigger.props.className, className].filter(Boolean).join(' '),
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (event) => {
      trigger.props.onClick?.(event)
      if (!event.defaultPrevented) setOpen((value) => !value)
    },
    onKeyDown: (event) => {
      trigger.props.onKeyDown?.(event)
      if (!event.defaultPrevented && event.key === 'ArrowDown') {
        event.preventDefault()
        setOpen(true)
      }
    },
  })

  return (
    <>
      {triggerNode}
      {open ? (
        <MenuPopup anchor={triggerRef} align={align} items={items} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

export function ContextMenu({ items = [], children, className = '', ...props }) {
  const [point, setPoint] = useState(null)

  function openAt(x, y) {
    setPoint({ x, y })
  }

  function onContextMenu(event) {
    event.preventDefault()
    openAt(event.clientX, event.clientY)
  }

  function onKeyDown(event) {
    const keyboard = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
    if (!keyboard) return
    event.preventDefault()
    const node = document.activeElement
    const rect = node?.getBoundingClientRect?.()
    if (rect) openAt(rect.left + 8, rect.top + rect.height / 2)
    else openAt(0, 0)
  }

  return (
    <>
      <span
        className={`ui-context-target ${className}`.trim()}
        {...props}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      >
        {children}
      </span>
      {point ? <MenuPopup anchor={point} items={items} onClose={() => setPoint(null)} /> : null}
    </>
  )
}
