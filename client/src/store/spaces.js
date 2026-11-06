// The spaces you can be in (docs/CANDLES.md): your candle, the workspaces
// you're in, and what each person shared with you (one "space" per person, at
// shared/<them>/). Which one is open is remembered per account in this browser.
// The list comes from the server; offline it's worked out from the files kept
// here, which carry every space's place in the tree.

import { useMemo } from 'react'
import { create } from 'zustand'
import { api } from '../lib/api.js'
import { navigate } from '../lib/router.js'
import { useSession } from './session.js'
import { useWorkspace } from './workspace.js'

const keyFor = () => `lumen.space.${useSession.getState().user?.handle || ''}`

/** The space this browser last had open for the signed-in account ('' is the candle) */
export function rememberedSpace() {
  try {
    return localStorage.getItem(keyFor()) || ''
  } catch {
    return ''
  }
}

function remember(prefix) {
  try {
    localStorage.setItem(keyFor(), prefix)
  } catch {
    /* storage unavailable */
  }
}

const nameIn = (tree, prefix) => {
  try {
    return JSON.parse(tree[`${prefix}lumen.json`]?.text || '{}').name || ''
  } catch {
    return ''
  }
}

// without the server: every space that has files here
function fromTree() {
  const { tree, treePaths } = useWorkspace.getState()
  const user = useSession.getState().user
  const list = [{ prefix: '', kind: 'candle', name: nameIn(tree, '') || `${user?.name || 'My'}’s candle`, role: 'owner' }]
  const seen = new Set()
  for (const p of treePaths) {
    const m = /^(workspaces|shared)\/([^/]+)\//.exec(p)
    if (!m || seen.has(m[0])) continue
    seen.add(m[0])
    list.push(m[1] === 'workspaces' ? { prefix: m[0], kind: 'workspace', slug: m[2], name: nameIn(tree, m[0]) || m[2], role: 'member' } : { prefix: m[0], kind: 'shared', owner: m[2], name: m[2], items: [] })
  }
  return list
}

export const useSpaces = create((set, get) => ({
  list: [{ prefix: '', kind: 'candle', name: '', role: 'owner' }],

  async load() {
    if (useSession.getState().mode !== 'server') return set({ list: [{ prefix: '', kind: 'candle', name: '', role: 'owner', home: true }] })
    let list
    try {
      const r = await api('GET', '/spaces')
      const shared = new Map()
      for (const s of r.shared) {
        const g = shared.get(s.prefix) || { prefix: s.prefix, kind: 'shared', owner: s.owner, name: s.ownerName, items: [] }
        g.items.push({ path: s.path, can: s.can })
        shared.set(s.prefix, g)
      }
      list = [...r.spaces, ...shared.values()]
      useWorkspace.getState().setReadOnly(r.shared.filter((s) => s.can === 'view').map((s) => s.prefix + s.path))
    } catch {
      list = fromTree()
    }
    set({ list })
    // the space you were in is gone (you left, were removed, it was deleted)
    const cur = useWorkspace.getState().prefix
    if (cur && !list.some((s) => s.prefix === cur)) get().open('', { quiet: true })
  },

  /** Opens a space ('' is your candle) and goes to its Today */
  open(prefix, { quiet = false, to = '/today' } = {}) {
    useWorkspace.getState().setSpace(prefix)
    remember(prefix)
    if (!quiet || to) navigate(to)
  },
}))

/** prefix → how to name that space beside an item from it ('' for your candle: no label) */
export function useSpaceLabels() {
  const list = useSpaces((s) => s.list)
  return useMemo(() => Object.fromEntries(list.filter((s) => s.prefix).map((s) => [s.prefix, s.kind === 'shared' ? `Shared by ${s.name}` : s.name])), [list])
}

/** The space that's open now: { prefix, kind, name, role, … } */
export function useCurrentSpace() {
  const prefix = useWorkspace((s) => s.prefix)
  const list = useSpaces((s) => s.list)
  return list.find((s) => s.prefix === prefix) || { prefix, kind: prefix.startsWith('shared/') ? 'shared' : prefix ? 'workspace' : 'candle', name: '', role: 'member' }
}

// joined or left somewhere (a new place in the tree, or one gone): look again
let known = null // null: not looked yet this session
let timer = null
useWorkspace.subscribe((s) => {
  if (s.status !== 'ready') {
    known = null
    return
  }
  const now = [...new Set(s.treePaths.map((p) => /^(workspaces|shared)\/[^/]+\//.exec(p)?.[0]).filter(Boolean))].sort().join('|')
  if (now === known) return
  known = now
  clearTimeout(timer)
  timer = setTimeout(() => useSpaces.getState().load(), 200)
})
