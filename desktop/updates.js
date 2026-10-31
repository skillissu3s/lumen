// Lightweight update check against the GitHub releases API (electron-updater is
// not installed). On start (+10 s) and every 6 h it fetches the latest release
// tag; if it is newer than the running version, state becomes
// { available, version, url }. install() opens the release page.
const API = 'https://api.github.com/repos/skillissu3s/lumen/releases/latest'
const SIX_HOURS = 6 * 3600000

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

export function createUpdates({ getVersion, openExternal, log = console }) {
  let current = { available: false, version: null, url: null }
  const listeners = new Set()
  let timer = null
  let disposed = false

  const emit = () => {
    const snapshot = { ...current }
    for (const fn of listeners) fn(snapshot)
  }

  async function check() {
    try {
      const res = await fetch(API, {
        headers: { 'user-agent': 'lumen-desktop', accept: 'application/vnd.github+json' },
      })
      if (res.ok) {
        const release = await res.json()
        const tag = String(release.tag_name || '').replace(/^v/, '')
        const url = String(release.html_url || '')
        current = isNewer(tag, getVersion())
          ? { available: true, version: tag, url }
          : { available: false, version: null, url: null }
      }
    } catch (err) {
      log('[updates] check failed:', err && err.message ? err.message : err)
    }
    emit()
    return { ...current }
  }

  function install() {
    if (current.available && current.url) openExternal(current.url)
  }

  function start() {
    const schedule = () => {
      if (disposed) return
      timer = setTimeout(async () => {
        await check()
        schedule()
      }, SIX_HOURS)
    }
    timer = setTimeout(async () => {
      await check()
      schedule()
    }, 10000)
  }

  function dispose() {
    disposed = true
    if (timer) clearTimeout(timer)
  }

  function state() {
    return { ...current }
  }

  function onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { state, check, install, start, dispose, onChange }
}
