// The plugin bridge: manages one sandboxed iframe per enabled plugin, answers
// their permission-checked RPC calls, and feeds them theme/visibility/focus/
// command events. Logic only — the iframes themselves are positioned by
// PluginFrames.jsx and the view that calls mountTarget().

import { useWorkspace } from '../store/workspace.js'
import { useSession } from '../store/session.js'
import { useUI } from '../store/ui.js'
import { selectConfig, selectAllItems, selectLists, selectCalendars, selectPlugins } from '../store/derived.js'
import { addTask, addEvent, updateItem as patchItem } from '../lib/actions.js'
import { navigate } from '../lib/router.js'
import { isOpen, itemDay, hasTag } from '../../../shared/items.js'
import { expand } from '../../../shared/calendar.js'
import { todayIso, addDays } from '../../../shared/dates.js'
import { buildSrcdoc } from './frame.js'

const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|js|mjs|cjs|css|html|htm|svg|ics|csv|yml|yaml)$/i
const MAX_MSG = 1024 * 1024 // 1 MB
const MAX_CALLS_PER_SECOND = 50

// which permission each method needs (storage.* is always granted; network only
// affects the CSP, so it never appears here)
const REQUIRED = {
  'tasks.list': 'tasks:read',
  'tasks.lists': 'tasks:read',
  'tasks.create': 'tasks:write',
  'tasks.update': 'tasks:write',
  'tasks.complete': 'tasks:write',
  'calendar.list': 'calendar:read',
  'calendar.create': 'calendar:write',
  notify: 'notify',
  'system.activity.status': 'system:activity',
  'system.activity.day': 'system:activity',
  'system.activity.setTracking': 'system:activity',
}

let started = false
let container = null
let syncScheduled = false
let themeObserver = null
let messageBound = false
let notifyAsked = false
const frames = new Map() // id → record
const rate = new Map() // id → { start, count }

// ---------- the host lifecycle ----------

export function startHost() {
  if (started || typeof window === 'undefined') return
  started = true
  useWorkspace.subscribe(scheduleSync)
  useSession.subscribe(scheduleSync)
  bindGlobalEvents()
  sync()
}

export function attachContainer(el) {
  container = el
}

export function detachContainer() {
  container = null
}

function scheduleSync() {
  if (syncScheduled) return
  syncScheduled = true
  queueMicrotask(() => {
    syncScheduled = false
    sync()
  })
}

function disabledPlugins() {
  const file = settingsFile()
  return Array.isArray(file.plugins?.disabled) ? file.plugins.disabled : []
}

function settingsFile() {
  const handle = useSession.getState().user?.handle
  const file = handle ? useWorkspace.getState().files[`users/${handle}/settings.json`] : null
  if (!file) return {}
  try {
    return JSON.parse(file.text)
  } catch {
    return {}
  }
}

function sync() {
  const installed = selectPlugins(useWorkspace.getState())
  const disabled = disabledPlugins()
  const wanted = new Set()
  for (const p of installed) {
    if (disabled.includes(p.id)) continue
    wanted.add(p.id)
    ensureFrame(p)
  }
  for (const [id, rec] of [...frames]) {
    if (!wanted.has(id)) destroyFrame(id)
  }
}

function ensureFrame(installed) {
  const { id, manifest, granted, version } = installed
  let rec = frames.get(id)
  if (rec) {
    const updated = rec.iframe && version !== rec.version
    rec.manifest = manifest
    rec.granted = granted || []
    rec.version = version
    registerCommands(rec)
    if (updated) reloadFrame(rec)
    else if (manifest.background && !rec.iframe) createFrame(rec)
    return rec
  }
  rec = {
    id,
    manifest,
    version,
    granted: granted || [],
    iframe: null,
    state: 'loading',
    target: null,
    ro: null,
    visible: false,
    commandUnsub: null,
  }
  frames.set(id, rec)
  registerCommands(rec)
  if (manifest.background) createFrame(rec)
  return rec
}

// an updated plugin: its new files load in a fresh frame, where the old one sat
async function reloadFrame(rec) {
  const target = rec.target
  rec.ro?.disconnect()
  rec.ro = null
  rec.iframe?.remove()
  rec.iframe = null
  await createFrame(rec)
  if (target?.isConnected) showFrame(rec, target)
}

function destroyFrame(id) {
  const rec = frames.get(id)
  if (!rec) return
  rec.commandUnsub?.()
  rec.ro?.disconnect()
  if (rec.iframe) rec.iframe.remove()
  frames.delete(id)
  rate.delete(id)
}

