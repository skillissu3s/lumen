// React hooks over the workspace with stable results: derived data is rebuilt
// only when the files or the path list change, so components can use them freely.

import { useMemo } from 'react'
import { useWorkspace, spaceOf } from './workspace.js'
import { usePrefs } from './prefs.js'
import { selectConfig, selectLists, selectCalendars, selectAllItems, selectPlugins, selectDocs, selectIdeas } from './derived.js'

const useFilesAndPaths = () => [useWorkspace((s) => s.files), useWorkspace((s) => s.paths)]

function useDerived(select) {
  const [files, paths] = useFilesAndPaths()
  return useMemo(() => select({ files, paths }), [files, paths])
}

export const useConfig = () => {
  const file = useWorkspace((s) => s.files['lumen.json'])
  return useMemo(() => selectConfig({ files: { 'lumen.json': file } }), [file])
}
export const useLists = () => useDerived(selectLists)
export const useCalendars = () => useDerived(selectCalendars)
export const useAllItems = () => useDerived(selectAllItems)
// plugins are the person's, installed in their candle: read from the whole tree
export const usePlugins = () => {
  const tree = useWorkspace((s) => s.tree)
  return useMemo(() => selectPlugins({ files: tree }), [tree])
}
export const useDocs = () => useDerived(selectDocs)
export const useIdeas = () => useDerived(selectIdeas)

// Across spaces (docs/CANDLES.md): in your candle, Today, All tasks and
// Calendar also take in the boards and calendars of the other spaces you can
// reach (your workspaces, what was shared with you), except those turned off
// in preferences. In your candle a path in the tree is also a path you can
// edit, so these work with the usual actions. Anywhere else: that space only.
const ELSEWHERE = /^(workspaces|shared)\/[^/]+\/(lists|calendars)\/[^/]+\.md$/

export function useAcross() {
  const prefix = useWorkspace((s) => s.prefix)
  const files = useWorkspace((s) => s.files)
  const paths = useWorkspace((s) => s.paths)
  const tree = useWorkspace((s) => s.tree)
  const treePaths = useWorkspace((s) => s.treePaths)
  const off = usePrefs().across.off
  return useMemo(() => {
    if (prefix) return { files, paths, across: false }
    const skip = new Set(off)
    const extra = treePaths.filter((p) => ELSEWHERE.test(p) && !skip.has(spaceOf(p)))
    return { files: tree, paths: [...paths, ...extra], across: true }
  }, [prefix, files, paths, tree, treePaths, off])
}

export const useListsAcross = () => {
  const state = useAcross()
  return useMemo(() => selectLists(state), [state])
}
export const useCalendarsAcross = () => {
  const state = useAcross()
  return useMemo(() => selectCalendars(state), [state])
}
export const useAllItemsAcross = () => {
  const state = useAcross()
  return useMemo(() => selectAllItems(state), [state])
}

/** The inbox list's path from lumen.json */
export function inboxPath(config) {
  const raw = config?.inbox || 'inbox'
  return raw.includes('/') ? raw : `lists/${raw}.md`
}
