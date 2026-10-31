// Per-person preferences, read from users/<handle>/settings.json and deep-merged
// over defaults. applyTheme mirrors them onto <html>.

import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useWorkspace } from './workspace.js'
import { useSession } from './session.js'

const h12 = typeof navigator !== 'undefined' && /^en-US$/i.test(navigator.language || '')

export const DEFAULT_PREFS = {
  theme: 'system',
  accent: 'indigo',
  density: 'default',
  weekStart: 1,
  timeFormat: h12 ? '12h' : '24h',
  calendar: {
    view: 'week',
    dayStart: 6,
    dayEnd: 23,
    hourHeight: 48,
    snap: 15,
    defaultDuration: 30,
    showWeekends: true,
    showWeekNumbers: false,
    showCompleted: true,
    showTasks: true,
    colorBy: 'calendar',
    workStart: 9,
    workEnd: 17,
    highlightWork: true,
    timeline: { showGaps: true },
    hidden: [],
    defaultCalendar: null,
  },
  tasks: { defaultList: null, showCompleted: false, view: 'list', groupBy: 'section', sort: 'manual' },
  plugins: { disabled: [] },
  sidebar: { collapsed: false },
}

function deepMerge(base, patch) {
  if (patch == null || Array.isArray(patch) || typeof patch !== 'object') return patch
  const out = base != null && !Array.isArray(base) && typeof base === 'object' ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = deepMerge(out[k], v)
  }
  return out
}

const prefsStore = createStore(() => ({ prefs: DEFAULT_PREFS }))

export function usePrefs() {
  return useStore(prefsStore, (s) => s.prefs)
}

function currentPrefs() {
  const user = useSession.getState().user
  const handle = user?.handle
  const file = handle ? useWorkspace.getState().files[`users/${handle}/settings.json`] : null
  let raw = {}
  if (file) {
    try {
      raw = JSON.parse(file.text)
    } catch {
      /* ignore a broken settings file */
    }
  }
  return deepMerge(DEFAULT_PREFS, raw)
}

function syncPrefs() {
  const next = currentPrefs()
  if (next !== prefsStore.getState().prefs) prefsStore.setState({ prefs: next })
}

useWorkspace.subscribe(syncPrefs)
useSession.subscribe(syncPrefs)
syncPrefs()

/** Deep-merge a patch into the current preferences and save it. */
export async function setPrefs(patch) {
  const handle = useSession.getState().user?.handle
  if (!handle) return
  const path = `users/${handle}/settings.json`
  const ws = useWorkspace.getState()
  if (ws.files[path]) {
    await ws.edit(path, (text) => {
      let cur = {}
      try {
        cur = JSON.parse(text)
      } catch {
        /* start fresh */
      }
      return `${JSON.stringify(deepMerge(cur, patch), null, 2)}\n`
    })
  } else {
    await ws.createFile(path, `${JSON.stringify(patch, null, 2)}\n`)
  }
  prefsStore.setState({ prefs: deepMerge(prefsStore.getState().prefs, patch) })
}

/** Put theme/accent/density on <html>, resolving "system" and following it. */
export function applyTheme(prefs) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
  const resolve = () => {
    const theme = prefs.theme === 'system' ? (mq && mq.matches ? 'dark' : 'light') : prefs.theme
    root.dataset.theme = theme
    try {
      localStorage.setItem('lumen.theme', theme)
    } catch {
      /* storage unavailable */
    }
  }
  resolve()
  if (prefs.theme === 'system' && mq && mq.addEventListener) mq.addEventListener('change', resolve)
  root.dataset.accent = prefs.accent
  root.dataset.density = prefs.density
}