function findInstalled(id) {
  return selectPlugins(useWorkspace.getState()).find((p) => p.id === id)
}

function registerCommands(rec) {
  rec.commandUnsub?.()
  rec.commandUnsub = null
  const cmds = (rec.manifest.commands || [])
    .filter((c) => c && c.id && c.title)
    .map((c) => ({
      id: `plugin:${rec.id}:${c.id}`,
      title: `${rec.manifest.name}: ${c.title}`,
      section: 'Plugins',
      run: () => runCommand(rec.id, c.id),
    }))
  if (cmds.length) rec.commandUnsub = useUI.getState().registerCommands(`plugin:${rec.id}`, cmds)
}

function runCommand(id, commandId) {
  const rec = frames.get(id)
  if (!rec) return
  createFrame(rec).then(() => send(rec, 'command', { id: commandId }))
}

// ---------- frames ----------

async function loadPluginFiles(id, manifest) {
  const ws = useWorkspace.getState()
  const files = {}
  for (const name of manifest.files || []) {
    if (typeof name !== 'string') continue
    const got = await ws.ensure(`plugins/${id}/${name}`)
    if (got) files[name] = got.text
  }
  return files
}

async function createFrame(rec) {
  if (rec.iframe || typeof document === 'undefined') return
  if (rec.creating) return rec.creating
  rec.creating = (async () => {
    const files = await loadPluginFiles(rec.id, rec.manifest)
    const srcdoc = buildSrcdoc({ manifest: rec.manifest, files, permissions: rec.granted, theme: currentTheme() })
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms')
    iframe.setAttribute('title', rec.manifest.name)
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;border:0;visibility:hidden;pointer-events:none;'
    iframe.srcdoc = srcdoc
    rec.iframe = iframe
    rec.state = 'loading'
    iframe.addEventListener('load', () => {
      rec.state = 'ready'
      sendTheme(rec)
    })
    iframe.addEventListener('error', () => {
      rec.state = 'error'
    })
    hostContainer().appendChild(iframe)
    bindMessageListener()
  })()
  try {
    await rec.creating
  } finally {
    rec.creating = null
  }
}

function hostContainer() {
  if (container) return container
  // a fallback so background frames work even before the shell renders PluginFrames
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:5;pointer-events:none;'
  document.body.appendChild(el)
  container = el
  return el
}

// the view calls this to say where a plugin's frame should sit
export async function mountTarget(id, element) {
  if (!element) return
  let rec = frames.get(id)
  if (!rec) {
    const p = findInstalled(id)
    if (!p) return
    rec = ensureFrame(p)
  }
  await createFrame(rec)
  showFrame(rec, element)
}

export function unmountTarget(id) {
  const rec = frames.get(id)
  if (!rec) return
  rec.target = null
  rec.visible = false
  rec.ro?.disconnect()
  rec.ro = null
  hideFrame(rec)
  send(rec, 'visibility', { visible: false })
}

export async function reloadPlugin(id) {
  const rec = frames.get(id)
  if (!rec) return
  const target = rec.target
  if (rec.iframe) {
    rec.iframe.remove()
    rec.iframe = null
  }
  rec.state = 'loading'
  await createFrame(rec)
  if (target) showFrame(rec, target)
}

export function pluginState(id) {
  return frames.get(id)?.state ?? 'error'
}

function showFrame(rec, element) {
  rec.target = element
  rec.visible = true
  positionFrame(rec)
  rec.ro?.disconnect()
  rec.ro = new ResizeObserver(() => positionFrame(rec))
  rec.ro.observe(element)
  send(rec, 'visibility', { visible: true })
}

function positionFrame(rec) {
  const iframe = rec.iframe
  if (!iframe || !rec.target || !rec.target.isConnected) return
  const rect = rec.target.getBoundingClientRect()
  iframe.style.visibility = 'visible'
  iframe.style.pointerEvents = 'auto'
  iframe.style.left = rect.left + 'px'
  iframe.style.top = rect.top + 'px'
  iframe.style.width = Math.max(0, rect.width) + 'px'
  iframe.style.height = Math.max(0, rect.height) + 'px'
}

function hideFrame(rec) {
  const iframe = rec.iframe
  if (!iframe) return
  iframe.style.visibility = 'hidden'
  iframe.style.pointerEvents = 'none'
  iframe.style.left = '0px'
  iframe.style.top = '0px'
  iframe.style.width = '1px'
  iframe.style.height = '1px'
}

// ---------- messages ----------

