// React hooks over the workspace with stable results: derived data is rebuilt
// only when the files or the path list change, so components can use them freely.

import { useMemo } from 'react'
import { useWorkspace } from './workspace.js'
import { selectConfig, selectLists, selectCalendars, selectAllItems, selectPlugins, selectDocs } from './derived.js'

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
export const usePlugins = () => useDerived(selectPlugins)
export const useDocs = () => useDerived(selectDocs)

/** The inbox list's path from lumen.json */
export function inboxPath(config) {
  const raw = config?.inbox || 'inbox'
  return raw.includes('/') ? raw : `lists/${raw}.md`
}
