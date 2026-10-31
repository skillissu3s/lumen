// Validate a plugin manifest.json against the PLUGINS.md contract.

const ID_RE = /^[a-z0-9-]+$/
const KNOWN_PERMISSIONS = ['storage', 'tasks:read', 'tasks:write', 'calendar:read', 'calendar:write', 'notify', 'system:activity', 'network']
const MAX_FILES = 50

/** `validateManifest(obj)` → { ok, errors, manifest } */
export function validateManifest(obj) {
  const errors = []
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['the manifest must be a JSON object'], manifest: null }
  }
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) errors.push('id must be lowercase letters, digits and dashes')
  if (typeof obj.name !== 'string' || !obj.name.trim()) errors.push('name is required')
  if (typeof obj.version !== 'string' || !obj.version.trim()) errors.push('version is required')
  if (typeof obj.entry !== 'string' || !obj.entry.trim()) errors.push('entry is required')
  if (!Array.isArray(obj.files) || !obj.files.length) {
    errors.push('files must list every file of the plugin')
  } else {
    if (obj.files.length > MAX_FILES) errors.push(`at most ${MAX_FILES} files`)
    else if (obj.files.some((f) => typeof f !== 'string' || !f)) errors.push('every file name must be a string')
    else if (typeof obj.entry === 'string' && !obj.files.includes(obj.entry)) errors.push('files must include the entry file')
  }
  if (obj.permissions != null) {
    if (!Array.isArray(obj.permissions)) errors.push('permissions must be an array')
    else for (const p of obj.permissions) if (typeof p !== 'string' || !KNOWN_PERMISSIONS.includes(p)) errors.push(`unknown permission: ${p}`)
  }
  if (obj.icon != null && typeof obj.icon !== 'string') errors.push('icon must be a string')
  if (obj.background != null && typeof obj.background !== 'boolean') errors.push('background must be a boolean')
  if (obj.statusBar != null && typeof obj.statusBar !== 'boolean') errors.push('statusBar must be a boolean')
  if (obj.view != null) {
    if (typeof obj.view !== 'object' || Array.isArray(obj.view)) errors.push('view must be an object')
    else if (obj.view.icon != null && typeof obj.view.icon !== 'string') errors.push('view.icon must be a string')
  }
  if (obj.commands != null) {
    if (!Array.isArray(obj.commands)) errors.push('commands must be an array')
    else if (obj.commands.some((c) => !c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.title !== 'string')) errors.push('each command needs an id and a title')
  }
  const ok = errors.length === 0
  return { ok, errors, manifest: ok ? obj : null }
}
