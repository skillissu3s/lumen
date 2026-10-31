// Docs: pages you write the way you would in Notion, kept as markdown files.
// A tree on the left, the page on the right. Front matter stays out of sight.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Download, FileText, FolderClosed, Image as ImageIcon, MoreHorizontal, MoveHorizontal, Plus, Search, Smile, Trash2 } from 'lucide-react'
import { Button, Dialog, EmptyState, IconBadge, IconPicker, Input, Menu, Popover, Spinner, Tooltip } from '../../components/ui/index.js'
import { useDocs } from '../../store/hooks.js'
import { useWorkspace } from '../../store/workspace.js'
import { useSession } from '../../store/session.js'
import { useUI } from '../../store/ui.js'
import { navigate } from '../../lib/router.js'
import { createDoc, deleteDoc, renameDoc, saveDoc } from '../../lib/actions.js'
import { setFrontMatter, splitFrontMatter } from '../../../../shared/frontmatter.js'
import { ShareField } from '../../shell/ListEditor.jsx'
import { BOARD_COLORS } from '../../../../shared/board.js'
import { RichEditor } from './RichEditor.jsx'
import './docs.css'

const LAST = 'lumen.docs.last'
const store = {
  get: (k, d) => {
    try {
      return localStorage.getItem(k) ?? d
    } catch {
      return d
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* fine */
    }
  },
}

// split a doc into its front matter block (kept verbatim) and the body
function parts(text) {
  const { bodyStart } = splitFrontMatter(text)
  const lines = text.split('\n')
  return { head: bodyStart ? `${lines.slice(0, bodyStart).join('\n')}\n` : '', body: lines.slice(bodyStart).join('\n') }
}