function bindMessageListener() {
  if (messageBound) return
  messageBound = true
  window.addEventListener('message', (event) => {
    const msg = event.data
    if (!msg || msg.lumen !== 1 || msg.id == null) return
    let rec = null
    for (const r of frames.values()) {
      if (r.iframe && event.source === r.iframe.contentWindow) {
        rec = r
        break
      }
    }
    if (!rec) return
    handleMessage(rec, msg)
  })
}

function measure(msg) {
  try {
    return JSON.stringify(msg).length
  } catch {
    return MAX_MSG + 1
  }
}

async function handleMessage(rec, msg) {
  if (measure(msg) > MAX_MSG) {
    reply(rec, msg.id, null, 'Message too large')
    return
  }
  if (!checkRate(rec.id)) {
    reply(rec, msg.id, null, 'Too many requests')
    return
  }
  try {
    const result = await dispatch(rec, msg.method, msg.params)
    reply(rec, msg.id, result, null)
  } catch (e) {
    reply(rec, msg.id, null, e && e.message ? e.message : String(e))
  }
}

function checkRate(id) {
  const now = Date.now()
  let r = rate.get(id)
  if (!r || now - r.start >= 1000) {
    r = { start: now, count: 0 }
    rate.set(id, r)
  }
  r.count++
  return r.count <= MAX_CALLS_PER_SECOND
}

function reply(rec, id, result, error) {
  const iframe = rec.iframe
  if (!iframe || !iframe.contentWindow) return
  const msg = { lumen: 1, id }
  if (error != null) msg.error = error
  else msg.result = result
  iframe.contentWindow.postMessage(msg, '*')
}

function send(rec, event, data) {
  const iframe = rec.iframe
  if (!iframe || !iframe.contentWindow) return
  iframe.contentWindow.postMessage({ lumen: 1, event, data }, '*')
}

function broadcast(event, data) {
  for (const rec of frames.values()) send(rec, event, data)
}

// ---------- events ----------

function bindGlobalEvents() {
  themeObserver = new MutationObserver(() => broadcast('theme', currentTheme()))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'data-density'] })
  window.addEventListener('focus', () => broadcast('app-focus', { focused: true }))
  window.addEventListener('blur', () => broadcast('app-focus', { focused: false }))
  window.addEventListener('scroll', () => {
    for (const rec of frames.values()) if (rec.visible) positionFrame(rec)
  }, { capture: true, passive: true })
}

function sendTheme(rec) {
  send(rec, 'theme', currentTheme())
}

function currentThemeValue() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme || 'light'
}

let tokenNames = null
function collectTokenNames() {
  if (tokenNames) return tokenNames
  const names = new Set()
  const walk = (rules) => {
    for (const rule of rules) {
      // style rules have (usually empty) cssRules too, since CSS nesting: read both
      if (rule.cssRules?.length) walk(rule.cssRules)
      if (rule.style) {
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i]
          if (p && p.startsWith('--')) names.add(p)
        }
      }
    }
  }
  for (const sheet of Array.from(document.styleSheets || [])) {
    try {
      walk(sheet.cssRules)
    } catch {
      /* cross-origin sheet */
    }
  }
  // styles may not be in yet: only remember a non-empty answer
  const list = [...names]
  if (list.length) tokenNames = list
  return list
}

function currentTheme() {
  if (typeof document === 'undefined') return { theme: 'light', tokens: {} }
  const style = getComputedStyle(document.documentElement)
  const tokens = {}
  for (const name of collectTokenNames()) tokens[name] = style.getPropertyValue(name).trim()
  return { theme: currentThemeValue(), tokens }
}

// ---------- permissions and dispatch ----------

function checkPermission(rec, method) {
  if (method.startsWith('storage.')) return
  if (method === 'ui.setStatus') {
    if (!rec.manifest.statusBar) throw new Error('Permission statusBar not granted')
    return
  }
  const need = REQUIRED[method]
  if (need && !(rec.granted || []).includes(need)) throw new Error(`Permission ${need} not granted`)
}

