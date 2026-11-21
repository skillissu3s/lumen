// /mcp: Lumen as a Model Context Protocol server over Streamable HTTP
// (docs/MCP.md). An agent sends JSON-RPC in a POST with its token as a Bearer
// header and gets the answer back as JSON; there is no stream to keep open.
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_NAME, VERSION, DESKTOP } from '../config.js'
import { agentFromRequest, levelIn, mostOf, reaches } from '../agents.js'
import { createMcp } from './protocol.js'
import { tools } from './tools.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CAN = { read: 'look', edit: 'look, add and change', full: 'look, add, change and delete' }

const instructions = ({ user, agent }) =>
  [
    `This is ${APP_NAME}, ${user.name}'s tasks, calendar and docs (signed in as @${user.handle}). This agent may ${CAN[mostOf(agent)] || 'do nothing yet'}${agent.scopes ? ', in the spaces list_spaces shows (each with what it may do there)' : ''}.`,
    'Paths: your candle (private) is at the top (lists/…, calendars/…, docs/…); workspaces are under workspaces/<slug>/; what others share with you is under shared/<owner>/. list_spaces and list_files give them.',
    'Boards are lists/*.md: "## Column" headings and "- [ ] task" lines, each ending in "🆔 id". Change tasks and events with their path and id (from list_tasks or get_agenda) rather than rewriting the file.',
    'Dates are YYYY-MM-DD and times 24-hour HH:MM.',
    mostOf(agent) === 'full' ? 'Deleting cannot be undone here: confirm with the person first.' : 'This agent can’t delete; the person can allow it in Lumen under Settings → AI agents.',
  ].join('\n')

const handle = createMcp({
  name: 'lumen',
  version: VERSION,
  instructions,
  tools,
  refuse: (tool, { agent }) => {
    if (reaches(mostOf(agent), tool.access)) return null
    return tool.access === 'full' ? 'This agent can’t delete. The person can allow it in Lumen under Settings → AI agents.' : 'This agent can only look. The person can let it make changes in Lumen under Settings → AI agents.'
  },
})

export const mcpRouter = express.Router()

// a page on another site can't drive someone's agent token through their browser
function sameOrigin(req, res, next) {
  const origin = req.headers.origin
  if (!origin) return next()
  let host = null
  try {
    host = new URL(origin).host
  } catch {
    /* "null" and the like: not this site */
  }
  if (host !== req.headers.host) return res.status(403).json({ error: 'Not from this site.' })
  next()
}

mcpRouter.get('/stdio.js', (req, res) => res.type('text/javascript').sendFile(path.join(here, 'stdio.js')))

mcpRouter.post('/', sameOrigin, express.json({ limit: '3mb' }), async (req, res) => {
  const found = agentFromRequest(req)
  // no WWW-Authenticate: Lumen has no OAuth sign-in for an app to go looking for
  if (!found) return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Make a token in Lumen under Settings → AI agents and send it in an X-Token header.' } })
  if (DESKTOP) found.user.desktop = true
  // what this agent may do in a space: tree.js asks before every read and write
  found.user.reach = (key) => levelIn(found.agent, key)
  const batch = Array.isArray(req.body)
  const msgs = batch ? req.body : [req.body]
  const out = (await Promise.all(msgs.map((m) => handle(m, found)))).filter(Boolean)
  if (!out.length) return res.status(202).end()
  res.json(batch ? out : out[0])
})

// nothing to stream, and no session to end
mcpRouter.all('/', (req, res) => res.set('Allow', 'POST').status(405).json({ error: 'Send JSON-RPC in a POST.' }))

mcpRouter.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That isn’t JSON.' } })
  next(err)
})
