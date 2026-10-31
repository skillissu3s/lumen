// A stand-in for the `window.lumen` SDK so a plugin can be opened straight in a
// browser while it is being built (open plugins/<id>/index.html via a local
// server). Lumen's plugin host strips <script data-lumen-dev> tags, so this file
// never runs inside the app. Data lives in localStorage; tasks are fake.
;(() => {
  if (window.lumen) return
  const key = (k) => `mock-lumen:${location.pathname}:${k}`
  const listeners = {}
  const today = new Date().toISOString().slice(0, 10)
  let tasks = [
    { path: 'lists/inbox.md', id: 't1', kind: 'task', status: ' ', title: '✍️ Write the quarterly report', label: 'Write the quarterly report', icon: '✍️', date: today, tags: ['work'], list: { name: 'Inbox', color: 'blue' } },
    { path: 'lists/inbox.md', id: 't2', kind: 'task', status: ' ', title: 'Read chapter 4', label: 'Read chapter 4', icon: null, tags: ['book'], list: { name: 'Inbox', color: 'blue' } },
    { path: 'lists/home.md', id: 't3', kind: 'task', status: ' ', title: '🧺 Laundry', label: 'Laundry', icon: '🧺', date: today, tags: [], list: { name: 'Home', color: 'green' } },
  ]
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => fn(data))

  const LIGHT = { '--bg': '#ffffff', '--bg-subtle': '#f8f8f9', '--bg-muted': '#f1f1f3', '--bg-hover': '#f1f1f3', '--surface': '#ffffff', '--border': '#e6e6ea', '--border-strong': '#d4d4da', '--text': '#18181b', '--text-muted': '#55555e', '--text-faint': '#9a9aa3', '--accent': '#4f46e5', '--accent-hover': '#4338ca', '--accent-soft': '#eef0ff', '--accent-text': '#ffffff', '--accent-fg': '#4338ca', '--danger': '#d92d20', '--success': '#12875a', '--warning': '#b54708', '--radius': '6px', '--radius-md': '8px', '--radius-lg': '12px', '--font': "'Inter Variable', Inter, system-ui, sans-serif", '--mono': 'ui-monospace, Consolas, monospace', '--c-green': '#30a46c', '--c-green-bg': '#e6f6ec', '--c-amber': '#e2a336', '--c-red': '#e5484d', '--c-blue': '#0090ff', '--c-gray': '#71717a', '--c-teal': '#12a594', '--c-violet': '#8e4ec6', '--c-orange': '#f76b15', '--c-pink': '#d6409f' }
  const DARK = { ...LIGHT, '--bg': '#111113', '--bg-subtle': '#161618', '--bg-muted': '#1d1d20', '--bg-hover': '#222226', '--surface': '#18181b', '--border': '#26262b', '--border-strong': '#36363d', '--text': '#ededf0', '--text-muted': '#a3a3ad', '--text-faint': '#6c6c76', '--accent': '#6e6af0', '--accent-soft': '#1f1e3a', '--accent-fg': '#a5a3f7', '--c-green-bg': '#13301f' }
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  const applyTheme = () => {
    const t = theme === 'dark' ? DARK : LIGHT
    for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(k, v)
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    emit('theme', { theme, tokens: t })
  }
  applyTheme()
  // a little dev bar: theme toggle and fake events
  addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div')
    bar.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;display:flex;gap:6px;font:12px system-ui'
    const btn = (label, fn) => {
      const b = document.createElement('button')
      b.textContent = label
      b.onclick = fn
      b.style.cssText = 'padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:#000;cursor:pointer;opacity:.75'
      bar.append(b)
    }
    btn('theme', () => {
      theme = theme === 'dark' ? 'light' : 'dark'
      applyTheme()
    })
    btn('hide/show', () => {
      emit('visibility', { visible: false })
      setTimeout(() => emit('visibility', { visible: true }), 1500)
    })
    btn('blur window', () => emit('app-focus', { focused: false }))
    document.body.append(bar)
  })

  const store = {
    get: async (k) => JSON.parse(localStorage.getItem(key(`${k}.json`)) || 'null'),
    set: async (k, v) => localStorage.setItem(key(`${k}.json`), JSON.stringify(v)),
    read: async (f) => localStorage.getItem(key(f)),
    write: async (f, t) => localStorage.setItem(key(f), t),
    append: async (f, t) => localStorage.setItem(key(f), (localStorage.getItem(key(f)) || '') + t),
    list: async (prefix = '') =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith(key(prefix)))
        .map((k) => k.slice(key('').length)),
    remove: async (f) => localStorage.removeItem(key(f)),
  }

  // fake usage data for the usage monitor: a working day of app segments
  function fakeDay(day) {
    const apps = ['Code', 'Firefox', 'Slack', 'Lumen', 'Spotify', 'Terminal', 'YouTube', 'Figma']
    let seed = [...day].reduce((a, c) => a + c.charCodeAt(0), 0)
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
    const segments = []
    let t = new Date(`${day}T09:00:00`).getTime()
    const end = new Date(`${day}T18:00:00`).getTime()
    while (t < end) {
      const len = (2 + Math.floor(rnd() * 40)) * 60000
      const app = apps[Math.floor(rnd() * apps.length)]
      segments.push({ app, title: `${app} window`, start: t, end: Math.min(end, t + len) })
      t += len + (rnd() < 0.15 ? 10 * 60000 : 0)
    }
    return { segments, idleMs: 42 * 60000, switches: segments.length }
  }

  window.lumen = {
    dev: true,
    app: { info: async () => ({ version: 'dev', mode: 'desktop', user: { handle: 'dev', name: 'Dev' }, theme }) },
    storage: store,
    tasks: {
      list: async (f = {}) => tasks.filter((t) => (!f.open || t.status === ' ') && (!f.date || t.date === f.date)),
      lists: async () => [{ path: 'lists/inbox.md', name: 'Inbox', color: 'blue' }, { path: 'lists/home.md', name: 'Home', color: 'green' }],
      create: async (t) => {
        const item = { path: t.list || 'lists/inbox.md', id: Math.random().toString(36).slice(2, 8), kind: 'task', status: ' ', label: t.title, title: t.title, tags: [], list: { name: 'Inbox', color: 'blue' }, ...t }
        tasks.push(item)
        return item
      },
      update: async (path, id, patch) => Object.assign(tasks.find((t) => t.id === id) || {}, patch),
      complete: async (path, id) => {
        const t = tasks.find((x) => x.id === id)
        if (t) t.status = 'x'
        emit('task.completed', { path, id, title: t?.title })
        return t
      },
    },
    calendar: { list: async () => [], create: async (e) => e },
    notify: async ({ title, body }) => console.log('[notify]', title, body),
    ui: {
      setStatus: async (t) => (document.title = t || 'plugin'),
      setBadge: async (b) => console.log('[badge]', b),
      open: async () => {},
    },
    system: {
      activity: {
        status: async () => ({ available: true, tracking: true, current: { app: 'Code', title: 'main.js — Lumen', since: Date.now() - 300000, idle: false } }),
        day: async (d) => fakeDay(d),
        setTracking: async () => true,
      },
    },
    on: (ev, fn) => {
      ;(listeners[ev] ||= []).push(fn)
      return () => (listeners[ev] = listeners[ev].filter((f) => f !== fn))
    },
  }
})()
