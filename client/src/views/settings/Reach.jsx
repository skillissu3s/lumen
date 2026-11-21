// How far an AI agent reaches: one level in every space, or a level per space
// (and for what's shared with you, and direct messages). Used where agents are
// made in Settings, and where an app asks to connect (auth/AuthorizePage.jsx).
import { Segmented, Select } from '../../components/ui/index.js'
import { useHasAccount } from '../../store/session.js'
import { useSpaces } from '../../store/spaces.js'

const ACCESS = [
  { value: 'read', label: 'Look only' },
  { value: 'edit', label: 'Look and change' },
  { value: 'full', label: 'Change and delete' },
]
const LEVELS = [{ value: 'none', label: 'No access' }, ...ACCESS]
export const LABEL = Object.fromEntries(ACCESS.map((a) => [a.value, a.label]))
const RANK = { read: 0, edit: 1, full: 2 }

/** The places an agent can be given, as the server names them: spaces by id, then what's shared, then direct messages */
export function usePlaces() {
  const spaces = useSpaces((s) => s.list)
  const account = useHasAccount()
  const out = spaces.filter((s) => s.id && s.kind !== 'shared').map((s) => ({ key: s.id, name: s.kind === 'candle' ? 'Your candle' : s.name }))
  if (spaces.some((s) => s.kind === 'shared')) out.push({ key: 'shared', name: 'Shared with you' })
  if (account) out.push({ key: 'dm', name: 'Direct messages' })
  return out
}

/** How far an agent reaches: one level everywhere, or a level per space. value: { access, scopes } */
export function Reach({ value, onChange }) {
  const places = usePlaces()
  const chosen = !!value.scopes
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <div className="agent-reach">
      <Segmented
        label="Where"
        value={chosen ? 'chosen' : 'all'}
        onChange={(v) => set({ scopes: v === 'all' ? null : Object.fromEntries(places.map((p) => [p.key, value.access])) })}
        options={[
          { value: 'all', label: 'All your spaces' },
          { value: 'chosen', label: 'Chosen spaces' },
        ]}
      />
      {chosen ? (
        <div className="set-table agent-places">
          {places.map((p) => (
            <div key={p.key} className="set-table-row">
              <span>{p.name}</span>
              <Select
                value={value.scopes[p.key] || 'none'}
                onChange={(e) => {
                  const scopes = { ...value.scopes }
                  if (e.target.value === 'none') delete scopes[p.key]
                  else scopes[p.key] = e.target.value
                  // the most it may do anywhere, for the list and the server's checks
                  const access = Object.values(scopes).reduce((a, l) => (RANK[l] > RANK[a] ? l : a), 'read')
                  set({ scopes, access })
                }}
                options={LEVELS}
                aria-label={`What it may do in ${p.name}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <Select value={value.access} onChange={(e) => set({ access: e.target.value })} options={ACCESS} aria-label="What it may do" />
      )}
    </div>
  )
}
