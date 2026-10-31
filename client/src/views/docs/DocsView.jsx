// Docs: plain markdown documents beside your tasks. A tree on the left, a
// focused editor with a preview on the right. Front matter stays out of sight.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bold, ChevronRight, Code, Download, FileText, FolderClosed, Heading2, Italic, Link2, List, ListChecks, MoreHorizontal, Plus, Quote, Search, Table2, Trash2 } from 'lucide-react'
import { Button, Dialog, EmptyState, Input, Menu, Segmented, Spinner, Tooltip } from '../../components/ui/index.js'
import { useDocs } from '../../store/hooks.js'
import { useWorkspace } from '../../store/workspace.js'
import { useSession } from '../../store/session.js'
import { useUI } from '../../store/ui.js'
import { navigate } from '../../lib/router.js'
import { createDoc, deleteDoc, renameDoc, saveDoc } from '../../lib/actions.js'
import { setFrontMatter, splitFrontMatter } from '../../../../shared/frontmatter.js'
import { ShareField } from '../../shell/ListEditor.jsx'
import { renderMarkdown, toggleTaskInBody } from './markdown.js'
import './docs.css'

const LAST = 'lumen.docs.last'
const MODE = 'lumen.docs.mode'
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
                    <FileText size={14} />
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

// small helpers that act on the textarea's selection
function wrapSelection(el, before, after = before, placeholder = '') {
  const { selectionStart: a, selectionEnd: b, value } = el
  const inner = value.slice(a, b) || placeholder
  const next = value.slice(0, a) + before + inner + after + value.slice(b)
  return { text: next, sel: [a + before.length, a + before.length + inner.length] }
}
function prefixLines(el, prefix) {
  const { selectionStart: a, selectionEnd: b, value } = el
  const start = value.lastIndexOf('\n', a - 1) + 1
  const end = value.indexOf('\n', b) === -1 ? value.length : value.indexOf('\n', b)
  const block = value
    .slice(start, end)
    .split('\n')
    .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l))
    .join('\n')
  return { text: value.slice(0, start) + block + value.slice(end), sel: [start, start + block.length] }
}