/** The RPC core: given a plugin record, resolve one method call. Exported for tests. */
export async function dispatch(rec, method, params = {}) {
  checkPermission(rec, method)
  switch (method) {
    case 'app.info':
      return appInfo()
    case 'storage.get':
      return storageGet(rec.id, params.key)
    case 'storage.set':
      return storageSet(rec.id, params.key, params.value)
    case 'storage.read':
      return storageRead(rec.id, params.file)
    case 'storage.write':
      return storageWrite(rec.id, params.file, params.text)
    case 'storage.append':
      return storageAppend(rec.id, params.file, params.text)
    case 'storage.list':
      return storageList(rec.id, params.prefix)
    case 'storage.remove':
      return storageRemove(rec.id, params.file)
    case 'tasks.list':
      return tasksList(params.filter)
    case 'tasks.lists':
      return tasksLists()
    case 'tasks.create':
      return tasksCreate(params.fields)
    case 'tasks.update':
      return tasksUpdate(params.path, params.id, params.patch)
    case 'tasks.complete':
      return tasksComplete(rec.id, params.path, params.id)
    case 'calendar.list':
      return calendarList(params.from, params.to)
    case 'calendar.create':
      return calendarCreate(params.fields)
    case 'notify':
      return notify(params.opts)
    case 'ui.setStatus':
      return uiSetStatus(rec.id, params.text)
    case 'ui.setBadge':
      return uiSetBadge(rec.id, params.text)
    case 'ui.open':
      return uiOpen(rec.id)
    case 'system.activity.status':
      return activityStatus()
    case 'system.activity.day':
      return activityDay(params.date)
    case 'system.activity.setTracking':
      return activitySetTracking(params.value)
    default:
      throw new Error(`Unknown method ${method}`)
  }
}

// ---------- storage ----------

function dataDir(id) {
  const handle = useSession.getState().user?.handle || 'local'
  return `data/plugins/${id}/${handle}`
}

function validateKey(key) {
  if (typeof key !== 'string') throw new Error('Storage key must be a string')
  if (!key || key.length > 200) throw new Error('Storage key must be 1–200 characters')
  if (key.includes('..')) throw new Error('Storage key may not contain ..')
  if (key.startsWith('/') || key.includes('\\')) throw new Error('Storage key must be a relative path')
  return key
}

/** Validate a storage file name; throws on anything unsafe. Exported for tests. */
export function validateStorageName(name) {
  if (typeof name !== 'string') throw new Error('Storage file name must be a string')
  if (!name || name.length > 200) throw new Error('Storage file name must be 1–200 characters')
  if (name.includes('..')) throw new Error('Storage file name may not contain ..')
  if (name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) throw new Error('Storage file name must be a relative path')
  if (!TEXT_EXT.test(name)) throw new Error('Storage files must be text files')
  return name
}

function storageJsonPath(id, key) {
  return `${dataDir(id)}/${validateKey(key)}.json`
}

function storageFilePath(id, file) {
  return `${dataDir(id)}/${validateStorageName(file)}`
}

async function writeStorageText(id, path, text) {
  const ws = useWorkspace.getState()
  const got = await ws.ensure(path)
  if (got) await ws.setText(path, text)
  else await ws.createFile(path, text)
}

async function storageGet(id, key) {
  const got = await useWorkspace.getState().ensure(storageJsonPath(id, key))
  if (!got) return null
  try {
    return JSON.parse(got.text)
  } catch {
    return null
  }
}

async function storageSet(id, key, value) {
  const text = `${JSON.stringify(value === undefined ? null : value, null, 2)}\n`
  await writeStorageText(id, storageJsonPath(id, key), text)
}

async function storageRead(id, file) {
  const got = await useWorkspace.getState().ensure(storageFilePath(id, file))
  return got ? got.text : null
}

async function storageWrite(id, file, text) {
  await writeStorageText(id, storageFilePath(id, file), String(text ?? ''))
}

async function storageAppend(id, file, text) {
  const path = storageFilePath(id, file)
  const got = await useWorkspace.getState().ensure(path)
  const next = (got ? got.text : '') + String(text ?? '')
  await writeStorageText(id, path, next)
}

async function storageList(id, prefix = '') {
  const dir = `${dataDir(id)}/`
  const pre = dir + (prefix || '')
  return useWorkspace.getState().paths.filter((p) => p.startsWith(pre) && p.length > dir.length).map((p) => p.slice(dir.length))
}

async function storageRemove(id, file) {
  const path = storageFilePath(id, file)
  const got = await useWorkspace.getState().ensure(path)
  if (got) await useWorkspace.getState().removeFile(path)
}

// ---------- tasks ----------

function plainItem(i) {
  const { source, subtasks, noteLines, ...rest } = i
  const out = { ...rest, path: i.path, list: source ? { name: source.name, color: source.color, icon: source.icon } : null }
  if (Array.isArray(subtasks) && subtasks.length) out.subtasks = subtasks.map(plainItem)
  return JSON.parse(JSON.stringify(out))
}

