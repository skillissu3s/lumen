// The JavaScript injected into every plugin frame, defining `window.lumen` over
// postMessage RPC. Kept as a string (no backticks or `${}` inside) so it can be
// pasted into a <script> tag inside a srcdoc without escaping.

export const SDK_SOURCE = `;(() => {
  if (window.lumen) return
  const listeners = {}
  const pending = {}
  let nextId = 1

  const toError = (e) => {
    const msg = typeof e === 'string' ? e : (e && e.message) || 'Lumen error'
    return new Error(msg)
  }

  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending[id] = { resolve, reject }
      window.parent.postMessage({ lumen: 1, id, method, params }, '*')
    })

  const applyTheme = (data) => {
    if (!data) return
    if (data.theme) {
      document.documentElement.dataset.theme = data.theme
      document.documentElement.style.colorScheme = data.theme
    }
    if (data.tokens) {
      const style = document.documentElement.style
      for (const k in data.tokens) style.setProperty(k, data.tokens[k])
    }
  }

  const emit = (event, data) => {
    const fns = listeners[event]
    if (!fns) return
    for (const fn of fns) {
      try { fn(data) } catch (e) { /* one listener failing shouldn't stop the rest */ }
    }
  }

  const on = (event, fn) => {
    ;(listeners[event] ||= []).push(fn)
    return () => {
      listeners[event] = (listeners[event] || []).filter((f) => f !== fn)
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data
    if (!msg || msg.lumen !== 1) return
    if (msg.id) {
      const p = pending[msg.id]
      if (!p) return
      delete pending[msg.id]
      if (msg.error !== undefined) p.reject(toError(msg.error))
      else p.resolve(msg.result)
    } else if (msg.event) {
      emit(msg.event, msg.data)
    }
  })

  window.lumen = {
    dev: false,
    app: { info: () => call('app.info', {}) },
    storage: {
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      read: (file) => call('storage.read', { file }),
      write: (file, text) => call('storage.write', { file, text }),
      append: (file, text) => call('storage.append', { file, text }),
      list: (prefix = '') => call('storage.list', { prefix }),
      remove: (file) => call('storage.remove', { file }),
    },
    tasks: {
      list: (filter = {}) => call('tasks.list', { filter }),
      lists: () => call('tasks.lists', {}),
      create: (fields = {}) => call('tasks.create', { fields }),
      update: (path, id, patch = {}) => call('tasks.update', { path, id, patch }),
      complete: (path, id) => call('tasks.complete', { path, id }),
    },
    calendar: {
      list: ({ from, to } = {}) => call('calendar.list', { from, to }),
      create: (fields = {}) => call('calendar.create', { fields }),
    },
    notify: (opts = {}) => call('notify', { opts }),
    ui: {
      setStatus: (text) => call('ui.setStatus', { text }),
      setBadge: (text) => call('ui.setBadge', { text }),
      open: () => call('ui.open', {}),
    },
    system: {
      activity: {
        status: () => call('system.activity.status', {}),
        day: (date) => call('system.activity.day', { date }),
        setTracking: (value) => call('system.activity.setTracking', { value }),
      },
    },
    on,
  }

  on('theme', applyTheme)
})()
`
