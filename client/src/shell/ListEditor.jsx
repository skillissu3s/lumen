// The small form for making or changing a board, calendar or idea board:
// name, icon, colour, and (on a server) who it's shared with.
import { useEffect, useState } from 'react'
import { Button, ColorPicker, IconBadge, IconPicker, Input, Popover, Segmented } from '../components/ui/index.js'
import { api } from '../lib/api.js'
import { useSession } from '../store/session.js'

export function ShareField({ value, onChange }) {
  const mode = useSession((s) => s.mode)
  const me = useSession((s) => s.user?.handle)
  const [people, setPeople] = useState([])
  useEffect(() => {
    if (mode !== 'server') return
    api('GET', '/users')
      .then((r) => setPeople(r.users.filter((u) => u.handle !== me)))
      .catch(() => {})
  }, [mode, me])
  if (mode !== 'server') return null
  const kind = value === 'everyone' ? 'everyone' : Array.isArray(value) && value.length ? 'people' : 'private'
  const chosen = Array.isArray(value) ? value : []
  return (
    <div className="share-field">
      <Segmented
        label="Who can see it"
        value={kind}
        onChange={(k) => onChange(k === 'everyone' ? 'everyone' : k === 'people' ? (chosen.length ? chosen : people.slice(0, 1).map((p) => p.handle)) : null)}
        options={[
          { value: 'private', label: 'Only me' },
          { value: 'everyone', label: 'Everyone' },
          { value: 'people', label: 'People…' },
        ]}
      />
      {kind === 'people' && (
        <div className="share-people">
          {people.map((p) => (
            <label key={p.handle} className="share-person">
              <input type="checkbox" checked={chosen.includes(p.handle)} onChange={(e) => onChange(e.target.checked ? [...chosen, p.handle] : chosen.filter((h) => h !== p.handle))} />
              <span>{p.name}</span>
              <span className="share-handle">@{p.handle}</span>
            </label>
          ))}
          {!people.length && <p className="muted">No one else has joined yet.</p>}
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${NOUN[kind]} name`} aria-label="Name" autoFocus />
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
