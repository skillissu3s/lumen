// A board, the way Trello (and obi) shows one: its lists side by side, cards that
// drag from list to list with the others sliding out of the way, and a card that
// opens to everything about it. The board is the list file's markdown.
import { useCallback, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowRight, CalendarDays, CircleCheckBig, Columns3, Flag, Kanban, LayoutGrid, List, ListFilter, MoreHorizontal, Palette, Pencil, Plus, Search, SortAsc, Trash2, X } from 'lucide-react'
import { Button, Dialog, EmptyState, IconBadge, MenuPopup, Popover } from '../../components/ui/index.js'
import { useLists } from '../../store/hooks.js'
import { usePrefs } from '../../store/prefs.js'
import { useWorkspace } from '../../store/workspace.js'
import { navigate } from '../../lib/router.js'
import { deleteList, toggleTask, updateItem, updateListMeta } from '../../lib/actions.js'
import { addCard, addColumn, archiveCard, archiveColumn, archivedCards, deleteCard, moveAllCards, moveCard, deleteColumn, moveColumn, nameLooseList, removeColumn, renameColumn, restoreCard, setColumnColor, setDoneColumn, setUpColumns, sortColumn } from '../../lib/boardActions.js'
import { splitTitle } from '../../lib/colors.js'
import { addDays, todayIso, weekStartOf } from '../../../../shared/dates.js'
import { boardOf } from '../../../../shared/board.js'
import { isOpen, itemDay } from '../../../../shared/items.js'
import { parseQuickAdd } from '../../../../shared/quickadd.js'
import { ListEditor } from '../../shell/ListEditor.jsx'
import { TaskRow } from '../tasks/TaskRow.jsx'
import { Card, Label } from './Card.jsx'
import { CardDialog, Colors, PopHead } from './CardDialog.jsx'
import { useBoardDrag } from './boardDrag.js'
import './boards.css'

// ---------- filters ----------

const NO_FILTER = { q: '', labels: [], due: null, done: true }

function passes(item, f, today) {
  if (!f.done && !isOpen(item.status)) return false
  const { text, tags } = splitTitle(item.title)
  const q = f.q.trim().toLowerCase()
  if (q && !text.toLowerCase().includes(q) && !(item.notes || '').toLowerCase().includes(q)) return false
  if (f.labels.length && !f.labels.some((l) => tags.includes(l))) return false
  if (f.due) {
    const d = itemDay(item)
    if (f.due === 'none') return !d
    if (!d || !isOpen(item.status)) return false
    if (f.due === 'overdue') return d < today
    if (f.due === 'today') return d === today
    if (f.due === 'week') return d <= addDays(today, 7)
  }
  return true
}

const filterCount = (f) => (f.q.trim() ? 1 : 0) + f.labels.length + (f.due ? 1 : 0) + (f.done ? 0 : 1)

function FilterCard({ filter, labels, labelColors, onChange }) {
  const set = (patch) => onChange({ ...filter, ...patch })
  const dues = [
    [null, 'Any time'],
    ['overdue', 'Overdue'],
    ['today', 'Due today'],
    ['week', 'Due in the next week'],
    ['none', 'No due date'],
  ]
  return (
    <div className="pb-filter-body">
      <div className="pb-filter-head">
        <b>Filter</b>
        {filterCount(filter) > 0 && (
          <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={() => onChange(NO_FILTER)}>
            Clear
          </button>
        )}
      </div>
      <div className="td-label">Labels</div>
      {labels.length ? (
        <div className="pb-filter-labels">
          {labels.map((t) => {
            const on = filter.labels.includes(t)
            return (
              <button key={t} type="button" className={`pb-filter-label${on ? ' on' : ''}`} aria-pressed={on} onClick={() => set({ labels: on ? filter.labels.filter((l) => l !== t) : [...filter.labels, t] })}>
                <Label tag={t} color={labelColors[t]} />
              </button>
            )
          })}
        </div>
      ) : (
        <div className="faint pb-filter-none">No labels yet. Add #tags to cards to label them.</div>
      )}
      <div className="td-label">Due</div>
      <div className="pb-filter-dues">
        {dues.map(([v, label]) => (
          <button key={label} type="button" className={`pb-filter-due${filter.due === v ? ' on' : ''}`} aria-pressed={filter.due === v} onClick={() => set({ due: v })}>
            {label}
          </button>
        ))}
      </div>
      <label className="pb-filter-done">
        <input type="checkbox" checked={filter.done} onChange={(e) => set({ done: e.target.checked })} />
        Show done cards
      </label>
    </div>
  )
}

