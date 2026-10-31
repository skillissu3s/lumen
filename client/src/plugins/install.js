// Installing plugins from the catalog, GitHub or a folder, and uninstalling.
// Everything the Settings → Plugins page needs to read and drive installs.

import { useWorkspace } from '../store/workspace.js'
import { useSession } from '../store/session.js'
import { selectConfig, selectPlugins } from '../store/derived.js'
import { validateManifest } from './manifest.js'

const MAX_FILE = 512 * 1024 // 512 KB
const MAX_TOTAL = 2 * 1024 * 1024 // 2 MB
const TEXT_EXT = /\.(md|markdown|txt|json|jsonl|js|mjs|cjs|css|html|htm|svg|ics|csv|yml|yaml)$/i

/** Readable phrases for the install-permissions dialog. */
export const PERMISSION_DESCRIPTIONS = {
  storage: 'Read and write its own files',
  'tasks:read': 'Read your tasks',
  'tasks:write': 'Create, change and complete tasks',
  'calendar:read': 'Read your calendar',
  'calendar:write': 'Create and change events',
  notify: 'Send you notifications',
  'system:activity': 'See which apps you use on this computer',
  network: 'Connect to the internet',
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status})`)
  return res.json()
}

async function fetchText(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status})`)
  return res.text()
}

/** The starter plugins that ship with Lumen: [{ manifest, path, source, installed, updateAvailable }]. */
export async function loadCatalog() {
  const registry = await fetchJson('catalog/registry.json')
  const installed = new Map(selectPlugins(useWorkspace.getState()).map((p) => [p.id, p]))
  const list = []
  for (const entry of registry.plugins || []) {
    const manifest = await fetchJson(`catalog/${entry.path}/manifest.json`)
    const inst = installed.get(manifest.id)
    list.push({
      manifest,
      path: entry.path,
      source: 'catalog',
      installed: !!inst,
      updateAvailable: !!inst && !!inst.manifest?.version && manifest.version !== inst.manifest.version,
    })
  }
  return list
}

/** manifest + files for one catalog plugin (for installing it). */
export async function fetchCatalogPlugin(path) {
  const manifest = await fetchJson(`catalog/${path}/manifest.json`)
  const files = { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` }
  for (const name of manifest.files || []) files[name] = await fetchText(`catalog/${path}/${name}`)
  return { manifest, files }
}

// ---------- GitHub ----------

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/')
}

function decodeBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function ghGet(token, owner, repo, path, ref) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`
  const headers = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers })
  if (res.status === 404) throw new Error(`Not found in the repository: ${path}`)
  if (!res.ok) throw new Error(`GitHub request failed (${res.status})`)
  return res.json()
}

function parseGitHubRef(input) {
  let s = String(input || '').trim().replace(/^https?:\/\/github\.com\//, '')
  if (!s) throw new Error('Enter a repository as owner/repo')
  let ref = null
  const at = s.lastIndexOf('@')
  if (at > 0) {
    const tail = s.slice(at + 1)
    if (tail && !tail.includes('/')) {
      ref = tail
      s = s.slice(0, at)
    }
  }
  const parts = s.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('Enter a repository as owner/repo')
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, ''), sub: parts.slice(2).join('/'), ref }
}

/** `fetchFromGitHub('owner/repo[/sub/path][@ref]')` → { manifest, files }. */
export async function fetchFromGitHub(input) {
  const { owner, repo, sub, ref } = parseGitHubRef(input)
  const token = useSession.getState().github?.token || null
  const manifestPath = sub ? `${sub}/manifest.json` : 'manifest.json'
  const raw = await ghGet(token, owner, repo, manifestPath, ref)
  let manifest
  try {
    manifest = JSON.parse(decodeBase64(raw.content))
  } catch {
    throw new Error('manifest.json is not valid JSON')
  }
  const files = { 'manifest.json': decodeBase64(raw.content) }
  for (const name of manifest.files || []) {
    if (typeof name !== 'string') continue
    const item = await ghGet(token, owner, repo, sub ? `${sub}/${name}` : name, ref)
    files[name] = decodeBase64(item.content)
  }
  return { manifest, files }
}

