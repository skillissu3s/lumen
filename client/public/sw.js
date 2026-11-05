// Lets Lumen open without a connection: the page and its scripts, styles and
// fonts are kept in a cache. Data never is: the API, the socket and the plugin
// catalog always go to the server (the app keeps its own copy of the workspace;
// see src/lib/offlineCache.js). The build writes the list of files to keep
// (sw-assets.json) and stamps this file, so every release installs afresh.

const BUILD = '__LUMEN_BUILD__'
const CACHE = `lumen-${BUILD}`
const SCOPE = new URL(self.registration.scope).pathname
const NEVER = /^(api|ws|catalog|healthz)(\/|$)/

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      let files = []
      try {
        files = await (await fetch('sw-assets.json', { cache: 'no-store' })).json()
      } catch {
        /* no list (a development build): pages and files are kept as they load */
      }
      // one file failing to come shouldn't stop the rest
      await Promise.all(['app.html', ...files].map((f) => cache.add(f).catch(() => {})))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('lumen-') && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return
  if (NEVER.test(url.pathname.slice(SCOPE.length))) return

  if (req.mode === 'navigate') {
    // the page: the newest when the server answers soon, the kept one when it
    // doesn't (a server that's down can take seconds to say so)
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const kept = () => cache.match(url.pathname).then((r) => r || cache.match('app.html'))
        const network = fetch(req).then((res) => {
          if (res.ok) cache.put(url.pathname, res.clone())
          return res
        })
        network.catch(() => {}) // (when the kept copy is used, a late failure is fine)
        const slow = new Promise((resolve) => setTimeout(() => resolve(null), 1500))
        try {
          const first = await Promise.race([network, slow])
          if (first) return first
          return (await kept()) || (await network)
        } catch {
          return (await kept()) || Response.error()
        }
      })(),
    )
    return
  }

  // scripts, styles, fonts: their names change when they do, so the kept copy is right
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const kept = await cache.match(req)
      if (kept) return kept
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') cache.put(req, res.clone())
      return res
    })(),
  )
})
