// The Electron shell: starts the Lumen server in-process on a local port, signs
// the window in as the single local user, and hosts the activity tracker and
// update checks. The app page is the same client the web server serves.
import { app, BrowserWindow, ipcMain, session, shell, dialog, Notification, powerMonitor, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { createTracker } from './activity.js'
import { createUpdates } from './updates.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const iconPath = path.join(here, 'icon.png')

// Lets tests (and portable setups) keep the profile, cookies and activity log
// out of the real app-data folder.
if (process.env.LUMEN_USER_DATA) app.setPath('userData', process.env.LUMEN_USER_DATA)

let win = null
let server = null
let tracker = null
let updates = null
let baseUrl = ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// First free port in 7720–7731. Prefer the lowest so the origin (and therefore
// the page's localStorage) stays stable across launches.
function pickPort() {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > 7731) return reject(new Error('No free port in 7720–7731'))
      const s = net.createServer()
      s.unref()
      s.once('error', () => tryPort(port + 1))
      s.listen(port, '127.0.0.1', () => {
        const chosen = s.address().port
        s.close(() => resolve(chosen))
      })
    }
    tryPort(7720)
  })
}

async function setSessionCookie(port) {
  const { desktopSessionToken } = await import('../server/desktop.js')
  const token = desktopSessionToken()
  await session.defaultSession.cookies.set({
    url: `http://127.0.0.1:${port}`,
    name: 'lumen_session',
    value: token,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400,
  })
}

const overlayColors = (dark) => (dark ? { color: '#111113', symbolColor: '#ededf0' } : { color: '#ffffff', symbolColor: '#18181b' })

async function createWindow(port) {
  baseUrl = `http://127.0.0.1:${port}`
  const dark = nativeTheme.shouldUseDarkColors
  const overlay = overlayColors(dark)

  const winOpts = {
    width: 1320,
    height: 860,
    minWidth: 420,
    minHeight: 480,
    show: false,
    backgroundColor: dark ? '#111113' : '#ffffff',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  }
  if (process.platform === 'win32') {
    winOpts.titleBarStyle = 'hidden'
    winOpts.titleBarOverlay = { ...overlay, height: 34 }
  }

  win = new BrowserWindow(winOpts)
  win.once('ready-to-show', () => win.show())

  // External links open in the browser; only the app origin navigates in-window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== baseUrl && !url.startsWith(`${baseUrl}/`)) {
      event.preventDefault()
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    }
  })

  await win.loadURL(`${baseUrl}/app.html`)

  if (process.env.LUMEN_SCREENSHOT) {
    const file = process.env.LUMEN_SCREENSHOT
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage()
        fs.writeFileSync(file, image.toPNG())
        console.log('[lumen] screenshot written to', file)
      } catch (err) {
        console.error('[lumen] screenshot failed', err)
      }
    }, 2500)
  }
}

function registerIpc() {
  ipcMain.handle('lumen:pick-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your Lumen folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('lumen:reveal', async (_event, p) => {
    const err = await shell.openPath(String(p || ''))
    return { ok: !err, error: err || '' }
  })

  ipcMain.handle('lumen:titlebar', (_event, colors) => {
    if (process.platform !== 'win32' || !win) return
    win.setTitleBarOverlay({
      height: 34,
      color: colors?.color,
      symbolColor: colors?.symbolColor,
    })
  })

  ipcMain.handle('lumen:reauth', async () => {
    await setSessionCookie(new URL(baseUrl).port)
    return { ok: true }
  })

  ipcMain.handle('lumen:notify', (_event, opts = {}) => {
    if (Notification.isSupported()) {
      new Notification({ title: String(opts.title || ''), body: String(opts.body || '') }).show()
    }
  })

  ipcMain.handle('lumen:activity:status', () => (tracker ? tracker.status() : null))
  ipcMain.handle('lumen:activity:day', (_event, iso) => (tracker ? tracker.day(String(iso)) : null))
  ipcMain.handle('lumen:activity:set-tracking', (_event, v) => (tracker ? tracker.setTracking(!!v) : null))
  ipcMain.handle('lumen:activity:settings', () => (tracker ? tracker.settings() : null))
  ipcMain.handle('lumen:activity:set-settings', (_event, patch) => (tracker ? tracker.setSettings(patch || {}) : null))

  ipcMain.handle('lumen:updates:state', () => (updates ? updates.state() : null))
  ipcMain.handle('lumen:updates:check', () => (updates ? updates.check() : null))
  ipcMain.handle('lumen:updates:install', () => (updates ? updates.install() : null))
}

async function boot() {
  process.env.LUMEN_DESKTOP = '1'
  process.env.NODE_ENV = 'production'
  process.env.DATA_DIR = process.env.LUMEN_DATA_DIR || path.join(app.getPath('userData'), 'data')
  process.env.HOST = '127.0.0.1'
  process.env.PORT = process.env.LUMEN_PORT || String(await pickPort())

  server = await import('../server/index.js')
  const port = await server.listening

  await setSessionCookie(port)
  await createWindow(port)

  tracker = createTracker({ dir: path.join(app.getPath('userData'), 'activity'), powerMonitor })
  tracker.start()

  updates = createUpdates({
    getVersion: () => app.getVersion(),
    openExternal: (url) => shell.openExternal(url),
  })
  updates.onChange((state) => win?.webContents.send('lumen:updates-changed', state))
  updates.start()

  registerIpc()

  powerMonitor.on('resume', () => tracker?.onResume())
}

const gotLock = app.requestSingleInstanceLock()

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  ;(async () => {
    try {
      tracker?.dispose()
    } catch {}
    try {
      updates?.dispose()
    } catch {}
    try {
      if (server) await Promise.race([server.stopServer(), sleep(10000)])
    } catch {}
    app.exit(0)
  })()
})

if (!gotLock) {
  app.quit()
} else {
  app.whenReady()
    .then(boot)
    .catch((err) => {
      dialog.showErrorBox('Lumen failed to start', String((err && err.stack) || err))
      app.exit(1)
    })
}