function Tree({ docs, current, filter }) {
  const [closed, setClosed] = useState(() => new Set())
  const folders = useMemo(() => {
    const map = new Map()
    for (const d of docs) {
      if (filter && !d.title.toLowerCase().includes(filter)) continue
      if (!map.has(d.folder)) map.set(d.folder, [])
      map.get(d.folder).push(d)
    }
    return [...map].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [docs, filter])
  return (
    <ul className="doc-tree" role="tree" aria-label="Docs">
      {folders.map(([folder, list]) => {
        const isClosed = closed.has(folder) && !filter
        const items = (
          <ul role="group" className="doc-group">
            {list
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((d) => (
                <li key={d.path} role="treeitem" aria-selected={d.path === current}>
                  <a className={`doc-link${d.path === current ? ' is-active' : ''}`} href={`#/${d.path}`}>
                    {d.icon ? <IconBadge name={d.icon} color={d.color || 'gray'} size={18} fallback={FileText} /> : <FileText size={14} />}
                    <span>{d.title}</span>
                  </a>
                </li>
              ))}
          </ul>
        )
        if (!folder) return <li key="root">{items}</li>
        return (
          <li key={folder} role="treeitem" aria-expanded={!isClosed}>
            <button
              type="button"
              className={`doc-folder${isClosed ? '' : ' is-open'}`}
              onClick={() =>
                setClosed((s) => {
                  const n = new Set(s)
                  n.has(folder) ? n.delete(folder) : n.add(folder)
                  return n
                })
              }
            >
              <ChevronRight size={12} />
              <FolderClosed size={14} />
              <span>{folder}</span>
            </button>
            {!isClosed && items}
          </li>
        )
      })}
    </ul>
  )
}

function Editor({ path }) {
  const file = useWorkspace((s) => s.files[path])
  const saving = useWorkspace((s) => s.saving)
  const mode = useSession((s) => s.mode)
  const [loaded, setLoaded] = useState(!!file)
  const [confirm, setConfirm] = useState(false)
  const [share, setShare] = useState(false)
  const timer = useRef(null)
  const head = useRef('')
  const pending = useRef(null)
  const editorRef = useRef(null)
  const titleRef = useRef(null)
  const [picking, setPicking] = useState(null) // { kind: 'icon' | 'cover', anchor }
  const setMeta = (patch) => useWorkspace.getState().edit(path, (t) => setFrontMatter(t, patch))

  useEffect(() => {
    let alive = true
    if (!file) useWorkspace.getState().ensure(path).then(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (file) setLoaded(true)
  }, [file])

  const p = file ? parts(file.text) : { head: '', body: '' }
  head.current = p.head
  const meta = file ? splitFrontMatter(file.text).meta : {}
  const title = meta.title || path.split('/').pop().replace(/\.md$/, '')

  const flush = () => {
    clearTimeout(timer.current)
    if (pending.current != null) saveDoc(path, head.current + pending.current)
    pending.current = null
  }
  useEffect(() => () => flush(), [path]) // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = (md) => {
    pending.current = md
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 500)
  }
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  })

  if (!loaded) return <div className="view-loading"><Spinner size={16} /></div>
  if (!file) return <EmptyState title="This doc doesn’t exist" action={<Button onClick={() => navigate('/docs')}>Back to Docs</Button>}>It may have been moved or deleted.</EmptyState>

  const status = saving.pending ? 'Saving…' : 'Saved'
  const folder = path.replace(/^docs\//, '').replace(/[^/]+$/, '').replace(/\/$/, '')
  return (
    <div className="doc">
      <header className="view-header doc-header">
        <nav className="doc-crumb" aria-label="Where this doc is">
          <a href="#/docs?all=1">Docs</a>
          {folder &&
            folder.split('/').map((f) => (
              <span key={f}>
                <ChevronRight size={12} /> {f}
              </span>
            ))}
          <span>
            <ChevronRight size={12} /> {title}
          </span>
        </nav>
        <span className={`doc-status${saving.pending ? ' is-saving' : ''}`}>{status}</span>
        <div className="view-actions">
          <Menu
            align="end"
            items={[
              ...(mode === 'server' ? [{ label: 'Share…', onSelect: () => setShare(true) }] : []),
              {
                label: 'Download as Markdown',
                icon: Download,
                onSelect: () => {
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(new Blob([pending.current ?? p.body], { type: 'text/markdown' }))
                  a.download = path.split('/').pop()
                  a.click()
                },
              },
              { label: 'Full width', icon: MoveHorizontal, checked: meta.width === 'full', onSelect: () => setMeta({ width: meta.width === 'full' ? null : 'full' }) },
              'separator',
              { label: 'Delete doc…', icon: Trash2, danger: true, onSelect: () => setConfirm(true) },
            ]}
            trigger={
              <button type="button" className="ui-icon-button" aria-label="Doc options">
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>
      </header>
      <div className="doc-scroll">
        {meta.cover && (
          <div className={`doc-cover is-${meta.cover}`} style={{ '--cv': `var(--c-${meta.cover})` }}>
            <div className="doc-cover-tools">
              <button type="button" onClick={(e) => setPicking({ kind: 'cover', anchor: { current: e.currentTarget } })}>
                Change cover
              </button>
              <button type="button" onClick={() => setMeta({ cover: null })}>
                Remove
              </button>
            </div>
          </div>
        )}
        <article className={`doc-page${meta.width === 'full' ? ' is-full' : ''}${meta.cover ? ' has-cover' : ''}${meta.icon ? ' has-icon' : ''}`}>
          {meta.icon && (
            <button type="button" className="doc-icon" aria-label="Change the icon" onClick={(e) => setPicking({ kind: 'icon', anchor: { current: e.currentTarget } })}>
              <IconBadge name={meta.icon} color={meta.color || 'gray'} size={72} fallback={FileText} />
            </button>
          )}
          <div className="doc-page-tools">
            {!meta.icon && (
              <button type="button" onClick={(e) => setPicking({ kind: 'icon', anchor: { current: e.currentTarget } })}>
                <Smile size={15} /> Add icon
              </button>
            )}
            {!meta.cover && (
              <button type="button" onClick={() => setMeta({ cover: BOARD_COLORS[(path.length * 7) % BOARD_COLORS.length] })}>
                <ImageIcon size={15} /> Add cover
              </button>
            )}
          </div>
          <textarea
            ref={titleRef}
            key={`title:${title}`}
            className="doc-title"
            rows={1}
            defaultValue={title}
            placeholder="Untitled"
            aria-label="Title"
            onInput={(e) => {
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            onBlur={(e) => {
              const t = e.target.value.replace(/\s+/g, ' ').trim()
              if (t && t !== title) renameDoc(path, t)
              else if (!t) e.target.value = title
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
                e.preventDefault()
                editorRef.current?.commands.focus('start')
              }
            }}
          />
          <RichEditor markdown={p.body} onChange={onChange} onBlur={flush} editorRef={editorRef} />
        </article>
      </div>
      <Popover open={!!picking} onOpenChange={(o) => !o && setPicking(null)} anchor={picking?.anchor} placement="bottom-start" className={picking?.kind === 'icon' ? 'doc-icon-pop' : 'doc-cover-pop'}>
        {picking?.kind === 'icon' && (
          <div className="doc-icon-picker">
            <IconPicker value={meta.icon} color={meta.color || 'gray'} onChange={(icon) => (setMeta({ icon }), setPicking(null))} />
            <div className="doc-icon-colors">
              {BOARD_COLORS.map((c) => (
                <button key={c} type="button" className={`doc-swatch${(meta.color || 'gray') === c ? ' on' : ''}`} style={{ '--sw': `var(--c-${c})` }} aria-label={c} onClick={() => setMeta({ color: c === 'gray' ? null : c })} />
              ))}
            </div>
            {meta.icon && (
              <button type="button" className="doc-pop-remove" onClick={() => (setMeta({ icon: null, color: null }), setPicking(null))}>
                Remove icon
              </button>
            )}
          </div>
        )}
        {picking?.kind === 'cover' && (
          <div className="doc-cover-grid">
            {BOARD_COLORS.map((c) => (
              <button key={c} type="button" className={`doc-cover-choice is-${c}${meta.cover === c ? ' on' : ''}`} style={{ '--cv': `var(--c-${c})` }} aria-label={`${c} cover`} onClick={() => (setMeta({ cover: c }), setPicking(null))} />
            ))}
          </div>
        )}
      </Popover>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Delete “${title}”?`}
        description="This removes the doc. With GitHub sync, it stays in the history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                pending.current = null
                deleteDoc(path)
                setConfirm(false)
                navigate('/docs')
              }}
            >
              Delete
            </Button>
          </>
        }
      />
      <Dialog open={share} onClose={() => setShare(false)} size="sm" title="Who can see this doc">
        <ShareField value={meta.share ?? null} onChange={(v) => useWorkspace.getState().edit(path, (t) => setFrontMatter(t, { share: v }))} />
      </Dialog>
    </div>
  )
}

export default function DocsView({ route }) {
  const docs = useDocs()
  const path = route.parts[0] === 'docs' && route.parts.length > 1 ? route.parts.join('/') : null
  const [filter, setFilter] = useState('')
  const toast = useUI((s) => s.toast)

  useEffect(() => {
    if (path) store.set(LAST, path)
    else if (!route.query.all) {
      const last = store.get(LAST, null)
      if (last && docs.some((d) => d.path === last)) navigate(`/${last}`, { replace: true })
      else if (docs[0]) navigate(`/${docs[0].path}`, { replace: true })
    }
  }, [path, docs, route.query.all])

  const newDoc = useCallback(
    (folder) => {
      const p = createDoc({ title: 'Untitled', folder })
      navigate(`/${p}`)
      setTimeout(() => document.querySelector('.doc-title')?.select(), 120)
    },
    [],
  )
  useEffect(
    () =>
      useUI.getState().registerCommands('docs', [
        { id: 'docs.new', title: 'Docs: new doc', run: () => newDoc() },
      ]),
    [newDoc],
  )

  return (
    <div className={`view docs${path ? ' has-doc' : ''}`}>
      <aside className="docs-side">
        <div className="docs-side-head">
          <span className="view-title">Docs</span>
          <Tooltip label="New doc">
            <button type="button" className="ui-icon-button" aria-label="New doc" onClick={() => newDoc()}>
              <Plus size={16} />
            </button>
          </Tooltip>
        </div>
        <div className="docs-search">
          <Input size="sm" icon={Search} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter docs" aria-label="Filter docs" />
        </div>
        <Tree docs={docs} current={path} filter={filter.trim().toLowerCase()} />
        <button
          type="button"
          className="docs-new-folder"
          onClick={() => {
            const name = `Folder ${new Set(docs.map((d) => d.folder).filter(Boolean)).size + 1}`
            newDoc(name)
            toast(`Made “${name}” — rename it from your files, or move docs into it.`)
          }}
        >
          <FolderClosed size={14} /> New folder
        </button>
      </aside>
      <div className="docs-main">
        {path ? (
          <Editor key={path} path={path} />
        ) : (
          <EmptyState icon={FileText} title="No docs yet" action={<Button variant="primary" icon={Plus} onClick={() => newDoc()}>New doc</Button>}>
            Docs are markdown files in your workspace’s docs folder.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
