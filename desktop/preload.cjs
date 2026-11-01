// Bridges the Electron main process to the app page. Runs in a sandboxed
// renderer, so only the electron module and a few Node built-ins are available.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lumenDesktop', {
  platform: process.platform,
  titleBar: process.platform === 'win32',
  setTitleBarColors: (colors) => ipcRenderer.invoke('lumen:titlebar', colors),
  pickFolder: () => ipcRenderer.invoke('lumen:pick-folder'),
  reveal: (p) => ipcRenderer.invoke('lumen:reveal', p),
  reauth: () => ipcRenderer.invoke('lumen:reauth'),
  openServer: (url) => ipcRenderer.invoke('lumen:open-server', url),
  useLocal: () => ipcRenderer.invoke('lumen:use-local'),
  notify: (opts) => ipcRenderer.invoke('lumen:notify', opts),
  activity: {
    status: () => ipcRenderer.invoke('lumen:activity:status'),
    day: (iso) => ipcRenderer.invoke('lumen:activity:day', iso),
    setTracking: (v) => ipcRenderer.invoke('lumen:activity:set-tracking', v),
    settings: () => ipcRenderer.invoke('lumen:activity:settings'),
    setSettings: (patch) => ipcRenderer.invoke('lumen:activity:set-settings', patch),
  },
  updates: {
    state: () => ipcRenderer.invoke('lumen:updates:state'),
    check: () => ipcRenderer.invoke('lumen:updates:check'),
    install: () => ipcRenderer.invoke('lumen:updates:install'),
    onChange: (cb) => {
      const handler = (_event, state) => cb(state)
      ipcRenderer.on('lumen:updates-changed', handler)
      return () => ipcRenderer.removeListener('lumen:updates-changed', handler)
    },
  },
})
