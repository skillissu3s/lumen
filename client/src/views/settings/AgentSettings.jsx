// Settings → AI agents: tokens that let an AI agent use Lumen over MCP
// (docs/MCP.md). Each token says what it may do, in every space or only the
// ones you choose, each at its own level. A token is shown once; after that
// only its name, its reach and when it was last used.
import { useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Button, Dialog, Input } from '../../components/ui/index.js'
import { api } from '../../lib/api.js'
import { useUI } from '../../store/ui.js'
import { relativeDay, isoOf } from '../../../../shared/dates.js'
import { Row, Section } from './parts.jsx'
import { LABEL, Reach, usePlaces } from './Reach.jsx'

const used = (ms) => (ms ? `Last used ${relativeDay(isoOf(new Date(ms))).replace(/^(Today|Yesterday)$/, (d) => d.toLowerCase())}` : 'Not used yet')

/** "Look and change, everywhere" / "2 spaces" */
function reachText(agent, places) {
  if (!agent.scopes) return `${LABEL[agent.access]}, everywhere`
  const keys = Object.keys(agent.scopes)
  if (!keys.length) return 'No spaces yet'
  if (keys.length === 1) return `${LABEL[agent.scopes[keys[0]]]}, ${places.find((p) => p.key === keys[0])?.name || '1 space'}`
  return `${keys.length} spaces`
}

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
  const places = usePlaces()
  const [agents, setAgents] = useState(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [reach, setReach] = useState({ access: 'edit', scopes: null })
  const [made, setMade] = useState(null)
  const [editing, setEditing] = useState(null) // { agent, reach }
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
      <Section title="Connect an agent" description="An agent reaches what you can reach, and no more: choose what it may do, everywhere or space by space. Give each agent its own token, so you can take one away without the others.">
        <div className="agent-form">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, like Planner on my laptop" aria-label="Agent name" maxLength={60} />
          <Reach value={reach} onChange={setReach} />
          <div>
            <Button
              variant="primary"
              disabled={!name.trim() || (reach.scopes && !Object.keys(reach.scopes).length)}
              onClick={() =>
                run(async () => {
                  setMade(await api('POST', '/me/agents', { name, ...reach }))
                  setName('')
                })
              }
            >
              Create token
            </Button>
          </div>
        </div>
        {made && (
          <div className="agent-made">
            <p className="setting-desc">Copy the token now: Lumen won’t show it again.</p>
            <Copyable text={made.token} label="Token" />
            <p className="setting-desc">For Claude Code, run this in a terminal:</p>
            <Copyable text={`claude mcp add --transport http lumen ${made.url} --header "X-Token: ${made.token}"`} label="Command" />
          </div>
        )}
      </Section>
      <Section title="Address" description="Agents that take a URL connect here, with the token in a header named X-Token. X-API-Key works too, and so does Authorization: Bearer, where an app allows it.">
        <Copyable text={url} label="Address" />
      </Section>
      <Section title="Connected agents">
        {agents?.length ? (
          <div className="set-table">
            {agents.map((a) => (
              <div key={a.id} className="set-table-row">
                <span>
                  <span className="member-name">{a.name}</span>
                  <span className="faint">
                    {' '}
                    · {reachText(a, places)} · {used(a.lastUsedAt)}
                  </span>
                </span>
                <Button size="sm" onClick={() => setEditing({ agent: a, reach: { access: a.access, scopes: a.scopes } })}>
                  Change
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${a.name}`} onClick={() => setRevoking(a)} />
              </div>
            ))}
          </div>
        ) : (
          <Row label="No agents yet" hint="Agents you connect show up here." />
        )}
      </Section>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`What ${editing?.agent.name} may do`}
        description="Changes apply to its next request."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={editing?.reach.scopes && !Object.keys(editing.reach.scopes).length}
              onClick={() =>
                run(async () => {
                  await api('PATCH', `/me/agents/${editing.agent.id}`, editing.reach)
                  setEditing(null)
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        {editing && <Reach value={editing.reach} onChange={(r) => setEditing({ ...editing, reach: r })} />}
      </Dialog>
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