// ---------- adding ----------

/** Adds cards one after another: Enter adds and stays open, Escape closes. A date or a priority can be typed in. */
function Composer({ onAdd, onClose }) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, { today: todayIso() }) : null), [text])
  const submit = () => {
    if (!text.trim()) return
    onAdd(text)
    setText('')
  }
  return (
    <div className="pb-composer" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !text.trim() && onClose()}>
      <textarea
        ref={(el) => el && !el.dataset.f && ((el.dataset.f = '1'), el.focus(), el.scrollIntoView({ block: 'nearest' }))}
        rows={2}
        aria-label="Title of the new card"
        placeholder="Enter a title… “Pay rent fri !high”"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      />
      {parsed?.found.length > 0 && (
        <div className="pb-chips">
          {parsed.found.map((f) => (
            <span key={f.kind} className="pb-chip">
              {f.text}
            </span>
          ))}
        </div>
      )}
      <div className="pb-composer-actions">
        <button type="button" className="ui-button ui-button--primary ui-button--sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add card
        </button>
        <button type="button" className="pop-icon" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function AddList({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!t) return
    onAdd(t)
    setText('')
  }
  if (!open)
    return (
      <button type="button" className="pb-add-list" onClick={() => setOpen(true)}>
        <Plus /> Add another list
      </button>
    )
  return (
    <div className="pb-add-list open" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && !text.trim() && setOpen(false)}>
      <input
        className="pop-input"
        autoFocus
        aria-label="Name of the new list"
        placeholder="Enter list name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      <div className="pb-composer-actions">
        <button type="button" className="ui-button ui-button--primary ui-button--sm" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add list
        </button>
        <button type="button" className="pop-icon" aria-label="Close" onClick={() => setOpen(false)}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

