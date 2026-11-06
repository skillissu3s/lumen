// "Move to…": a board, calendar, doc or idea board goes to another space you're
// in (your candle or a workspace). The server moves it whole, keeping its id;
// sharing stays behind, since only a candle shares things one by one.
import { useState } from 'react'
import { Button, Dialog } from '../components/ui/index.js'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'
import { useSession } from '../store/session.js'
import { useSpaces, useCurrentSpace } from '../store/spaces.js'
import { useUI } from '../store/ui.js'
import { useWorkspace } from '../store/workspace.js'
import { WorkspaceMark } from './WorkspaceMenu.jsx'

const HOME = { lists: '/tasks', calendars: '/calendar', docs: '/docs', ideas: '/ideas' }

/** May things here move at all? (on a server, and not in what others shared with you) */
export function useCanMove() {
  const mode = useSession((s) => s.mode)
  const current = useCurrentSpace()
  return mode === 'server' && current.kind !== 'shared'
}

/** The menu entry, for item menus */
export const moveItem = (path, name) => ({ label: 'Move to…', onSelect: () => useUI.setState({ moving: { path, name } }) })

/** The one move dialog, for whatever a menu asked to move */
export function MoveHost() {
  const item = useUI((s) => s.moving)
  return <MoveTo item={item} onClose={() => useUI.setState({ moving: null })} />
}

/** Spaces something here could move to (none on the desktop, or when only shared with you) */
export function useMoveTargets() {
  const mode = useSession((s) => s.mode)
  const current = useCurrentSpace()
  const list = useSpaces((s) => s.list)
  if (mode !== 'server' || current.kind === 'shared') return []
  return list.filter((s) => s.prefix !== current.prefix && (s.kind === 'candle' || s.kind === 'workspace'))
}

/** `item`: { path (inside the current space), name } or null */
export function MoveTo({ item, onClose }) {
  const targets = useMoveTargets()
  const user = useSession((s) => s.user)
  const toast = useUI((s) => s.toast)
  const [busy, setBusy] = useState(null)
  const nameOf = (s) => (s.kind === 'candle' ? s.name || `${user?.name || 'My'}’s candle` : s.name)
  const move = async (s) => {
    setBusy(s.prefix)
    try {
      await useWorkspace.getState().flushNow()
      const prefix = useWorkspace.getState().prefix
      await api('POST', '/files/move', { from: prefix + item.path, to: s.prefix + item.path })
      onClose()
      toast(`Moved to ${nameOf(s)}`, { tone: 'success' })
      navigate(HOME[item.path.split('/')[0]] || '/today')
    } catch (e) {
      toast(e.message, { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog open={!!item} onClose={onClose} size="sm" title={`Move ${item?.name || 'it'} to…`} description="It moves with everything in it. If it’s shared with people, that stays behind.">
      <div className="move-targets">
        {targets.map((s) => (
          <Button key={s.prefix} variant="ghost" className="move-target" loading={busy === s.prefix} disabled={!!busy} onClick={() => move(s)}>
            <WorkspaceMark name={nameOf(s)} kind={s.kind} size={20} />
            <span>{nameOf(s)}</span>
          </Button>
        ))}
        {!targets.length && <p className="muted">There’s nowhere else to move it. Create a workspace from the menu at the top of the sidebar.</p>}
      </div>
    </Dialog>
  )
}
