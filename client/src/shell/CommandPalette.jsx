// Ctrl/⌘ K: jump anywhere, find any task or doc, run any command.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarRange, CircleCheck, Command, FileText, Hash, Inbox, MessagesSquare, Plus, Search, Settings, Sun } from 'lucide-react'
import { useUI } from '../store/ui.js'
import { useSession } from '../store/session.js'
import { useAllItems, useDocs, useLists, usePlugins } from '../store/hooks.js'
import { navigate } from '../lib/router.js'
import { createDoc } from '../lib/actions.js'
import { isOpen } from '../../../shared/items.js'
import { iconByName } from './icons.js'
import { Kbd } from '../components/ui/index.js'
import { comboKeys } from './shortcuts.js'

// subsequence match, scored: earlier, contiguous and word-start matches rank higher
function score(text, q) {
  if (!q) return 1
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) return 1000 - direct - (t.length - q.length) * 0.1 + (direct === 0 || t[direct - 1] === ' ' ? 200 : 0)
  let at = 0
  let s = 0
  for (const ch of q) {
    const i = t.indexOf(ch, at)
    if (i < 0) return 0
    s += i === at ? 3 : 1
    at = i + 1
  }
  return s
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const close = useUI((s) => s.closePalette)
  const commandMap = useUI((s) => s.commandMap)
  const mode = useSession((s) => s.mode)
  const lists = useLists()
  const docs = useDocs()
  const plugins = usePlugins()
  const items = useAllItems()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const entries = useMemo(() => {
    const go = (p) => () => navigate(p)
    const out = [
      { section: 'Go to', label: 'Today', icon: Sun, run: go('/today') },
      { section: 'Go to', label: 'Inbox', icon: Inbox, run: go('/inbox') },
      { section: 'Go to', label: 'Upcoming', icon: CalendarRange, run: go('/upcoming') },
      { section: 'Go to', label: 'Calendar', icon: CalendarDays, run: go('/calendar') },
      { section: 'Go to', label: 'Docs', icon: FileText, run: go('/docs') },
      ...(mode === 'server' ? [{ section: 'Go to', label: 'Chat', icon: MessagesSquare, run: go('/chat') }] : []),
      { section: 'Go to', label: 'Settings', icon: Settings, run: go('/settings') },
      ...lists.map((l) => ({ section: 'Lists', label: l.name, emoji: l.icon, icon: Hash, run: go(`/list/${l.id}`) })),
      ...plugins.filter((p) => p.manifest.view).map((p) => ({ section: 'Plugins', label: p.manifest.view.title || p.manifest.name, icon: iconByName(p.manifest.icon), run: go(`/plugin/${p.id}`) })),
      { section: 'Create', label: 'New task', icon: Plus, run: () => window.dispatchEvent(new CustomEvent('lumen:quick-add')) },
      { section: 'Create', label: 'New event', icon: Plus, run: () => navigate('/calendar?new=1') },
      {
        section: 'Create',
        label: 'New doc',
        icon: Plus,
        run: () => {
          const p = createDoc({ title: 'Untitled' })
          navigate(`/${p}`)
        },
      },
      ...Object.values(commandMap).map((c) => ({ section: c.section || 'Commands', label: c.title, icon: Command, shortcut: c.shortcut, run: c.run })),
    ]
    return out
  }, [lists, plugins, mode, commandMap])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let found = entries.map((e) => ({ ...e, s: score(e.label, needle) })).filter((e) => e.s > 0)
    if (needle.length >= 2) {
      const tasks = items
        .filter((i) => i.kind === 'task' && isOpen(i.status))
        .map((i) => ({ section: 'Tasks', label: i.label || i.title, emoji: i.icon, icon: CircleCheck, hint: i.source.name, s: score(i.label || i.title, needle) * 0.9, run: () => navigate(`/list/${i.path.slice(6, -3)}?task=${i.id}`) }))
        .filter((e) => e.s > 0)
      const docHits = docs.map((d) => ({ section: 'Docs', label: d.title, icon: FileText, hint: d.folder, s: score(d.title, needle) * 0.9, run: () => navigate(`/${d.path}`) })).filter((e) => e.s > 0)
      found = [...found, ...tasks, ...docHits]
      found.sort((a, b) => b.s - a.s)
    }
    return found.slice(0, 40)
  }, [entries, items, docs, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null
  const run = (e) => {
    close()
    setTimeout(() => e.run(), 0)
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[active]) run(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  let lastSection = null
  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search tasks, docs and commands…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          />
          <kbd className="palette-esc">Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((r, i) => {
            const head = r.section !== lastSection ? r.section : null
            lastSection = r.section
            const Icon = r.icon
            return (
              <div key={`${r.section}-${r.label}-${i}`}>
                {head && <div className="palette-section">{head}</div>}
                <div
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className="palette-item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(r)}
                >
                  <span className="palette-icon">{r.emoji || (Icon && <Icon size={15} strokeWidth={1.75} />)}</span>
                  <span className="palette-label">{r.label}</span>
                  {r.hint && <span className="palette-hint">{r.hint}</span>}
                  {r.shortcut && <Kbd keys={comboKeys(r.shortcut)} />}
                </div>
              </div>
            )
          })}
          {!results.length && <div className="palette-empty">Nothing matches “{q}”.</div>}
        </div>
      </div>
    </div>
  )
}
