// A plugin's page: a header, and a box the plugin's sandboxed frame is laid
// over (the frame itself lives in the shell so it keeps running elsewhere).
import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Puzzle, RotateCw, Settings } from 'lucide-react'
import { Button, EmptyState, Menu, Spinner } from '../components/ui/index.js'
import { usePlugins } from '../store/hooks.js'
import { usePrefs } from '../store/prefs.js'
import { navigate } from '../lib/router.js'
import { mountTarget, pluginState, reloadPlugin, unmountTarget } from '../plugins/host.js'
import { iconByName } from '../shell/icons.js'

export default function PluginView({ route }) {
  const id = route.parts[1]
  const plugins = usePlugins()
  const prefs = usePrefs()
  const plugin = plugins.find((p) => p.id === id)
  const enabled = plugin && !prefs.plugins.disabled.includes(id)
  const boxRef = useRef(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    if (!enabled || !boxRef.current) return
    mountTarget(id, boxRef.current).then(() => setState(pluginState(id)))
    const t = setInterval(() => setState(pluginState(id)), 500)
    return () => {
      clearInterval(t)
      unmountTarget(id)
    }
  }, [id, enabled])

  if (!plugin || !enabled)
    return (
      <div className="view">
        <EmptyState
          icon={Puzzle}
          title={plugin ? `${plugin.manifest.name} is switched off` : 'This plugin isn’t installed'}
          action={<Button onClick={() => navigate('/settings/plugins')}>Open plugin settings</Button>}
        >
          {plugin ? 'Turn it back on in Settings → Plugins.' : 'Install plugins from Settings → Plugins.'}
        </EmptyState>
      </div>
    )

  const Icon = iconByName(plugin.manifest.view?.icon || plugin.manifest.icon)
  return (
    <div className="view plugin-view">
      <header className="view-header has-border">
        <h1 className="view-title">
          <Icon size={16} className="faint" />
          {plugin.manifest.view?.title || plugin.manifest.name}
        </h1>
        <div className="view-actions">
          <Menu
            align="end"
            items={[
              { label: 'Reload plugin', icon: RotateCw, onSelect: () => reloadPlugin(id) },
              { label: 'Plugin settings', icon: Settings, onSelect: () => navigate('/settings/plugins') },
            ]}
            trigger={
              <button type="button" className="ui-icon-button" aria-label="Plugin options">
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>
      </header>
      <div className="plugin-box" ref={boxRef}>
        {state === 'loading' && (
          <div className="view-loading">
            <Spinner size={16} />
          </div>
        )}
        {state === 'error' && (
          <EmptyState icon={Puzzle} title="This plugin couldn’t start" action={<Button icon={RotateCw} onClick={() => reloadPlugin(id)}>Try again</Button>}>
            Its files may be incomplete. Reinstalling it from Settings → Plugins usually helps.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
