// Settings → AI agents: tokens that let an agent such as Claude use Lumen over
// MCP (docs/MCP.md). A token is shown once; after that only its name, how far
// it reaches and when it was last used.
import { useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Button, Dialog, Input, Select } from '../../components/ui/index.js'
import { api } from '../../lib/api.js'
import { useUI } from '../../store/ui.js'
import { relativeDay, isoOf } from '../../../../shared/dates.js'
import { Row, Section } from './parts.jsx'

const ACCESS = [
  { value: 'read', label: 'Look only' },
  { value: 'edit', label: 'Look and change' },
  { value: 'full', label: 'Change and delete' },
]
const used = (ms) => (ms ? `Last used ${relativeDay(isoOf(new Date(ms))).replace(/^(Today|Yesterday)$/, (d) => d.toLowerCase())}` : 'Not used yet')

function Copyable({ text, label }) {
  const toast = useUI((s) => s.toast)
  return (
    <div className="invite-link">
      <code>{text}</code>
      <Button
        icon={Copy}
        size="sm"
        onClick={() => {
          navigator.clipboard?.writeText(text)
          toast(`${label} copied`)
        }}
      >
        Copy
      </Button>
    </div>
  )
}

export default function AgentSettings() {
  const toast = useUI((s) => s.toast)
  const [agents, setAgents] = useState(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('Claude')
  const [access, setAccess] = useState('edit')
  const [made, setMade] = useState(null)
  const [revoking, setRevoking] = useState(null)

  const load = async () => {
    const r = await api('GET', '/me/agents')
    setAgents(r.agents)
    setUrl(r.url)
  }
  useEffect(() => {
    load().catch((e) => toast(e.message, { tone: 'danger' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const run = async (fn) => {
    try {
      await fn()
      await load()
    } catch (e) {
      toast(e.message, { tone: 'danger' })
    }
  }

  return (
    <>
      <Section title="Connect an agent" description="An agent reaches what you can reach, and no more. Give each agent its own token, so you can take one away without the others.">
        <div className="set-inline">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, like Claude on my laptop" aria-label="Agent name" maxLength={60} />
          <Select value={access} onChange={(e) => setAccess(e.target.value)} options={ACCESS} aria-label="What it may do" />
          <Button variant="primary" disabled={!name.trim()} onClick={() => run(async () => setMade(await api('POST', '/me/agents', { name, access })))}>
            Create token
          </Button>
        </div>
        {made && (
          <div className="agent-made">
            <p className="setting-desc">Copy the token now: Lumen won’t show it again.</p>
            <Copyable text={made.token} label="Token" />
            <p className="setting-desc">For Claude Code, run this in a terminal:</p>
            <Copyable text={`claude mcp add --transport http lumen ${made.url} --header "Authorization: Bearer ${made.token}"`} label="Command" />
          </div>
        )}
      </Section>
      <Section title="Address" description="Agents that take a URL connect here, with the token as a Bearer header.">
        <Copyable text={url} label="Address" />
      </Section>
      <Section title="Connected agents">
        {agents?.length ? (
          <div className="set-table">
            {agents.map((a) => (
              <div key={a.id} className="set-table-row">
                <span>
                  <span className="member-name">{a.name}</span>
                  <span className="faint"> · {used(a.lastUsedAt)}</span>
                </span>
                <Select value={a.access} onChange={(e) => run(() => api('PATCH', `/me/agents/${a.id}`, { access: e.target.value }))} options={ACCESS} aria-label={`What ${a.name} may do`} />
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${a.name}`} onClick={() => setRevoking(a)} />
              </div>
            ))}
          </div>
        ) : (
          <Row label="No agents yet" hint="Agents you connect show up here." />
        )}
      </Section>
      <Dialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        size="sm"
        title={`Remove ${revoking?.name}?`}
        description="Its token stops working at once. What it made stays."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                run(async () => {
                  await api('DELETE', `/me/agents/${revoking.id}`)
                  if (made?.agent.id === revoking.id) setMade(null)
                  setRevoking(null)
                })
              }
            >
              Remove
            </Button>
          </>
        }
      />
    </>
  )
}
