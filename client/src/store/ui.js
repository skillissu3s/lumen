// UI chrome state: toasts, the command palette, per-view selection, and the
// command registry.

import { create } from 'zustand'

let nextToast = 1

export const useUI = create((set, get) => ({
  toasts: [],
  paletteOpen: false,
  commands: {},
  selection: {},

  toast(message, opts = {}) {
    const id = nextToast++
    const toast = { id, message, tone: opts.tone || 'default', action: opts.action }
    set((s) => ({ toasts: [...s.toasts, toast] }))
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
      const commands = { ...s.commands }
      for (const c of list) commands[c.id] = { ...c, source }
      return { commands }
    })
    return () =>
      set((s) => {
        const commands = { ...s.commands }
        for (const c of list) if (commands[c.id]?.source === source) delete commands[c.id]
        return { commands }
      })
  },

  commands() {
    return Object.values(get().commands)
  },

  setSelection(view, value) {
    set((s) => ({ selection: { ...s.selection, [view]: value } }))
  },
}))
