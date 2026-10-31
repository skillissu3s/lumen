// UI chrome state: toasts, the command palette, the command registry, and small
// bits other parts of the app publish (plugin badges/status, chat unread).

import { create } from 'zustand'

let nextToast = 1
const timers = new Map()

export const useUI = create((set, get) => ({
  toasts: [],
  paletteOpen: false,
  commandMap: {},
  selection: {},
  pluginBadges: {},
  pluginStatus: {},
  chatUnread: 0,
  shortcutsOpen: false,

  toast(message, opts = {}) {
    const timeout = opts.timeout ?? 5000
    const tone = opts.tone || 'default'
    // the same note again (completing three cards in a row) counts up instead of stacking
    const same = get().toasts.find((t) => t.message === message && t.tone === tone && !t.leaving)
    if (same) {
      clearTimeout(timers.get(same.id))
      timers.set(same.id, setTimeout(() => get().dismiss(same.id), timeout))
      set((s) => ({ toasts: s.toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1, action: opts.action || t.action } : t)) }))
      return same.id
    }
    const id = nextToast++
    const toast = { id, message, tone, action: opts.action, timeout, count: 1 }
    set((s) => ({ toasts: [...s.toasts.slice(-3), toast] }))
    timers.set(id, setTimeout(() => get().dismiss(id), timeout))
    return id
  },

  dismiss(id) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    // a moment to slide out, then gone
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 160)
  },

  openPalette() {
    set({ paletteOpen: true })
  },

  closePalette() {
    set({ paletteOpen: false })
  },

  registerCommands(source, list) {
    set((s) => {
      const commandMap = { ...s.commandMap }
      for (const c of list) commandMap[c.id] = { ...c, source }
      return { commandMap }
    })
    return () =>
      set((s) => {
        const commandMap = { ...s.commandMap }
        for (const c of list) if (commandMap[c.id]?.source === source) delete commandMap[c.id]
        return { commandMap }
      })
  },

  /** every registered command */
  commands() {
    return Object.values(get().commandMap)
  },

  setSelection(view, value) {
    set((s) => ({ selection: { ...s.selection, [view]: value } }))
  },

  setPluginBadge(id, text) {
    set((s) => ({ pluginBadges: { ...s.pluginBadges, [id]: text || '' } }))
  },

  setPluginStatus(id, text) {
    set((s) => ({ pluginStatus: { ...s.pluginStatus, [id]: text || '' } }))
  },
}))

/** The most recent toast's action (Ctrl+Z runs it) */
export function undoLast() {
  const toasts = useUI.getState().toasts
  const t = [...toasts].reverse().find((x) => x.action)
  if (!t) return false
  t.action.run()
  useUI.getState().dismiss(t.id)
  return true
}