function Editor({ path }) {
  const file = useWorkspace((s) => s.files[path])
  const saving = useWorkspace((s) => s.saving)
  const mode = useSession((s) => s.mode)
  const [loaded, setLoaded] = useState(!!file)
  const [view, setView] = useState(() => store.get(MODE, 'write'))
  const [body, setBody] = useState('')
  const [title, setTitle] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [share, setShare] = useState(false)
  const taRef = useRef(null)
  const focused = useRef(false)
  const timer = useRef(null)
  const latest = useRef({ head: '', body: '' })

  useEffect(() => {
    let alive = true
    if (!file) useWorkspace.getState().ensure(path).then(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  // take the file's text, except while typing (the store merges our edits)
  useEffect(() => {
    if (!file) return
    setLoaded(true)
    const p = parts(file.text)
    latest.current = p
    const meta = splitFrontMatter(file.text).meta
    if (!focused.current || document.activeElement?.dataset?.doc !== 'title') setTitle(meta.title || path.split('/').pop().replace(/\.md$/, ''))
    if (!focused.current) setBody(p.body)
  }, [file?.text, path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(timer.current), [path])
  useEffect(() => store.set(MODE, view), [view])

  const schedule = (nextBody) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => saveDoc(path, latest.current.head + nextBody), 600)
  }
  const change = (next, sel) => {
    setBody(next)
    schedule(next)
    if (sel) requestAnimationFrame(() => taRef.current?.setSelectionRange(...sel))
  }
  const act = (fn) => () => {
    const el = taRef.current
    if (!el) return
    el.focus()
    const r = fn(el)
    change(r.text, r.sel)
  }
  const tools = [
    { icon: Heading2, label: 'Heading', run: act((el) => prefixLines(el, '## ')) },
    { icon: Bold, label: 'Bold (Ctrl B)', run: act((el) => wrapSelection(el, '**', '**', 'bold')) },
    { icon: Italic, label: 'Italic (Ctrl I)', run: act((el) => wrapSelection(el, '_', '_', 'italic')) },
    { icon: Link2, label: 'Link (Ctrl K)', run: act((el) => wrapSelection(el, '[', '](https://)', 'text')) },
    { icon: List, label: 'Bulleted list', run: act((el) => prefixLines(el, '- ')) },
    { icon: ListChecks, label: 'Checklist', run: act((el) => prefixLines(el, '- [ ] ')) },
    { icon: Quote, label: 'Quote', run: act((el) => prefixLines(el, '> ')) },
    { icon: Code, label: 'Code', run: act((el) => wrapSelection(el, '`', '`', 'code')) },
    { icon: Table2, label: 'Table', run: act((el) => wrapSelection(el, '\n| Column | Column |\n| --- | --- |\n| ', ' |  |\n', 'Cell')) },
  ]

  const onKeyDown = (e) => {
    const el = e.currentTarget
    const mod = e.ctrlKey || e.metaKey
    if (mod && ['b', 'i', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault()
      e.stopPropagation()
      const r = e.key.toLowerCase() === 'b' ? wrapSelection(el, '**', '**', 'bold') : e.key.toLowerCase() === 'i' ? wrapSelection(el, '_', '_', 'italic') : wrapSelection(el, '[', '](https://)', 'text')
      return change(r.text, r.sel)
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const r = wrapSelection(el, '  ', '', '')
      return change(r.text, [r.sel[0], r.sel[0]])
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // continue a list or checklist
      const { selectionStart: a, value } = el
      const lineStart = value.lastIndexOf('\n', a - 1) + 1
      const line = value.slice(lineStart, a)
      const m = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/.exec(line)
      if (!m) return
      e.preventDefault()
      if (line.trim() === m[0].trim()) {
        // an empty item ends the list
        const next = value.slice(0, lineStart) + value.slice(a)
        return change(next, [lineStart, lineStart])
      }
      const num = /^\d+/.test(m[2]) ? `${+m[2].replace(/\D/g, '') + 1}${m[2].slice(-1)}` : m[2]
      const insert = `\n${m[1]}${num}${m[3] ? ' [ ]' : ''} `
      const next = value.slice(0, a) + insert + value.slice(el.selectionEnd)
      change(next, [a + insert.length, a + insert.length])
    }
  }

  const html = useMemo(() => (view === 'write' ? '' : renderMarkdown(body)), [body, view])
  const onPreviewClick = (e) => {
    const box = e.target.closest('input[data-task]')
    if (!box) return
    change(toggleTaskInBody(body, +box.dataset.task))
  }

  if (!loaded) return <div className="view-loading"><Spinner size={16} /></div>
  if (!file) return <EmptyState title="This doc doesn’t exist" action={<Button onClick={() => navigate('/docs')}>Back to Docs</Button>}>It may have been moved or deleted.</EmptyState>

  const meta = splitFrontMatter(file.text).meta
  const status = saving.pending ? 'Saving…' : 'Saved'
  return (
    <div className="doc">
      <header className="view-header doc-header">
        <a className="doc-crumb" href="#/docs?all=1">
          {path.replace(/^docs\//, '').replace(/[^/]+$/, '').replace(/\/$/, '').replaceAll('/', ' / ') || 'Docs'}
        </a>
        <span className="doc-status faint">{status}</span>
        <div className="view-actions">
          <Segmented
            label="Mode"
            value={view}
            onChange={setView}
            options={[
              { value: 'write', label: 'Write' },
              { value: 'split', label: 'Split' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
          <Menu
            align="end"
            items={[
              ...(mode === 'server' ? [{ label: 'Share…', onSelect: () => setShare(true) }] : []),
              { label: 'Download .md', icon: Download, onSelect: () => {
                const a = document.createElement('a')
                a.href = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }))
                a.download = path.split('/').pop()
                a.click()
              } },
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
      <div className={`doc-body is-${view}`}>
        {view !== 'preview' && (
          <div className="doc-write">
            <input
              className="doc-title"
              data-doc="title"
              value={title}
              placeholder="Untitled"
              aria-label="Title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title.trim() !== meta.title && renameDoc(path, title.trim())}
              onKeyDown={(e) => e.key === 'Enter' && taRef.current?.focus()}
            />
            <div className="doc-tools" role="toolbar" aria-label="Formatting">
              {tools.map((t) => (
                <Tooltip key={t.label} label={t.label}>
                  <button type="button" className="doc-tool" aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.run}>
                    <t.icon size={15} />
                  </button>
                </Tooltip>
              ))}
            </div>
            <textarea
              ref={taRef}
              className="doc-textarea"
              value={body}
              placeholder="Start writing…"
              aria-label="Document"
              spellCheck
              onFocus={() => (focused.current = true)}
              onBlur={() => {
                focused.current = false
                clearTimeout(timer.current)
                if (body !== latest.current.body) saveDoc(path, latest.current.head + body)
              }}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
        )}
        {view !== 'write' && (
          <article className="doc-preview md" onClick={onPreviewClick}>
            {view === 'preview' && <h1 className="doc-preview-title">{title}</h1>}
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        )}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Delete “${title}”?`}
        description="This removes the file. With GitHub sync, it stays in the history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
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
      setTimeout(() => document.querySelector('.doc-title')?.select(), 80)
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
