// The Lumen server: express + ws, serving the API, the built client and (on the
// desktop) an embedded local instance.
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESKTOP, HOST, PORT, WORKSPACE_DIR, TRUST_PROXY } from './config.js'
import * as files from './files.js'
import { ensureEnvAdmin, allUsers } from './auth.js'
import { seedWorkspace } from './seed.js'
import { apiRouter } from './api.js'
import { desktopRouter, ensureDesktopUser, desktopWorkspaceDir } from './desktop.js'
import * as git from './git.js'
import { initChat } from './chat.js'
import { attachWs, closeWs } from './ws.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const distDir = path.join(repoRoot, 'dist')
const pluginsDir = path.join(repoRoot, 'plugins')

const app = express()
app.set('trust proxy', TRUST_PROXY)
app.disable('x-powered-by')

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  next()
})

app.use('/api', apiRouter)
if (DESKTOP) app.use('/api', desktopRouter)

app.get('/healthz', (req, res) => res.send('ok'))

// starter plugin catalog (plugins/registry.json + the plugin folders)
app.use('/catalog', express.static(pluginsDir))

// the built client
app.use(express.static(distDir))
app.get('/app.html', (req, res) => res.sendFile(path.join(distDir, 'app.html'), (err) => err && res.status(404).send('Client not built.')))
app.get('/', (req, res) => {
  if (DESKTOP) return res.redirect('/app.html')
  res.sendFile(path.join(distDir, 'index.html'), (err) => err && res.status(404).send('Client not built.'))
})

// ---------- boot ----------

await ensureEnvAdmin()
if (DESKTOP) await ensureDesktopUser()
const workspace = DESKTOP ? desktopWorkspaceDir() : WORKSPACE_DIR
await files.openWorkspace(workspace)
if (!files.info('lumen.json')) {
  const admin = allUsers().find((u) => u.role === 'admin')
  if (admin) await seedWorkspace({ handle: admin.handle, name: admin.name, chat: !DESKTOP })
}
await initChat()
await git.start()

// ---------- listen ----------

const httpServer = app.listen(PORT, HOST)
attachWs(httpServer)

export const listening = new Promise((resolve, reject) => {
  httpServer.once('listening', () => resolve(httpServer.address().port))
  httpServer.once('error', reject)
})

export async function stopServer() {
  await git.stop()
  closeWs()
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve))
}

let stopping = false
async function shutdown(signal) {
  if (stopping) return
  stopping = true
  console.log(`[lumen] ${signal}, shutting down`)
  try {
    await stopServer()
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
