// Hash router so the app works from any static host (including GitHub Pages).

import { useSyncExternalStore } from 'react'

/** `#/calendar?view=week&date=2026-11-02` → { path, parts, query } */
export function parseHash(hash = globalThis.location?.hash ?? '') {
  let h = String(hash || '')
  if (h.startsWith('#')) h = h.slice(1)
  const q = h.indexOf('?')
  const path = (q >= 0 ? h.slice(0, q) : h) || '/'
  const query = {}
  if (q >= 0) {
    for (const [k, v] of new URLSearchParams(h.slice(q + 1))) query[k] = v
  }
  return { path, parts: path.split('/').filter(Boolean), query }
}

export function navigate(path, { replace = false } = {}) {
  const clean = String(path || '/').replace(/^#/, '')
  const target = `#${clean.startsWith('/') ? '' : '/'}${clean}`
  if (replace) window.location.replace(target)
  else window.location.hash = target
}

const listeners = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    for (const fn of listeners) fn()
  })
}

/** The current route, re-rendering on hashchange. */
export function useRoute() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => parseHash(window.location.hash),
  )
}
