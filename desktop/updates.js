// Keeping the desktop app up to date. New versions are published to the public
// skillissu3s/lumen repository (see package.json → build.publish).
//
// Windows and the Linux AppImage update themselves: the new version downloads
// in the background and installs when Lumen restarts (or quits). macOS can't
// replace an app that isn't code-signed, and a .deb belongs to the system's
// package manager, so there Lumen only says a new version is out and links to it.
import { app } from 'electron'
import pkg from 'electron-updater'

const { autoUpdater } = pkg
export const DOWNLOAD_PAGE = 'https://github.com/skillissu3s/lumen/releases/latest'
const EVERY = 4 * 3600000

export function isNewer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x !== y) return x > y
  }
  return false
}

/** Can this build install updates by itself? */
export const selfUpdating = () => process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)

/**
 * state: { status: 'idle'|'checking'|'downloading'|'ready'|'available'|'error'|'off',
 *          version, progress (0–100), selfUpdating, current, error }
 * 'ready' = downloaded, installs on restart; 'available' = download it yourself.
 */
export function createUpdates({ openExternal, beforeInstall = async () => {}, log = console }) {
  const auto = selfUpdating()
  let current = { status: app.isPackaged ? 'idle' : 'off', version: null, progress: 0, selfUpdating: auto, current: app.getVersion(), error: null }
  const listeners = new Set()
  let timer = null

  const set = (patch) => {
    current = { ...current, ...patch }
    for (const fn of listeners) fn({ ...current })
  }

  autoUpdater.autoDownload = auto
  autoUpdater.autoInstallOnAppQuit = auto
  autoUpdater.logger = { info: () => {}, warn: (m) => log.warn?.('[updates]', m), error: (m) => log.error?.('[updates]', m), debug: () => {} }
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'idle', version: null }))
  autoUpdater.on('update-available', (info) => set({ status: auto ? 'downloading' : 'available', version: info.version, progress: 0 }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent || 0) }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100 }))
  autoUpdater.on('error', (err) => set({ status: 'error', error: String(err?.message || err).split('\n')[0] }))

  async function check() {
    if (!app.isPackaged) return { ...current }
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      set({ status: 'error', error: String(err?.message || err).split('\n')[0] })
    }
    return { ...current }
  }

  /** Restart into the downloaded version, or open the download page */
  async function install() {
    if (current.status === 'ready') {
      await beforeInstall()
      autoUpdater.quitAndInstall(false, true)
      return
    }
    openExternal(DOWNLOAD_PAGE)
  }

  function start() {
    if (!app.isPackaged) return
    setTimeout(check, 10000)
    timer = setInterval(check, EVERY)
  }

  function dispose() {
    if (timer) clearInterval(timer)
  }

  return { state: () => ({ ...current }), check, install, start, dispose, onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)) }
}
