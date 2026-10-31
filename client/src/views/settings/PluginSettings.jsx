// Settings → Plugins: what's installed, the catalog, and installing from GitHub
// or a folder — always after showing what the plugin will be allowed to do.
import { useEffect, useRef, useState } from 'react'
import { FolderOpen, ShieldCheck } from 'lucide-react'
import { Button, Dialog, Input, Spinner, Switch } from '../../components/ui/index.js'
import { usePlugins } from '../../store/hooks.js'
import { usePrefs, setPrefs } from '../../store/prefs.js'
import { useSession } from '../../store/session.js'
import { useUI } from '../../store/ui.js'
import { PERMISSION_DESCRIPTIONS, fetchCatalogPlugin, fetchFromGitHub, installPlugin, loadCatalog, readFromFolder, uninstallPlugin, updatePlugin } from '../../plugins/install.js'
import { iconByName } from '../../shell/icons.js'

const describe = (p) => PERMISSION_DESCRIPTIONS[p] || p

function PluginRow({ manifest, children, sub }) {
  const Icon = iconByName(manifest.icon)
  return (
    <div className="plugin-row">
      <span className="plugin-icon">
        <Icon size={18} />
      </span>
      <div className="plugin-info">
        <div className="plugin-name">
          {manifest.name} <span className="faint">{manifest.version}</span>
        </div>
        <p className="muted">{manifest.description}</p>
        {sub}
      </div>
      <div className="plugin-actions">{children}</div>
    </div>
  )
}

export default function PluginSettings() {
  const installed = usePlugins()
  const prefs = usePrefs()
  const mode = useSession((s) => s.mode)
  const role = useSession((s) => s.user?.role)
  const toast = useUI((s) => s.toast)
  const canManage = mode !== 'server' || role === 'admin'
  const [catalog, setCatalog] = useState(null)
  const [repo, setRepo] = useState('')
  const [pending, setPending] = useState(null) // { manifest, files, update }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(null)
  const folderRef = useRef(null)

  const refresh = () =>
    loadCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
  useEffect(() => {
    refresh()
  }, [installed.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (load, update = false) => {
    setError('')
    setBusy(true)
    try {
      const p = await load()
      setPending({ ...p, update })
    } catch (e) {
      setError(e.message || 'Couldn’t read that plugin')
    } finally {
      setBusy(false)
    }
  }
  const confirm = async () => {
    const p = pending
    setBusy(true)
    try {
      const perms = p.manifest.permissions || []
      if (p.update) await updatePlugin(p, perms)
      else await installPlugin(p, perms)
      toast(`${p.manifest.name} ${p.update ? 'updated' : 'installed'}`)
      setPending(null)
    } catch (e) {
      setError(e.message)
      setPending(null)
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id, on) => {
    const disabled = new Set(prefs.plugins.disabled)
    on ? disabled.delete(id) : disabled.add(id)
    setPrefs({ plugins: { disabled: [...disabled] } })
  }

  const available = (catalog || []).filter((c) => !c.installed)
  return (
    <>
      <section className="set-section">
        <div className="set-section-head">
          <h2>Installed</h2>
          <p className="muted">Switching one off affects only you.</p>
        </div>
        <div className="set-section-body">
          {!installed.length && <p className="set-empty muted">No plugins yet — add one from the catalog below.</p>}
          {installed.map((p) => {
            const cat = catalog?.find((c) => c.manifest.id === p.id)
            return (
              <PluginRow
                key={p.id}
                manifest={p.manifest}
                sub={
                  <ul className="perm-list">
                    {(p.granted || []).filter((x) => x !== 'storage').map((x) => (
                      <li key={x}>{describe(x)}</li>
                    ))}
                  </ul>
                }
              >
                {cat?.updateAvailable && canManage && (
                  <Button size="sm" onClick={() => ask(() => fetchCatalogPlugin(cat.path), true)}>
                    Update to {cat.manifest.version}
                  </Button>
                )}
                <Switch checked={!prefs.plugins.disabled.includes(p.id)} onChange={(on) => toggle(p.id, on)} label={prefs.plugins.disabled.includes(p.id) ? 'Off' : 'On'} />
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                    Uninstall
                  </Button>
                )}
              </PluginRow>
            )
          })}
        </div>
      </section>

      {canManage && (
        <>
          <section className="set-section">
            <div className="set-section-head">
              <h2>Catalog</h2>
            </div>
            <div className="set-section-body">
              {catalog === null && <Spinner size={16} />}
              {catalog && !available.length && <p className="set-empty muted">Everything in the catalog is installed.</p>}
              {available.map((c) => (
                <PluginRow key={c.manifest.id} manifest={c.manifest}>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => ask(() => fetchCatalogPlugin(c.path))}>
                    Install
                  </Button>
                </PluginRow>
              ))}
            </div>
          </section>

          <section className="set-section">
            <div className="set-section-head">
              <h2>Install from elsewhere</h2>
              <p className="muted">From a GitHub repository (owner/repo, optionally /path/to/plugin) or a plugin folder on this computer. Only install plugins you trust.</p>
            </div>
            <div className="set-section-body">
              <form
                className="plugin-source"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (repo.trim()) ask(() => fetchFromGitHub(repo.trim()))
                }}
              >
                <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo/path" aria-label="GitHub repository" spellCheck={false} />
                <Button type="submit" loading={busy} disabled={!repo.trim()}>
                  Fetch
                </Button>
                <span className="faint">or</span>
                <Button type="button" icon={FolderOpen} onClick={() => folderRef.current?.click()}>
                  Choose folder…
                </Button>
                <input
                  ref={folderRef}
                  type="file"
                  hidden
                  webkitdirectory=""
                  directory=""
                  multiple
                  onChange={(e) => {
                    const files = e.target.files
                    e.target.value = ''
                    if (files?.length) ask(() => readFromFolder(files))
                  }}
                />
              </form>
              {error && <p className="auth-error">{error}</p>}
            </div>
          </section>
        </>
      )}

      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        size="sm"
        title={pending ? `${pending.update ? 'Update' : 'Install'} ${pending.manifest.name}?` : ''}
        description={pending?.manifest.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={confirm}>
              {pending?.update ? 'Update' : 'Install'}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="perm-ask">
            <p className="perm-ask-head">
              <ShieldCheck size={15} /> It will be able to:
            </p>
            <ul>
              {['storage', ...(pending.manifest.permissions || []).filter((x) => x !== 'storage')].map((x) => (
                <li key={x}>{describe(x)}</li>
              ))}
            </ul>
            {!(pending.manifest.permissions || []).includes('network') && <p className="faint">It can’t connect to the internet.</p>}
            <p className="faint">
              By {pending.manifest.author || 'unknown'} · version {pending.manifest.version}
            </p>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        size="sm"
        title={`Uninstall ${removing?.manifest.name}?`}
        description="Its files are removed for everyone. What it saved stays in data/plugins, so reinstalling picks up where it left off."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await uninstallPlugin(removing.id)
                setRemoving(null)
              }}
            >
              Uninstall
            </Button>
          </>
        }
      />
    </>
  )
}