// ---------- folder ----------

/** `readFromFolder(FileList)` from `<input type="file" webkitdirectory>` → { manifest, files }. */
export async function readFromFolder(fileList) {
  const files = {}
  for (const file of Array.from(fileList || [])) {
    const parts = (file.webkitRelativePath || file.name || '').split('/')
    if (parts.length > 1) parts.shift() // strip the picked root folder
    const name = parts.join('/')
    if (name) files[name] = await file.text()
  }
  if (!files['manifest.json']) throw new Error('That folder has no manifest.json')
  let manifest
  try {
    manifest = JSON.parse(files['manifest.json'])
  } catch {
    throw new Error('manifest.json is not valid JSON')
  }
  return { manifest, files }
}

// ---------- install / uninstall / update ----------

async function setPluginEntry(id, entry) {
  const ws = useWorkspace.getState()
  const path = 'lumen.json'
  const got = await ws.ensure(path)
  if (got) {
    await ws.edit(path, (text) => {
      let cfg = {}
      try {
        cfg = JSON.parse(text)
      } catch {
        /* start fresh */
      }
      cfg.plugins = { ...(cfg.plugins || {}), [id]: entry }
      return `${JSON.stringify(cfg, null, 2)}\n`
    })
  } else {
    await ws.createFile(path, `${JSON.stringify({ version: 1, plugins: { [id]: entry } }, null, 2)}\n`)
  }
}

/** Write every file to plugins/<id>/… and record { version, permissions, source } in lumen.json. */
export async function installPlugin({ manifest, files = {} }, grantedPermissions, source = 'manual') {
  const checked = validateManifest(manifest)
  if (!checked.ok) throw new Error(checked.errors[0] || 'Invalid plugin')
  const id = manifest.id
  const all = { ...files }
  if (!all['manifest.json']) all['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`
  let total = 0
  for (const [name, text] of Object.entries(all)) {
    if (!TEXT_EXT.test(name)) throw new Error(`${name} is not a text file`)
    const clean = name.replace(/\\/g, '/')
    if (clean.includes('..') || clean.startsWith('/')) throw new Error(`${name} is not a safe file name`)
    const size = new TextEncoder().encode(String(text ?? '')).length
    if (size > MAX_FILE) throw new Error(`${name} is larger than 512 KB`)
    total += size
    if (total > MAX_TOTAL) throw new Error('The plugin is larger than 2 MB in total')
  }
  const ws = useWorkspace.getState()
  for (const [name, text] of Object.entries(all)) {
    const path = `plugins/${id}/${name}`
    const got = await ws.ensure(path)
    if (got) await ws.setText(path, String(text ?? ''))
    else await ws.createFile(path, String(text ?? ''))
  }
  const entry = { version: manifest.version, permissions: grantedPermissions ?? manifest.permissions ?? [], source }
  await setPluginEntry(id, entry)
  return { id, manifest, granted: entry.permissions }
}

/** Install over an existing plugin (the caller re-asks when permissions grew). */
export async function updatePlugin({ manifest, files }, grantedPermissions, source = 'manual') {
  return installPlugin({ manifest, files }, grantedPermissions, source)
}

/** Remove the plugin's files and its lumen.json entry; its data stays. */
export async function uninstallPlugin(id) {
  const ws = useWorkspace.getState()
  const prefix = `plugins/${id}/`
  for (const p of ws.paths) {
    if (!p.startsWith(prefix)) continue
    const got = await ws.ensure(p)
    if (got) await ws.removeFile(p)
  }
  const path = 'lumen.json'
  const got = await ws.ensure(path)
  if (got) {
    await ws.edit(path, (text) => {
      let cfg = {}
      try {
        cfg = JSON.parse(text)
      } catch {
        /* nothing to edit */
      }
      if (cfg.plugins) {
        delete cfg.plugins[id]
        if (!Object.keys(cfg.plugins).length) delete cfg.plugins
      }
      return `${JSON.stringify(cfg, null, 2)}\n`
    })
  }
}
