// The hidden container the shell renders once. It holds every plugin's iframe;
// the plugin host positions each iframe over its view's content box without ever
// moving it in the DOM (moving an iframe reloads it).
import { useEffect, useRef } from 'react'
import { attachContainer, detachContainer, startHost } from './host.js'

export default function PluginFrames() {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) attachContainer(ref.current)
    startHost()
    return () => detachContainer()
  }, [])
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', zIndex: 5, pointerEvents: 'none' }}
    />
  )
}
