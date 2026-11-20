// The desktop app signed in to a Lumen server: what only the server can do
// goes straight to it, as the account. Chat, making and joining workspaces and
// their members, the people to share with, your name and username, your
// agents and GitHub copies all live there; boards, calendars and docs stay
// here and sync (replica.js). Without an account these routes answer as before
// (most of them: not here), and the app doesn't offer them.
import express from 'express'
import { apiErrors, csrf, jsonBody, loadUser } from '../api.js'
import * as replica from './replica.js'

// [path under /api, the methods that go (all when left out)]
const PASSED = [
  [/^\/chat(\/|$)/],
  [/^\/spaces$/, ['POST']],
  [/^\/spaces\/[^/]+(\/|$)/],
  [/^\/join\//],
  [/^\/users$/],
  [/^\/me$/, ['PATCH']],
  [/^\/me\/(password|agents)(\/|$)/],
  [/^\/github(\/|$)/],
  [/^\/files\/move$/],
]
// what changes which spaces or files the account has: the copy here catches up before answering
const RESHAPES = /^\/(spaces|join|files\/move)(\/|$)/

export const cloudRouter = express.Router()

cloudRouter.use(jsonBody, csrf, loadUser, async (req, res, next) => {
  if (!req.user || !replica.account()) return next()
  if (!PASSED.some(([path, methods]) => path.test(req.path) && (!methods || methods.includes(req.method)))) return next()
  const changing = req.method !== 'GET'
  // a move works on the server's copy, so this computer's changes go first
  if (req.path === '/files/move') await replica.syncNow()
  const r = await replica.forward(req.method, req.originalUrl.replace(/^\/api/, ''), changing ? req.body || {} : undefined)
  if (r.status === 0) return res.status(503).json(r.json)
  if (r.status < 400 && changing) {
    if (req.path === '/me' && r.json?.user) replica.mirrorAccount(r.json.user)
    if (RESHAPES.test(req.path) || req.path === '/me') await replica.syncNow()
  }
  res.status(r.status).json(r.json)
})

cloudRouter.use(apiErrors)
