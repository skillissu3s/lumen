// Computer-usage tracker for the desktop app (used by the Usage Monitor plugin).
// Samples the foreground app, merges runs of the same app into segments, and
// appends finished segments as JSON lines to one file per day under <dir>. The
// pure parts (buildSegments, splitByMidnight, summarizeDay) are exported for
// desktop/activity.test.js; the live sampling is wired to the Electron
// powerMonitor that main.js injects, so this module stays importable from plain
// Node.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const IDLE_APP = 'Idle'
export const PRIVATE_APP = 'Private'

const SAMPLE_MS = 5000
const FLUSH_MS = 60000
const RETENTION_DAYS = 90
const DAY_MS = 86400000

// ---------- pure helpers ----------

export function localIso(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function nextLocalMidnight(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

function classify(sample, idleSeconds, excluded, recordTitles) {
  if (typeof sample.idle === 'number' && sample.idle >= idleSeconds) return { app: IDLE_APP }
  if (excluded.has(sample.app)) return { app: PRIVATE_APP }
  if (recordTitles && sample.title) return { app: sample.app, title: sample.title }
  return { app: sample.app }
}

const close = (cur, end) => ({ app: cur.app, ...(cur.title ? { title: cur.title } : {}), start: cur.start, end })

// Merge samples into segments. Each sample is { at, app, title?, idle? } where
// idle is the system idle seconds. A segment's end is the time the next sample
// of a different app arrived; the last segment ends at the last sample's time.
// Idle samples (idle >= idleSeconds) and excluded apps become Idle / Private.
export function buildSegments(samples, { idleSeconds = 120, recordTitles = false, excluded = [] } = {}) {
  const excludedSet = new Set(excluded)
  const segments = []
  let cur = null
  for (const s of samples) {
    const r = classify(s, idleSeconds, excludedSet, recordTitles)
    if (cur && cur.app === r.app && (!recordTitles || (cur.title || '') === (r.title || ''))) {
      if (recordTitles && r.title) cur.title = r.title
      continue
    }
    if (cur) segments.push(close(cur, s.at))
    cur = { app: r.app, ...(r.title ? { title: r.title } : {}), start: s.at }
  }
  if (cur) segments.push(close(cur, samples.length ? samples[samples.length - 1].at : cur.start))
  return segments
}

// Split segments at local midnight, yielding { iso, segment } entries, so a
// segment that crosses midnight lands in both day files.
export function splitByMidnight(segments) {
  const out = []
  for (const seg of segments) {
    let start = seg.start
    while (start < seg.end) {
      const end = Math.min(seg.end, nextLocalMidnight(start))
      out.push({ iso: localIso(start), segment: { ...seg, start, end } })
      start = end
    }
  }
  return out
}

function countSwitches(active) {
  let n = 0
  for (let i = 1; i < active.length; i++) if (active[i].app !== active[i - 1].app) n++
  return n
}

// Summarise a day's segments: active (non-idle) segments, total idle ms, and
// how many times the active app changed.
export function summarizeDay(segments) {
  const active = []
  let idleMs = 0
  for (const seg of segments) {
    if (seg.app === IDLE_APP) idleMs += Math.max(0, seg.end - seg.start)
    else active.push(seg)
  }
  return { segments: active, idleMs, switches: countSwitches(active) }
}

// ---------- tracker ----------

const defaultSettings = () => ({ tracking: true, idleSeconds: 120, recordTitles: false, excluded: [] })

function loadSettings(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    return {
      tracking: typeof raw.tracking === 'boolean' ? raw.tracking : true,
      idleSeconds: Number.isFinite(raw.idleSeconds) ? Math.max(30, raw.idleSeconds) : 120,
      recordTitles: !!raw.recordTitles,
      excluded: Array.isArray(raw.excluded) ? raw.excluded.map(String) : [],
    }
  } catch {
    return defaultSettings()
  }
}

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

export function createTracker({ dir, powerMonitor, log = console, now = Date.now }) {
  fs.mkdirSync(dir, { recursive: true })
  pruneOld(dir, now())

  const cfg = loadSettings(dir)
  let available = true
  let current = null // open segment: { app, title?, start }
  let latest = null // last foreground sample from the OS
  let child = null
  let restartTimer = null
  let tickTimer = null
  let flushTimer = null
  let backoff = 1000
  let lastFlush = 0
  let disposed = false

  const excludedSet = () => new Set(cfg.excluded)

  function persist() {
    try {
      fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(cfg))
    } catch {}
  }

  function markUnavailable(err) {
    if (err) log('[activity] unavailable:', err && err.message ? err.message : err)
    available = false
    stopTicking()
  }

  function onForeground(sample) {
    if (!sample || !sample.app) return
    latest = sample
    backoff = 1000
  }

  function parseLine(line) {
    try {
      const o = JSON.parse(line)
      const app = String(o.app || o.exe || '').trim()
      if (!app) return null
      return { app, title: typeof o.title === 'string' && o.title ? o.title : undefined }
    } catch {
      return null
    }
  }

  function startWindows() {
    try {
      // Read the script from disk (works from inside the asar) and run it from a
      // temp file, because PowerShell can't execute a script inside app.asar.
      const script = fs.readFileSync(new URL('./activity-win.ps1', import.meta.url), 'utf8')
      const tmp = path.join(os.tmpdir(), 'lumen-activity-win.ps1')
      fs.writeFileSync(tmp, script)
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      let buf = ''
      child.stdout.on('data', (d) => {
        buf += d.toString('utf8')
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/^\uFEFF/, '').trim()
          buf = buf.slice(i + 1)
          if (line) onForeground(parseLine(line))
        }
      })
      child.on('exit', () => {
        child = null
        if (!disposed) scheduleRestart()
      })
      child.on('error', () => {
        child = null
        if (!disposed) scheduleRestart()
      })
    } catch (err) {
      markUnavailable(err)
    }
  }

  function scheduleRestart() {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (!disposed) startWindows()
    }, backoff)
    backoff = Math.min(backoff * 2, 30000)
  }

  function sampleForeground() {
    try {
      if (isMac) {
        const out = spawnSync('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeout: 3000 })
        if (out.status === 0 && out.stdout) {
          const app = out.stdout.toString().trim()
          if (app) onForeground({ app })
        }
      } else if (isLinux) {
        const id = spawnSync('xdotool', ['getactivewindow'], { timeout: 3000 })
        if (id.status !== 0) return
        const winId = id.stdout.toString().trim()
        const title = spawnSync('xdotool', ['getwindowname', winId], { timeout: 3000 }).stdout.toString().trim()
        const wm = spawnSync('xprop', ['-id', winId, 'WM_CLASS'], { timeout: 3000 }).stdout.toString()
        const m = /WM_CLASS\(STRING\) = "([^"]*)", "([^"]*)"/.exec(wm)
        const app = m && (m[2] || m[1]) ? m[2] || m[1] : title
        if (app) onForeground({ app, title })
      }
    } catch {
      // a single failed sample is not fatal; keep the previous one
    }
  }

  function appendSegments(seg) {
    for (const { iso, segment } of splitByMidnight([seg])) {
      try {
        fs.appendFileSync(path.join(dir, `${iso}.jsonl`), JSON.stringify(segment) + '\n')
      } catch {}
    }
  }

  function finishCurrent(end) {
    if (!current) return
    if (end > current.start) appendSegments(close(current, end))
    current = null
  }

  function flushCurrent() {
    if (!current) return
    const seg = close(current, now())
    if (seg.end <= seg.start) return
    try {
      fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(seg))
    } catch {}
  }

  function tick() {
    if (disposed || !available) return
    if (isMac || isLinux) sampleForeground()

    const t = now()
    let idleSecs = 0
    try {
      if (typeof powerMonitor?.getSystemIdleTime === 'function') idleSecs = powerMonitor.getSystemIdleTime() || 0
    } catch {}

    const idle = idleSecs >= cfg.idleSeconds
    let app
    let title
    if (idle) {
      app = IDLE_APP
    } else if (latest) {
      app = excludedSet().has(latest.app) ? PRIVATE_APP : latest.app
      if (cfg.recordTitles) title = latest.title
    } else {
      return // no foreground data yet — wait for the sampler
    }

    const same = current && current.app === app && (!cfg.recordTitles || (current.title || '') === (title || ''))
    if (current && !same) finishCurrent(t)
    if (!current) current = { app, ...(title ? { title } : {}), start: t }
    if (t - lastFlush >= FLUSH_MS) {
      flushCurrent()
      lastFlush = t
    }
  }

  function markIdleNow() {
    if (disposed || !available) return
    const t = now()
    if (current && current.app !== IDLE_APP) finishCurrent(t)
    if (!current) current = { app: IDLE_APP, start: t }
  }

  function startTicking() {
    if (tickTimer) return
    lastFlush = now()
    if (isWindows) startWindows()
    tickTimer = setInterval(tick, SAMPLE_MS)
    flushTimer = setInterval(flushCurrent, FLUSH_MS)
  }

  function stopTicking() {
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    if (child) {
      child.kill()
      child = null
    }
    current = null
  }

  function samplerAvailable() {
    if (isWindows || isMac) return true
    if (isLinux) {
      try {
        spawnSync('xdotool', ['--version'], { stdio: 'ignore', timeout: 3000 })
        return true
      } catch {
        return false
      }
    }
    return false
  }

  function readSegments(iso) {
    const out = []
    try {
      const text = fs.readFileSync(path.join(dir, `${iso}.jsonl`), 'utf8')
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const o = JSON.parse(line)
          if (o && typeof o.app === 'string' && Number.isFinite(o.start) && Number.isFinite(o.end)) {
            out.push({ app: o.app, ...(o.title ? { title: o.title } : {}), start: o.start, end: o.end })
          }
        } catch {}
      }
    } catch {}
    return out
  }

  function restoreCurrent() {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'))
      if (o && typeof o.app === 'string' && Number.isFinite(o.start) && localIso(o.start) === localIso(now())) {
        current = { app: o.app, ...(o.title ? { title: o.title } : {}), start: o.start }
      }
    } catch {}
  }

  function pruneOld(dir, nowMs) {
    const cutoff = localIso(nowMs - RETENTION_DAYS * DAY_MS)
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < cutoff) {
        try {
          fs.unlinkSync(path.join(dir, name))
        } catch {}
      }
    }
  }

  function status() {
    return {
      available,
      tracking: cfg.tracking,
      current: current
        ? { app: current.app, ...(current.title ? { title: current.title } : {}), since: current.start, idle: current.app === IDLE_APP }
        : null,
    }
  }

  function day(iso) {
    const segments = readSegments(iso)
    if (iso === localIso(now()) && current) segments.push(close(current, now()))
    return summarizeDay(segments)
  }

  function setTracking(v) {
    v = !!v
    if (v === cfg.tracking) return v
    cfg.tracking = v
    persist()
    if (v) {
      startTicking()
    } else {
      finishCurrent(now())
      stopTicking()
    }
    return v
  }

  function settings() {
    return { idleSeconds: cfg.idleSeconds, recordTitles: cfg.recordTitles, excluded: [...cfg.excluded] }
  }

  function setSettings(patch) {
    if (patch && typeof patch === 'object') {
      if (Number.isFinite(patch.idleSeconds)) cfg.idleSeconds = Math.max(30, Math.round(patch.idleSeconds))
      if (typeof patch.recordTitles === 'boolean') cfg.recordTitles = patch.recordTitles
      if (Array.isArray(patch.excluded)) cfg.excluded = patch.excluded.map(String)
    }
    persist()
    return settings()
  }

  function start() {
    if (!samplerAvailable()) {
      markUnavailable(new Error('no foreground sampler on this platform'))
      return
    }
    restoreCurrent()
    if (cfg.tracking) startTicking()
  }

  function dispose() {
    disposed = true
    stopTicking()
    if (restartTimer) clearTimeout(restartTimer)
  }

  if (powerMonitor && typeof powerMonitor.on === 'function') {
    powerMonitor.on('lock-screen', markIdleNow)
    powerMonitor.on('suspend', markIdleNow)
    powerMonitor.on('unlock-screen', tick)
  }

  return { start, dispose, status, day, setTracking, settings, setSettings, onResume: tick }
}
