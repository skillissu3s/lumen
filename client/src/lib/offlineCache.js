// This browser's copy of a workspace, so the app opens and works without a
// connection. IndexedDB holds, per signed-in person, every loaded file as the
// server last confirmed it ({ text, sha }); edits not sent yet are kept apart
// (the workspace store's pending list), so the two never blur. localStorage
// holds who was signed in, so the app knows whose copy to open. Signing out
// clears both.

const DB = 'lumen'
const STORE = 'workspaces'
const SESSION = 'lumen.session'

let opening = null
function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  opening ||= new Promise((resolve) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return opening
}

async function run(mode, fn) {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    let out = null
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    if (req) req.onsuccess = () => (out = req.result ?? null)
    tx.oncomplete = () => resolve(out)
    tx.onerror = () => resolve(null)
    tx.onabort = () => resolve(null)
  })
}

/** The copy for `scope`: { paths, files: { path: { text, sha } }, savedAt } or null */
export const readCopy = (scope) => run('readonly', (s) => s.get(scope))

/** Replaces the copy for `scope` */
export const writeCopy = (scope, copy) => run('readwrite', (s) => s.put({ ...copy, savedAt: Date.now() }, scope))

/** Forgets every copy (signing out) */
export const clearCopies = () => run('readwrite', (s) => s.clear())

/** Who was signed in here last: { mode, user, info } */
export function lastSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION) || 'null')
  } catch {
    return null
  }
}

export function rememberSession(session) {
  try {
    if (session) localStorage.setItem(SESSION, JSON.stringify(session))
    else localStorage.removeItem(SESSION)
  } catch {
    /* storage unavailable */
  }
}
