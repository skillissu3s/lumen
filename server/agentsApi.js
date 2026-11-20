// /api/me/agents: the AI agents a person has connected (docs/API.md). Only the
// person, signed in to the app, manages them; an agent's token never can.
import express from 'express'
import { PUBLIC_URL, DESKTOP } from './config.js'
import { apiErrors, csrf, jsonBody, loadUser, requireUser } from './api.js'
import { createToken, listTokens, updateToken, revokeToken } from './agents.js'

export const agentsRouter = express.Router()
agentsRouter.use('/me/agents', jsonBody, csrf, loadUser, requireUser)

// the address an agent connects to: this server as people reach it
const mcpUrl = (req) => `${(!DESKTOP && PUBLIC_URL) || `${req.protocol}://${req.get('host')}`}`.replace(/\/+$/, '') + '/mcp'

agentsRouter.get('/me/agents', (req, res) => res.json({ agents: listTokens(req.user.id), url: mcpUrl(req) }))

agentsRouter.post('/me/agents', (req, res) => res.json({ ...createToken(req.user, { name: req.body?.name, access: req.body?.access }), url: mcpUrl(req) }))

agentsRouter.patch('/me/agents/:id', (req, res) => res.json({ agent: updateToken(req.user.id, req.params.id, { name: req.body?.name, access: req.body?.access }) }))

agentsRouter.delete('/me/agents/:id', (req, res) => {
  revokeToken(req.user.id, req.params.id)
  res.json({ ok: true })
})

agentsRouter.use(apiErrors)
