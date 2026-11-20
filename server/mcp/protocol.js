// The Model Context Protocol's JSON-RPC side (modelcontextprotocol.io): the
// handshake, the tool list and tool calls. Stateless: every request carries its
// token, so nothing is kept between them and any server process can answer.

export const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** A tool's failure the agent should read and act on (it isn't a protocol error) */
export class ToolError extends Error {}

/**
 * `tools`: [{ name, title, description, inputSchema, annotations, run(args, ctx) }]
 * `refuse(tool, ctx)`: why this caller may not use the tool (a sentence), or
 * null. Refused tools are left out of the list.
 * Returns handle(message, ctx) → a response, or null for a notification.
 */
export function createMcp({ name, version, instructions, tools, refuse = () => null }) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const describe = (t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })

  async function call(params, ctx) {
    const tool = byName.get(params?.name)
    if (!tool) return { error: [-32602, `Unknown tool: ${params?.name}`] }
    const no = refuse(tool, ctx)
    if (no) return { result: { content: [{ type: 'text', text: no }], isError: true } }
    try {
      const out = await tool.run(params.arguments || {}, ctx)
      const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2)
      return { result: { content: [{ type: 'text', text }] } }
    } catch (e) {
      // what went wrong goes back to the agent as the tool's answer, so it can fix its call
      if (e instanceof ToolError || e.status) return { result: { content: [{ type: 'text', text: e.message }], isError: true } }
      console.error('[mcp]', params.name, e)
      return { result: { content: [{ type: 'text', text: 'Something went wrong on the server.' }], isError: true } }
    }
  }

  return async function handle(msg, ctx) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // a response to a request we never send, or not JSON-RPC at all
      return msg && 'id' in msg && !('result' in msg || 'error' in msg) ? fail(msg.id, -32600, 'Invalid request.') : null
    }
    const isNotification = !('id' in msg)
    if (isNotification) return null
    const { id, method, params } = msg
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion
        return ok(id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, title: 'Lumen', version },
          instructions: typeof instructions === 'function' ? instructions(ctx) : instructions,
        })
      }
      case 'ping':
        return ok(id, {})
      case 'tools/list':
        return ok(id, { tools: tools.filter((t) => !refuse(t, ctx)).map(describe) })
      case 'tools/call': {
        const r = await call(params, ctx)
        return r.error ? fail(id, ...r.error) : ok(id, r.result)
      }
      default:
        return fail(id, -32601, `Method not found: ${method}`)
    }
  }
}