function tasksList(filter = {}) {
  let out = selectAllItems(useWorkspace.getState()).filter((i) => i.kind === 'task')
  if (filter.open) out = out.filter((i) => isOpen(i.status))
  if (filter.date) out = out.filter((i) => itemDay(i) === filter.date)
  if (filter.from) out = out.filter((i) => {
    const d = itemDay(i)
    return d && d >= filter.from
  })
  if (filter.to) out = out.filter((i) => {
    const d = itemDay(i)
    return d && d <= filter.to
  })
  if (filter.tag) out = out.filter((i) => hasTag(i, filter.tag))
  if (filter.list) out = out.filter((i) => i.path === filter.list)
  if (filter.q) {
    const q = String(filter.q).toLowerCase()
    out = out.filter((i) => (i.title || '').toLowerCase().includes(q) || (i.label || '').toLowerCase().includes(q))
  }
  return out.map(plainItem)
}

function tasksLists() {
  return selectLists(useWorkspace.getState()).map((l) => ({ path: l.path, name: l.name, color: l.color, icon: l.icon }))
}

function inboxPath(config) {
  const raw = config?.inbox || 'inbox'
  return raw.includes('/') ? raw : `lists/${raw}.md`
}

function defaultTaskList() {
  const cfg = settingsFile()
  if (cfg.tasks?.defaultList) return cfg.tasks.defaultList
  return inboxPath(selectConfig(useWorkspace.getState()))
}

function tasksCreate(fields = {}) {
  const { list, ...rest } = fields
  const path = list || defaultTaskList()
  const id = addTask(path, rest)
  const item = selectAllItems(useWorkspace.getState()).find((i) => i.id === id && i.path === path)
  return item ? plainItem(item) : { id, path, title: fields.title, status: ' ' }
}

async function tasksUpdate(path, id, patch = {}) {
  patchItem(path, id, patch)
}

async function tasksComplete(pluginId, path, id) {
  patchItem(path, id, { status: 'x' })
  const item = selectAllItems(useWorkspace.getState()).find((i) => i.id === id && i.path === path)
  const data = { path, id, title: item ? item.title || item.label || '' : '' }
  broadcast('task.completed', data)
  return data
}

// ---------- calendar ----------

function calendarList(from, to) {
  const state = useWorkspace.getState()
  const f = from || todayIso()
  const t = to || addDays(f, 30)
  const occs = expand(selectAllItems(state), f, t)
  return occs.map((o) => {
    const { item, ...rest } = o
    return JSON.parse(JSON.stringify({ ...rest, item: plainItem(item) }))
  })
}

function defaultCalendar() {
  const cals = selectCalendars(useWorkspace.getState())
  return (cals.find((c) => c.default) || cals[0])?.path || null
}

function calendarCreate(fields = {}) {
  const { calendar, ...rest } = fields
  const path = calendar || defaultCalendar() || 'calendars/default.md'
  const id = addEvent(path, rest)
  return { id, path }
}

// ---------- notify / ui / system ----------

async function notify(opts = {}) {
  const title = opts.title || 'Lumen'
  const body = opts.body || ''
  useUI.getState().toast(title)
  const desktop = typeof window !== 'undefined' ? window.lumenDesktop : null
  if (desktop?.notify) {
    try {
      await desktop.notify({ title, body })
    } catch {
      /* the in-app toast is enough */
    }
    return
  }
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'granted') new Notification(title, { body })
  else if (Notification.permission === 'default' && !notifyAsked) {
    notifyAsked = true
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') new Notification(title, { body })
    } catch {
      /* permission denied */
    }
  }
}

function uiSetStatus(id, text) {
  useUI.getState().setPluginStatus(id, text || '')
}

function uiSetBadge(id, text) {
  useUI.getState().setPluginBadge(id, text || '')
}

function uiOpen(id) {
  navigate(`/plugin/${id}`)
}

function appInfo() {
  const session = useSession.getState()
  return {
    version: session.info?.version || '0.1.0',
    mode: session.mode,
    user: session.user ? { handle: session.user.handle, name: session.user.name } : null,
    theme: currentThemeValue(),
  }
}

async function activityStatus() {
  const desktop = typeof window !== 'undefined' ? window.lumenDesktop : null
  if (!desktop?.activity) return { available: false }
  return desktop.activity.status()
}

async function activityDay(date) {
  const desktop = typeof window !== 'undefined' ? window.lumenDesktop : null
  if (!desktop?.activity) throw new Error('Activity is only available in the desktop app')
  return desktop.activity.day(date)
}

async function activitySetTracking(value) {
  const desktop = typeof window !== 'undefined' ? window.lumenDesktop : null
  if (!desktop?.activity) throw new Error('Activity is only available in the desktop app')
  return desktop.activity.setTracking(value)
}
