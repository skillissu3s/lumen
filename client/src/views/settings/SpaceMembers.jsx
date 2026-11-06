// Settings → Members, for the workspace you're in: who's in it and with what
// role, invite links (anyone with one can join, or sign up and join), and
// leaving. Owners and admins manage; everyone else sees who's there.
import { useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import { Button, Dialog, Select, UserAvatar } from '../../components/ui/index.js'
import { api } from '../../lib/api.js'
import { useSession } from '../../store/session.js'
import { useSpaces, useCurrentSpace } from '../../store/spaces.js'
import { useUI } from '../../store/ui.js'
import { relativeDay, isoOf } from '../../../../shared/dates.js'
import { Row, Section } from './parts.jsx'

const ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
]
const ROLE_NAME = { owner: 'Owner', admin: 'Admin', member: 'Member' }
const expires = (ms) => relativeDay(isoOf(new Date(ms))).replace(/^(Today|Tomorrow)$/, (d) => d.toLowerCase())

export default function SpaceMembers() {
  const space = useCurrentSpace()
  const me = useSession((s) => s.user)
  const toast = useUI((s) => s.toast)
  const [members, setMembers] = useState([])
  const [invites, setInvites] = useState([])
  const [role, setRole] = useState('member')
  const [link, setLink] = useState(null)
  const [removing, setRemoving] = useState(null)
  const manager = space.role === 'owner' || space.role === 'admin'
  const base = `/spaces/${space.id}`

  const load = async () => {
    const m = await api('GET', `${base}/members`)
    setMembers(m.members)
    if (manager) setInvites((await api('GET', `${base}/invites`)).invites)
  }
  useEffect(() => {
    if (space.id) load().catch((e) => toast(e.message, { tone: 'danger' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.id, manager])

  const run = async (fn) => {
    try {
      if ((await fn()) === 'left') return
      await load()
    } catch (e) {
      toast(e.message, { tone: 'danger' })
    }
  }
  const copy = (url) => {
    navigator.clipboard?.writeText(url)
    toast('Invite link copied')
  }

  if (space.kind !== 'workspace') return <Section description="Your candle is yours alone. To work with people, create a workspace from the menu at the top of the sidebar, or share one board, calendar, doc or idea board with them." />

  return (
    <>
      {manager && (
        <Section title="Invite people" description="Anyone with the link can join this workspace for 7 days, or sign up and join if they have no account yet.">
          <div className="set-inline">
            <Select value={role} onChange={(e) => setRole(e.target.value)} options={ROLES} aria-label="They join as" />
            <Button
              variant="primary"
              onClick={() =>
                run(async () => {
                  const r = await api('POST', `${base}/invites`, { role })
                  setLink(r.url)
                  copy(r.url)
                })
              }
            >
              Create invite link
            </Button>
          </div>
          {link && (
            <div className="invite-link">
              <code>{link}</code>
              <Button icon={Copy} size="sm" onClick={() => copy(link)}>
                Copy
              </Button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="set-table">
              {invites.map((i) => (
                <div key={i.id} className="set-table-row">
                  <span>Link for {i.role === 'admin' ? 'admins' : 'members'}</span>
                  <span className="faint">
                    {i.uses} joined, expires {expires(i.expiresAt)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => run(() => api('DELETE', `${base}/invites/${i.id}`))}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
      <Section title={`In ${space.name}`}>
        <div className="set-table">
          {members.map((u) => {
            const canChange = u.id !== me?.id && u.role !== 'owner' && (space.role === 'owner' || (space.role === 'admin' && u.role === 'member'))
            return (
              <div key={u.id} className="set-table-row member">
                <span className="member-who">
                  <UserAvatar user={u} size={26} />
                  <span>
                    <span className="member-name">{u.name}</span>
                    <span className="faint"> @{u.handle}</span>
                  </span>
                </span>
                {canChange ? (
                  <>
                    <Select value={u.role} onChange={(e) => run(() => api('PATCH', `${base}/members/${u.id}`, { role: e.target.value }))} options={ROLES} aria-label={`${u.name}'s role`} />
                    <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Remove ${u.name}`} onClick={() => setRemoving(u)} />
                  </>
                ) : (
                  <span className="faint">
                    {u.id === me?.id ? 'You · ' : ''}
                    {ROLE_NAME[u.role]}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Section>
      {space.role !== 'owner' && (
        <Section>
          <Row label="Leave this workspace" hint="You lose access to everything in it. Others keep working as before.">
            <Button variant="danger" onClick={() => setRemoving(me)}>
              Leave
            </Button>
          </Row>
        </Section>
      )}
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title={removing?.id === me?.id ? `Leave ${space.name}?` : `Remove ${removing?.name}?`}
        description={removing?.id === me?.id ? 'You can come back with a new invite link.' : 'They lose access right away. What they made stays in the workspace.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                run(async () => {
                  const leaving = removing.id === me?.id
                  await api('DELETE', `${base}/members/${removing.id}`)
                  setRemoving(null)
                  if (leaving) {
                    await useSpaces.getState().load()
                    useSpaces.getState().open('')
                    return 'left'
                  }
                })
              }
            >
              {removing?.id === me?.id ? 'Leave' : 'Remove'}
            </Button>
          </>
        }
      />
    </>
  )
}
