#!/usr/bin/env node
// For AI apps that start their tools as a local program (stdio) rather than
// calling a URL: passes each JSON-RPC line from stdin to a Lumen server's /mcp
// and writes the answers to stdout. Needs only Node 18 or newer, nothing else.
//
//   LUMEN_URL=https://lumen.example.com LUMEN_TOKEN=lumen_… node stdio.js
import readline from 'node:readline'

const url = `${String(process.env.LUMEN_URL || '').replace(/\/+$/, '')}/mcp`
const token = process.env.LUMEN_TOKEN || ''
if (!process.env.LUMEN_URL || !token) {
  process.stderr.write('Set LUMEN_URL (your Lumen address) and LUMEN_TOKEN (from Settings → AI agents).\n')
  process.exit(1)
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const failed = (msg, message) => 'id' in msg && send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message } })

async function pass(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'That isn’t JSON.' } })
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-token': token },
      body: JSON.stringify(msg),
    })
    if (res.status === 202) return
    const body = await res.json().catch(() => null)
    if (body?.jsonrpc) return send(body.id === null && 'id' in msg ? { ...body, id: msg.id } : body)
    failed(msg, `Lumen answered ${res.status}.`)
  } catch (e) {
    failed(msg, `Can’t reach Lumen at ${url}: ${e.message}`)
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => line.trim() && pass(line))
