// The small form for making or changing a board, calendar or idea board:
// name, icon, colour, and (in your candle on a server) who it's shared with.
import { useEffect, useState } from 'react'
import { Button, ColorPicker, IconBadge, IconPicker, Input, Popover, Segmented, Select } from '../components/ui/index.js'
import { api } from '../lib/api.js'
import { useSession } from '../store/session.js'
import { useCurrentSpace } from '../store/spaces.js'

// [sam, ana:view] → { sam: 'edit', ana: 'view' }, and back (docs/CANDLES.md)
const shareMap = (value) => Object.fromEntries((Array.isArray(value) ? value : []).map((e) => String(e).split(':')).map(([h, can]) => [h, can === 'view' ? 'view' : 'edit']))
const shareList = (map) => {
  const out = Object.entries(map).map(([h, can]) => (can === 'view' ? `${h}:view` : h))
  return out.length ? out : null
}

/**
 * Who can see a board, calendar, doc or idea board. In your candle: only you,
 * or people you pick, each able to view or to edit. In a workspace everyone in
 * it already can, so there is nothing to choose.
 */
export function ShareField({ value, onChange }) {
  const mode = useSession((s) => s.mode)
  const me = useSession((s) => s.user?.handle)
  const space = useCurrentSpace()
  const [people, setPeople] = useState([])
  const inCandle = mode === 'server' && space.kind === 'candle'
  useEffect(() => {
    if (!inCandle) return
    api('GET', '/users')
      .then((r) => setPeople(r.users.filter((u) => u.handle !== me)))
      .catch(() => {})
  }, [inCandle, me])
  if (mode !== 'server') return null
  if (space.kind === 'workspace') return <p className="share-note">Everyone in {space.name} can see and edit this.</p>
  if (space.kind === 'shared') return <p className="share-note">Shared with you by {space.name}. Only they can change who has it.</p>
  const map = shareMap(value)
  const kind = Object.keys(map).length ? 'people' : 'private'
  const set = (next) => onChange(shareList(next))
  return (
    <div className="share-field">
      <Segmented
        label="Who can see it"
        value={kind}
        onChange={(k) => (k === 'people' ? set(Object.keys(map).length ? map : people[0] ? { [people[0].handle]: 'view' } : {}) : onChange(null))}
        options={[
          { value: 'private', label: 'Only me' },
          { value: 'people', label: 'People…' },
        ]}
      />
      {kind === 'people' && (
        <div className="share-people">
          {people.map((p) => (
            <div key={p.handle} className="share-person">
              <label>
                <input
                  type="checkbox"
                  checked={!!map[p.handle]}
                  onChange={(e) => {
                    const next = { ...map }
                    if (e.target.checked) next[p.handle] = 'view'
                    else delete next[p.handle]
                    set(next)
                  }}
                />
                <span>{p.name}</span>
                <span className="share-handle">@{p.handle}</span>
              </label>
              {map[p.handle] && (
                <Select
                  className="share-can"
                  value={map[p.handle]}
                  onChange={(e) => set({ ...map, [p.handle]: e.target.value })}
                  options={[
                    { value: 'view', label: 'Can view' },
                    { value: 'edit', label: 'Can edit' },
                  ]}
                  aria-label={`What ${p.name} can do`}
                />
              )}
            </div>
          ))}
          {!people.length && <p className="muted">No one else has an account yet.</p>}
        </div>
      )}
    </div>
  )
}

const DEFAULT_ICON = { board: 'kanban', calendar: 'calendar', ideas: 'lightbulb' }
const NOUN = { board: 'Board', calendar: 'Calendar', ideas: 'Idea board' }

export function ListEditor({ open, onOpenChange, anchor, initial = {}, kind = 'board', onSave }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const [icon, setIcon] = useState(DEFAULT_ICON[kind])
  const [share, setShare] = useState(null)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    if (!open) return
    setName(initial.name || '')
    setColor(initial.color || 'blue')
    // an emoji from before icons were names becomes the default icon
    setIcon(/^[a-z-]+$/.test(initial.icon || '') ? initial.icon : DEFAULT_ICON[kind])
    setShare(initial.share ?? null)
    setPicking(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), color, icon, share })
    onOpenChange(false)
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} placement="right-start" className="list-editor">
      <form onSubmit={submit} className="list-editor-form">
        <b className="list-editor-title">{initial.name ? `Edit ${NOUN[kind].toLowerCase()}` : `New ${NOUN[kind].toLowerCase()}`}</b>
        <div className="list-editor-row">
          <button type="button" className="icon-pick" aria-label="Choose an icon" aria-expanded={picking} onClick={() => setPicking(!picking)}>
            <IconBadge name={icon} color={color} size={30} />
          </button>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${NOUN[kind]} name`} aria-label="Name" autoFocus data-autofocus />
        </div>
        {picking && (
          <IconPicker
            value={icon}
            color={color}
            onChange={(v) => {
              setIcon(v)
              setPicking(false)
            }}
          />
        )}
        <ColorPicker value={color} onChange={setColor} aria-label="Colour" />
        <ShareField value={share} onChange={setShare} />
        <div className="list-editor-actions">
          <Button variant="ghost" size="sm" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={!name.trim()}>
            {initial.name ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Popover>
  )
}
