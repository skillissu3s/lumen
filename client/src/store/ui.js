// UI chrome state: toasts, the command palette, the command registry, and small
// bits other parts of the app publish (plugin badges/status, chat unread).

import { create } from 'zustand'

let nextToast = 1

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
    const id = nextToast++
    const toast = { id, message, tone: opts.tone || 'default', action: opts.action }
    set((s) => ({ toasts: [...s.toasts.slice(-2), toast] }))
    setTimeout(() => get().dismiss(id), opts.timeout ?? 5000)
    return id
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
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
