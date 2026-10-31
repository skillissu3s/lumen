// Minimal IndexedDB key-value store used as the GitHub blob cache. Every call
// no-ops when IndexedDB isn't available (private mode, tests, some browsers).

const DB = 'lumen'
const STORE = 'cache'

function open() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req
    try {
      req = indexedDB.open(DB, 1)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

let dbPromise
function getDb() {
  if (!dbPromise) dbPromise = open()
  return dbPromise
}

function tx(db, mode, run) {
  return new Promise((resolve) => {
    let req
    try {
      req = run(db.transaction(STORE, mode).objectStore(STORE))
    } catch {
      return resolve(undefined)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(undefined)
  })
}

export async function idbGet(key) {
  const db = await getDb()
  if (!db) return undefined
  return tx(db, 'readonly', (store) => store.get(key))
}

export async function idbSet(key, value) {
  const db = await getDb()
  if (!db) return
  await tx(db, 'readwrite', (store) => store.put(value, key))
}

export async function idbDel(key) {
  const db = await getDb()
  if (!db) return
  await tx(db, 'readwrite', (store) => store.delete(key))
}