function ArchivePanel({ path, list, text, onClose }) {
  const cards = archivedCards(list, text)
  return (
    <aside className="pb-panel" aria-label="Archived cards">
      <header className="pb-panel-head">
        <Archive />
        <h3>Archived cards</h3>
        <button type="button" className="pop-icon" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="pb-panel-body">
        {!cards.length && <p className="faint">Nothing archived. Archive a card from its menu to put it away without deleting it.</p>}
        {cards.map((c) => (
          <div key={c.id} className="pb-archived">
            <span className="pb-words">{splitTitle(c.title).text || 'Untitled card'}</span>
            <div className="pb-archived-actions">
              <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => restoreCard(path, c.id, null)}>
                <ArchiveRestore size={14} /> Restore
              </button>
              <button type="button" className="ui-button ui-button--ghost ui-button--sm pb-danger" onClick={() => deleteCard(path, c.id)}>
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ---------- the board ----------

export default function BoardPage({ route }) {
  const id = route.parts[1]
  const path = `lists/${id}.md`
  const lists = useLists()
  const text = useWorkspace((s) => s.files[path]?.text)
  const prefs = usePrefs()
  const list = lists.find((l) => l.path === path)
  const [open, setOpen] = useState(route.query.card ? { path, id: route.query.card } : null)
  const [filter, setFilter] = useState(NO_FILTER)
  const [filterAt, setFilterAt] = useState(null)
  const [menu, setMenu] = useState(null) // { anchor, items }
  const [colorAt, setColorAt] = useState(null) // { anchor, column }
  const [composer, setComposer] = useState(null) // the list being added to: its name ('' for the unnamed one)
  const [renaming, setRenaming] = useState(null)
  const [panel, setPanel] = useState(null) // 'archive'
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(null) // { kind: 'board' } or { kind: 'list', name, count }
  const titleRef = useRef(null)
  const lanesEl = useRef(null)
  const h12 = prefs.timeFormat === '12h'
  const today = todayIso()

  const board = useMemo(() => (list ? boardOf(list, text || '') : null), [list, text])
  const columns = useMemo(() => board?.columns.map((c) => ({ ...c, key: c.name ?? '', items: c.items.map((i) => ({ ...i, path, source: { name: list.name, color: list.color } })) })) || [], [board, path, list])
  const shown = useCallback((i) => passes(i, filter, today), [filter, today])
  const labels = useMemo(() => {
    const all = new Set(Object.keys(board?.settings.labels || {}))
    for (const c of columns) for (const i of c.items) for (const t of splitTitle(i.title).tags) all.add(t)
    return [...all].sort((a, b) => a.localeCompare(b))
  }, [board, columns])

  // ---------- dragging (boardDrag.js, from obi) ----------
  const startDrop = (dragged) => {
    if (dragged.kind === 'list') return { list: columns.findIndex((c) => c.key === dragged.id) }
    const lane = columns.find((c) => c.key === dragged.lane)
    return { lane: dragged.lane, index: lane ? lane.items.filter(shown).findIndex((c) => c.id === dragged.id) : 0 }
  }
  const onDrop = (dragged, where) => {
    if (dragged.kind === 'list') {
      const rest = columns.filter((c) => c.key !== dragged.id)
      const before = rest[where.list]
      // (the unnamed list always stays first)
      if (before && !before.name) return
      return moveColumn(path, dragged.id, before?.name ?? null)
    }
    const lane = columns.find((c) => c.key === where.lane)
    if (!lane) return
    // `index` counts the cards shown in the lane (a filter may hide some), the dragged one aside
    const visible = lane.items.filter((c) => shown(c) && c.id !== dragged.id)
    moveCard(path, dragged.id, path, lane.name, visible[where.index]?.id ?? null)
  }
  const { drag, drop, press, justDragged } = useBoardDrag({ lanesRef: lanesEl, onDrop, startDrop })
  const hiding = drag?.id ?? null

  if (!list)
    return (
      <div className="view">
        <EmptyState title="This board doesn’t exist" action={<Button onClick={() => navigate('/tasks')}>All tasks</Button>}>
          It may have been deleted or renamed.
        </EmptyState>
      </div>
    )

  const counts = columns.reduce((n, c) => ({ total: n.total + c.items.length, open: n.open + c.items.filter((i) => isOpen(i.status)).length }), { total: 0, open: 0 })
  const nFilters = filterCount(filter)
  const layout = list.meta?.view === 'list' ? 'list' : 'board'
  const named = columns.filter((c) => c.name)
  const archived = archivedCards(list, text || '').length

  const cardMenu = (e, item, lane) => {
    e.preventDefault()
    const set = (patch) => () => updateItem(path, item.id, patch)
    const nextWeek = weekStartOf(addDays(today, 7), 1)
    setMenu({
      anchor: { x: e.clientX, y: e.clientY },
      items: [
        { label: 'Open card', icon: Pencil, shortcut: 'Enter', onSelect: () => setOpen({ path, id: item.id }) },
        { label: isOpen(item.status) ? 'Mark done' : 'Mark not done', icon: CircleCheckBig, shortcut: 'Space', onSelect: () => toggleTask(path, item.id) },
        ...(named.filter((c) => c.name !== lane.name).length ? [{ section: 'Move to' }] : []),
        ...named.filter((c) => c.name !== lane.name).map((c) => ({ label: c.name, icon: ArrowRight, onSelect: () => moveCard(path, item.id, path, c.name) })),
        { section: 'Due' },
        { label: 'Today', icon: CalendarDays, checked: item.date === today, onSelect: set({ date: today }) },
        { label: 'Tomorrow', icon: CalendarDays, checked: item.date === addDays(today, 1), onSelect: set({ date: addDays(today, 1) }) },
        { label: 'Next week', icon: CalendarDays, checked: item.date === nextWeek, onSelect: set({ date: nextWeek }) },
        ...(item.date ? [{ label: 'No due date', icon: X, onSelect: set({ date: null }) }] : []),
        'separator',
        { label: 'Archive', icon: Archive, onSelect: () => archiveCard(path, item.id) },
        { label: 'Delete card', icon: Trash2, danger: true, onSelect: () => deleteCard(path, item.id) },
      ],
    })
  }

  const listMenu = (e, lane) => {
    const anchor = e.currentTarget
    const others = named.filter((c) => c.name !== lane.name)
    const isDone = board.done && lane.name === board.done
    setMenu({
      anchor,
      items: [
        { label: 'Add a card', icon: Plus, onSelect: () => setComposer(lane.key) },
        { label: lane.name ? 'Rename list' : 'Name this list', icon: Pencil, onSelect: () => setRenaming(lane.key) },
        ...(lane.name
          ? [
              { label: 'Colour…', icon: Palette, onSelect: () => setColorAt({ anchor, column: lane.name }) },
              { label: 'Cards here are done', checked: !!isDone, onSelect: () => setDoneColumn(path, isDone ? null : lane.name) },
            ]
          : []),
        ...(lane.name && lane.items.length > 1
          ? [
              { section: 'Sort cards by' },
              { label: 'Due date', icon: CalendarDays, onSelect: () => sortColumn(path, lane.name, 'due') },
              { label: 'Priority', icon: Flag, onSelect: () => sortColumn(path, lane.name, 'priority') },
              { label: 'Name', icon: SortAsc, onSelect: () => sortColumn(path, lane.name, 'name') },
            ]
          : []),
        ...(lane.name && lane.items.length && others.length ? [{ section: 'Move all cards to' }, ...others.map((o) => ({ label: o.name, icon: ArrowRight, onSelect: () => moveAllCards(path, lane.name, o.name) }))] : []),
        'separator',
        ...(lane.name && lane.items.length ? [{ label: 'Archive all cards in this list', icon: Archive, onSelect: () => archiveColumn(path, lane.name) }] : []),
        ...(lane.name ? [{ label: 'Delete list', icon: Trash2, danger: true, onSelect: () => (lane.items.length ? setConfirm({ kind: 'list', name: lane.name, count: lane.items.length }) : removeColumn(path, lane.name)) }] : []),
      ],
    })
  }

  const boardMenu = (e) =>
    setMenu({
      anchor: e.currentTarget,
      items: [
        { label: 'Edit board…', icon: Pencil, onSelect: () => setEditing(true) },
        { label: archived ? `Archived cards (${archived})` : 'Archived cards', icon: Archive, onSelect: () => setPanel(panel === 'archive' ? null : 'archive') },
        { label: layout === 'list' ? 'Show as board' : 'Show as list', icon: layout === 'list' ? Columns3 : List, onSelect: () => updateListMeta(path, { view: layout === 'list' ? null : 'list' }) },
        ...(!named.length ? [{ label: 'Set up To do, Doing and Done', icon: LayoutGrid, onSelect: () => setUpColumns(path) }] : []),
        'separator',
        { label: 'Delete board…', icon: Trash2, danger: true, onSelect: () => setConfirm({ kind: 'board' }) },
      ],
    })

  const placeholder = (key, h) => <div key={key} className="pb-placeholder" style={{ height: h || 38 }} />
  const dragging = drag?.kind
  let listSlot = 0 // lists drawn so far, but the one being dragged

  return (
    <div className={`view pb${list.color ? ' tinted' : ''}`} style={{ '--project': `var(--c-${list.color || 'blue'})` }}>
      <div className="pb-bar">
        <button type="button" className="pb-icon" title="Edit board" onClick={() => setEditing(true)}>
          <IconBadge name={list.icon} color={list.color || 'gray'} size={26} fallback={Kanban} />
        </button>
        <h2 className="pb-name" ref={titleRef} title="Edit board" onClick={() => setEditing(true)}>
          {list.name}
        </h2>
        <span className="pb-stat">
          {counts.open} open · {counts.total} {counts.total === 1 ? 'card' : 'cards'}
        </span>
        <div className="grow" />
        <label className="pb-search">
          <Search />
          <input placeholder="Filter cards…" aria-label="Filter cards" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setFilter({ ...filter, q: '' })} />
        </label>
        <button type="button" className={`pb-btn${nFilters ? ' on' : ''}`} onClick={(e) => setFilterAt(filterAt ? null : { current: e.currentTarget })}>
          <ListFilter /> Filter{nFilters ? ` · ${nFilters}` : ''}
        </button>
        <button type="button" className={`pb-btn${panel === 'archive' ? ' on' : ''}`} onClick={() => setPanel(panel === 'archive' ? null : 'archive')}>
          <Archive /> Archive{archived ? <span className="pb-pill">{archived}</span> : null}
        </button>
        <button type="button" className="pop-icon pb-more" aria-label="Board menu" onClick={boardMenu}>
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="pb-body">
        {layout === 'list' ? (
          <div className="pb-listview">
            {columns.map((lane) => {
              const cards = lane.items.filter(shown)
              return (
                <section key={lane.key} className="pb-listview-group" style={lane.color ? { '--lc': `var(--c-${lane.color})` } : undefined}>
                  <h3>
                    <i />
                    {lane.name || 'No list'}
                    <span className="pb-count">{cards.length}</span>
                  </h3>
                  {cards.map((item) => (
                    <TaskRow key={item.id} item={item} lists={lists} h12={h12} onOpen={(it) => setOpen({ path, id: it.id })} draggable={false} />
                  ))}
                </section>
              )
            })}
          </div>
        ) : (
          <div className="pb-lanes" ref={lanesEl}>
            {columns.map((lane) => {
              const visible = lane.items.filter(shown)
              const dropping = dragging === 'card' && drop?.lane === lane.key
              // (what is being dragged stays in the page, hidden, so its drag goes on; the gap shows where it would land)
              const items = []
              let n = 0
              for (const c of visible) {
                if (dropping && c.id !== hiding && n === drop.index) items.push(placeholder('ph', drag.height))
                items.push(
                  <Card
                    key={c.id}
                    item={c}
                    labelColors={board.settings.labels}
                    cover={board.settings.covers[c.id]}
                    h12={h12}
                    hidden={c.id === hiding}
                    quiet={justDragged}
                    onOpen={(it) => setOpen({ path, id: it.id })}
                    onMenu={(e) => cardMenu(e, c, lane)}
                    onPress={(e) => press(e, { kind: 'card', id: c.id, lane: lane.key })}
                  />,
                )
                if (c.id !== hiding) n++
              }
              if (dropping && drop.index >= n) items.push(placeholder('ph', drag.height))
              const out = []
              if (dragging === 'list' && hiding !== lane.key && drop?.list === listSlot) out.push(<div key={`lph-${lane.key}`} className="pb-list pb-list-placeholder" style={{ height: drag.height }} />)
              if (hiding !== lane.key) listSlot++
              const isDone = board.done && lane.name === board.done
              out.push(
                <section
                  key={lane.key || '\u0000'}
                  className={`pb-list${hiding === lane.key ? ' is-dragging' : ''}${dropping ? ' over' : ''}`}
                  style={lane.color ? { '--lc': `var(--c-${lane.color})` } : undefined}
                  data-color={lane.color || undefined}
                  data-lane={lane.key}
                  aria-label={`${lane.name || 'No list'}, ${visible.length} ${visible.length === 1 ? 'card' : 'cards'}`}
                >
                  <header className="pb-list-head" onPointerDown={!lane.name || renaming === lane.key ? undefined : (e) => press(e, { kind: 'list', id: lane.key, el: e.currentTarget.closest('.pb-list') })}>
                    {renaming === lane.key ? (
                      <input
                        className="pop-input pb-rename"
                        autoFocus
                        defaultValue={lane.name || ''}
                        placeholder="List name"
                        aria-label="List name"
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => {
                          const v = e.target.value.replace(/\s+/g, ' ').trim()
                          setRenaming(null)
                          if (!v || v === lane.name) return
                          if (lane.name) renameColumn(path, lane.name, v)
                          else nameLooseList(path, v)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') {
                            e.currentTarget.value = lane.name || ''
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    ) : (
                      <h3 className={lane.name ? '' : 'unnamed'} onClick={() => !justDragged() && setRenaming(lane.key)} title={lane.name ? 'Rename list' : 'Name this list'}>
                        {lane.name || 'No list'}
                        {isDone && <CircleCheckBig className="pb-done-mark" aria-label="Cards here are done" />}
                      </h3>
                    )}
                    <span className="pb-count">{nFilters ? `${visible.length}/${lane.items.length}` : lane.items.length}</span>
                    <button type="button" className="pop-icon" aria-label={`${lane.name || 'List'} menu`} onClick={(e) => listMenu(e, lane)}>
                      <MoreHorizontal size={16} />
                    </button>
                  </header>
                  <div className="pb-cards">
                    {items}
                    {!visible.length && !dropping && lane.items.length > 0 && <div className="pb-hidden">{lane.items.length} hidden by the filter</div>}
                  </div>
                  {composer === lane.key ? (
                    <Composer onAdd={(t) => addCard(path, lane.name, t)} onClose={() => setComposer(null)} />
                  ) : (
                    <button type="button" className="pb-add-card" onClick={() => setComposer(lane.key)}>
                      <Plus /> Add a card
                    </button>
                  )}
                </section>,
              )
              return out
            })}
            {dragging === 'list' && drop?.list >= listSlot && <div className="pb-list pb-list-placeholder" style={{ height: drag.height }} />}
            <AddList onAdd={(t) => addColumn(path, t)} />
          </div>
        )}
        {panel === 'archive' && <ArchivePanel path={path} list={list} text={text || ''} onClose={() => setPanel(null)} />}
      </div>

      <Popover open={!!filterAt} onOpenChange={(o) => !o && setFilterAt(null)} anchor={filterAt} placement="bottom-end" className="pb-filter">
        <FilterCard filter={filter} labels={labels} labelColors={board.settings.labels} onChange={setFilter} />
      </Popover>
      <Popover open={!!colorAt} onOpenChange={(o) => !o && setColorAt(null)} anchor={colorAt?.anchor} placement="bottom-end" className="color-pop">
        {colorAt && (
          <>
            <PopHead title="List colour" onClose={() => setColorAt(null)} />
            <div className="pop-body">
              <Colors value={columns.find((c) => c.name === colorAt.column)?.color} onPick={(c) => setColumnColor(path, colorAt.column, c)} />
              {columns.find((c) => c.name === colorAt.column)?.color && (
                <button type="button" className="lp-create" onClick={() => setColumnColor(path, colorAt.column, null)}>
                  Remove colour
                </button>
              )}
            </div>
          </>
        )}
      </Popover>
      {menu && <MenuPopup anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}
      {open && <CardDialog path={open.path} id={open.id} onClose={() => setOpen(null)} />}
      <ListEditor open={editing} onOpenChange={setEditing} anchor={titleRef} initial={list} onSave={(v) => updateListMeta(path, v)} />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm?.kind === 'list' ? `Delete “${confirm.name}”?` : `Delete “${list.name}”?`}
        description={confirm?.kind === 'list' ? `Its ${confirm.count} ${confirm.count === 1 ? 'card goes' : 'cards go'} with it.` : 'The board and all its cards will be removed.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm.kind === 'list') deleteColumn(path, confirm.name)
                else {
                  deleteList(path)
                  navigate('/tasks')
                }
                setConfirm(null)
              }}
            >
              {confirm?.kind === 'list' ? 'Delete list' : 'Delete board'}
            </Button>
          </>
        }
      />
    </div>
  )
}
