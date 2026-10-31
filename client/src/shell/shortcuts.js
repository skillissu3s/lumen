// Keyboard shortcuts: one window listener, a registry for the help dialog, and
// a hook views use. Single keys and two-key sequences ("g t") are supported.
import { useEffect, useRef } from 'react'

const registry = new Map() // id → { combo, description, group }
const handlers = new Set()

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function typingIn(target) {
  const el = target
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// "mod+k" → matches Ctrl+K (Windows/Linux) or ⌘K (mac)
function matches(combo, e) {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop()
  const want = { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') }
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (want.mod !== mod || want.alt !== e.altKey) return false
  const k = e.key.toLowerCase()
  // shift is implied by characters like "?"
  if (key.length === 1 && !/[a-z0-9]/.test(key)) return k === key
  if (want.shift !== e.shiftKey) return false
  const names = { esc: 'escape', del: 'delete', space: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', '\\': '\\' }
  return k === (names[key] || key)
}

let pending = null // first key of a sequence
let pendingTimer = null

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return
    for (const h of [...handlers].reverse()) {
      const { combo, allowInInput, when } = h.opts
      if (!allowInInput && typingIn(e.target)) continue
      if (when && !when()) continue
      const seq = combo.split(' ')
      if (seq.length === 2) {
        if (pending === seq[0] && matches(seq[1], e)) {
          e.preventDefault()
          pending = null
          h.ref.current(e)
          return
        }
        continue
      }
      if (matches(combo, e)) {
        e.preventDefault()
        h.ref.current(e)
        return
      }
    }
    // remember a possible first key of a sequence
    if (!typingIn(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      pending = e.key.toLowerCase()
      clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => (pending = null), 900)
    }
  })
}

/**
 * useShortcut('mod+k', fn, { description, group, allowInInput, when })
 * `combo` is "key", "mod+key", "shift+key" or a sequence "g t".
 */
export function useShortcut(combo, fn, opts = {}) {
  const ref = useRef(fn)
  ref.current = fn
  const { description, group = 'General', allowInInput = false, enabled = true } = opts
  const whenRef = useRef(opts.when)
  whenRef.current = opts.when
  useEffect(() => {
    if (!enabled) return
    const h = { ref, opts: { combo, allowInInput, when: () => (whenRef.current ? whenRef.current() : true) } }
    handlers.add(h)
    const id = `${group}:${combo}`
    if (description) registry.set(id, { combo, description, group })
    return () => {
      handlers.delete(h)
      if (description) registry.delete(id)
    }
  }, [combo, allowInInput, enabled, description, group])
}

/** Every described shortcut, grouped: [{ group, items: [{ combo, description }] }] */
export function shortcutList() {
  const groups = new Map()
  for (const s of registry.values()) {
    if (!groups.has(s.group)) groups.set(s.group, [])
    groups.get(s.group).push(s)
  }
  return [...groups].map(([group, items]) => ({ group, items }))
}

/** "mod+shift+k" → ['Ctrl', 'Shift', 'K'] for <Kbd keys> */
export function comboKeys(combo) {
  return combo
    .split(' ')
    .flatMap((part, i) => [...(i ? ['then'] : []), ...part.split('+')])
    .map((k) => ({ mod: isMac ? '⌘' : 'Ctrl', shift: 'Shift', alt: isMac ? '⌥' : 'Alt', esc: 'Esc', del: 'Del', up: '↑', down: '↓', left: '←', right: '→', space: 'Space', enter: 'Enter' })[k] || (k.length === 1 ? k.toUpperCase() : k))
}
