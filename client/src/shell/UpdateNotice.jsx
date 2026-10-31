// Desktop app only: a quiet note when a new version is on its way or ready.
import { useEffect, useState } from 'react'
import { ArrowDownToLine, RotateCw } from 'lucide-react'

export function useUpdateState() {
  const api = typeof window !== 'undefined' ? window.lumenDesktop?.updates : null
  const [state, setState] = useState(null)
  useEffect(() => {
    if (!api) return
    api.state().then(setState)
    return api.onChange(setState)
  }, [api])
  return [state, api]
}

export function UpdateNotice() {
  const [u, api] = useUpdateState()
  if (!u || !['downloading', 'ready', 'available'].includes(u.status)) return null
  if (u.status === 'downloading')
    return (
      <div className="update-note is-quiet" role="status">
        <ArrowDownToLine size={13} />
        <span>Downloading Lumen {u.version}… {u.progress ? `${u.progress}%` : ''}</span>
      </div>
    )
  const ready = u.status === 'ready'
  return (
    <div className="update-note" role="status">
      <span>
        Lumen {u.version} {ready ? 'is ready' : 'is available'}
      </span>
      <button type="button" onClick={() => api.install()}>
        {ready ? (
          <>
            <RotateCw size={12} /> Restart
          </>
        ) : (
          <>
            <ArrowDownToLine size={12} /> Download
          </>
        )}
      </button>
    </div>
  )
}
