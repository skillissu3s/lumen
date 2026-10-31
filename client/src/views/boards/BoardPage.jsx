// A board: its columns side by side, cards that drag between them, a card that
// opens to everything about it. The board is the list file's markdown.
import { useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Columns3, Kanban, LayoutGrid, List, MoreHorizontal, Palette, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { Button, ColorPicker, Dialog, EmptyState, IconBadge, Menu, Popover, Segmented } from '../../components/ui/index.js'
import { useLists } from '../../store/hooks.js'
import { usePrefs } from '../../store/prefs.js'
import { useWorkspace } from '../../store/workspace.js'
import { navigate } from '../../lib/router.js'
import { deleteList, updateListMeta } from '../../lib/actions.js'
import { addCard, addColumn, moveCard, moveColumn, removeColumn, renameColumn, setColumnColor, setDoneColumn, setUpColumns } from '../../lib/boardActions.js'
import { boardOf, boardProgress } from '../../../../shared/board.js'
import { isOpen } from '../../../../shared/items.js'
import { ListEditor } from '../../shell/ListEditor.jsx'
import { QuickAdd } from '../tasks/QuickAdd.jsx'
import { TaskRow } from '../tasks/TaskRow.jsx'
import { Card } from './Card.jsx'
import { CardDialog } from './CardDialog.jsx'
import './boards.css'

const DRAG_COL = 'application/x-lumen-column'

function ColumnHead({ path, col, isDone, count, columns, index }) {
  const [renaming, setRenaming] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const ref = useRef(null)
  const [confirm, setConfirm] = useState(false)
  if (!col.name)
    return (
      <header className="col-head">
        <span className="col-name faint">No column</span>
        <span className="col-count">{count}</span>
      </header>
    )
  return (
    <header
      ref={ref}
      className="col-head"
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(DRAG_COL, col.name)
      }}
    >
      {renaming ? (
        <input
          className="col-rename"
          defaultValue={col.name}
          autoFocus
          aria-label="Column name"
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v && v !== col.name) renameColumn(path, col.name, v)
            setRenaming(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <h3 className="col-name" onDoubleClick={() => setRenaming(true)}>
          {col.name}
          {isDone && <Check size={13} className="col-done-mark" aria-label="Cards here are done" />}
        </h3>
      )}
      <span className="col-count">{count}</span>
      <Menu
        align="end"
        items={[
          { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
          { label: 'Colour…', icon: Palette, onSelect: () => setColorOpen(true) },
          { label: 'Cards here are done', checked: isDone, onSelect: () => setDoneColumn(path, isDone ? null : col.name) },
          'separator',
          { label: 'Move left', icon: ChevronLeft, disabled: index <= 0 || !columns[index - 1]?.name, onSelect: () => moveColumn(path, col.name, columns[index - 1].name) },
          { label: 'Move right', icon: ChevronRight, disabled: index >= columns.length - 1, onSelect: () => moveColumn(path, col.name, columns[index + 2]?.name ?? null) },
          'separator',
          { label: 'Delete column', icon: Trash2, danger: true, onSelect: () => (count ? setConfirm(true) : removeColumn(path, col.name)) },
        ]}
        trigger={
          <button type="button" className="col-more" aria-label={`${col.name} options`}>
            <MoreHorizontal size={15} />
          </button>
        }
      />
      <Popover open={colorOpen} onOpenChange={setColorOpen} anchor={ref} placement="bottom-start">
        <div className="cover-editor">
          <b>Column colour</b>
          <ColorPicker
            value={col.color}
            onChange={(c) => {
              setColumnColor(path, col.name, c === col.color ? null : c)
              setColorOpen(false)
            }}
          />
        </div>
      </Popover>
      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm" title={`“${col.name}” still has cards`} description="Move or delete its cards first, then delete the column." footer={<Button onClick={() => setConfirm(false)}>OK</Button>} />
    </header>
  )
}

function Column({ path, col, board, index, settings, onOpen, filter, h12 }) {
  const [over, setOver] = useState(null) // { before: id | null }
  const [colOver, setColOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const cards = col.items.filter(filter)
  const isDone = board.done === col.name
  const dropCard = (e, before) => {
    const raw = e.dataTransfer.getData('application/x-lumen-item')
    if (!raw) return false
    e.preventDefault()
    const { path: from, id } = JSON.parse(raw)
    if (id === before) return true
    moveCard(from, id, path, col.name, before)
    return true
  }
  return (
    <section
      className={`col${over ? ' is-over' : ''}${colOver ? ' is-col-over' : ''}`}
      style={col.color ? { '--col': `var(--c-${col.color})`, '--col-bg': `var(--c-${col.color}-bg)` } : undefined}
      aria-label={`${col.name || 'No column'}, ${cards.length} cards`}
      onDragOver={(e) => {
        const types = e.dataTransfer.types
        if (types.includes(DRAG_COL) && col.name) {
          e.preventDefault()
          setColOver(true)
          return
        }
        if (!types.includes('application/x-lumen-item')) return
        e.preventDefault()
        if (!over) setOver({ before: null })
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return
        setOver(null)
        setColOver(false)
      }}
      onDrop={(e) => {
        const colName = e.dataTransfer.getData(DRAG_COL)
        setOver(null)
        setColOver(false)
        if (colName) {
          e.preventDefault()
          if (colName !== col.name) moveColumn(path, colName, col.name)
          return
        }
        dropCard(e, over?.before ?? null)
      }}
    >
      <ColumnHead path={path} col={col} isDone={isDone} count={cards.length} columns={board.columns} index={index} />
      <div className="col-cards">
        {cards.map((item) => (
          <div
            key={item.id}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-lumen-item')) return
              const r = e.currentTarget.getBoundingClientRect()
              const before = e.clientY < r.top + r.height / 2 ? item.id : cards[cards.indexOf(item) + 1]?.id ?? null
              if (over?.before !== before) setOver({ before })
            }}
          >
            {over && over.before === item.id && <div className="drop-line" />}
            <Card item={item} labelColors={settings.labels} cover={settings.covers[item.id]} h12={h12} onOpen={onOpen} />
          </div>
        ))}
        {over && over.before === null && <div className="drop-line" />}
        {!cards.length && !over && <div className="col-empty">{isDone ? 'Finished cards land here' : 'No cards'}</div>}
      </div>
      {adding ? (
        <div className="col-composer">
          <QuickAdd placeholder="Card title — “Draft intro fri !high”" onAdd={(f) => addCard(path, col.name, f)} ref={(r) => r?.focus()} />
          <div className="col-composer-actions">
            <span className="faint">Enter to add · Esc to close</span>
            <button type="button" className="ui-icon-button ui-icon-button--sm" aria-label="Close" onClick={() => setAdding(false)}>
              <X />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="col-add" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add a card
        </button>
      )}
    </section>
  )
}

function AddColumn({ path }) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <button type="button" className="col-new" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add column
      </button>
    )
  return (
    <div className="col col-new-form">
      <input
        autoFocus
        placeholder="Column name"
        aria-label="New column name"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
            addColumn(path, e.currentTarget.value.trim())
            e.currentTarget.value = ''
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        onBlur={(e) => {
          if (e.target.value.trim()) addColumn(path, e.target.value.trim())
          setOpen(false)
        }}
      />
    </div>
  )
}

export default function BoardPage({ route }) {
  const id = route.parts[1]
  const path = `lists/${id}.md`
  const lists = useLists()
  const text = useWorkspace((s) => s.files[path]?.text)
  const prefs = usePrefs()
  const list = lists.find((l) => l.path === path)
  const [open, setOpen] = useState(route.query.card ? { path, id: route.query.card } : null)
  const [q, setQ] = useState('')
  const [showDone, setShowDone] = useState(true)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const titleRef = useRef(null)
  const h12 = prefs.timeFormat === '12h'

  const board = useMemo(() => (list ? boardOf(list, text || '') : null), [list, text])
  const columns = useMemo(() => board?.columns.map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, path, source: { name: list.name, color: list.color } })) })) || [], [board, path, list])

  if (!list)
    return (
      <div className="view">
        <EmptyState title="This board doesn’t exist" action={<Button onClick={() => navigate('/tasks')}>All tasks</Button>}>
          It may have been deleted or renamed.
        </EmptyState>
      </div>
    )

  const needle = q.trim().toLowerCase()
  const filter = (i) => (showDone || isOpen(i.status)) && (!needle || i.title.toLowerCase().includes(needle))
  const progress = boardProgress(board)
  const layout = list.meta?.view === 'list' ? 'list' : 'board'

  return (
    <div className="view board-view">
      <header className="view-header board-header">
        <h1 className="view-title" ref={titleRef}>
          <IconBadge name={list.icon} color={list.color || 'gray'} size={26} fallback={Kanban} />
          <span>{list.name}</span>
        </h1>
        {progress.total > 0 && (
          <span className="board-progress" title={`${progress.finished} of ${progress.total} done`}>
            <span className="board-progress-bar">
              <i style={{ width: `${(progress.finished / progress.total) * 100}%`, background: `var(--c-${list.color || 'blue'})` }} />
            </span>
            <span className="tabular">
              {progress.finished}/{progress.total}
            </span>
          </span>
        )}
        <div className="view-actions">
          <label className="board-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter cards" aria-label="Filter cards" />
          </label>
          <Segmented
            label="Layout"
            value={layout}
            onChange={(v) => updateListMeta(path, { view: v === 'list' ? 'list' : null })}
            options={[
              { value: 'board', label: 'Board', icon: Columns3 },
              { value: 'list', label: 'List', icon: List },
            ]}
          />
          <Menu
            align="end"
            items={[
              { label: 'Show finished cards', checked: showDone, onSelect: () => setShowDone(!showDone) },
              'separator',
              { label: 'Edit board…', icon: Pencil, onSelect: () => setEditing(true) },
              { label: 'Delete board…', icon: Trash2, danger: true, onSelect: () => setConfirm(true) },
            ]}
            trigger={
              <button type="button" className="ui-icon-button" aria-label="Board options">
                <MoreHorizontal size={16} />
              </button>
            }
          />
        </div>
      </header>

      {layout === 'board' && columns.length === 1 && columns[0].name === null && (
        <div className="board-setup">
          <LayoutGrid size={16} />
          <span>This board has no columns yet. Sort its cards into To do, Doing and Done to move them along as work progresses.</span>
          <Button size="sm" variant="primary" onClick={() => setUpColumns(path)}>
            Set up columns
          </Button>
        </div>
      )}
      {layout === 'board' ? (
        <div className="board">
          {columns.map((col, i) => (
            <Column key={col.name ?? '\u0000'} path={path} col={col} board={board} index={i} settings={board.settings} onOpen={(item) => setOpen({ path, id: item.id })} filter={filter} h12={h12} />
          ))}
          <AddColumn path={path} />
        </div>
      ) : (
        <div className="view-body">
          <div className="board-list">
            <QuickAdd placeholder={`Add a card to ${columns[0]?.name || list.name}`} onAdd={(f) => addCard(path, columns[0]?.name ?? null, f)} />
            {columns.map((col) => {
              const cards = col.items.filter(filter)
              return (
                <section key={col.name ?? '\u0000'} className="board-list-group">
                  <h3 style={col.color ? { '--col': `var(--c-${col.color})` } : undefined}>
                    <i />
                    {col.name || 'No column'}
                    <span className="col-count">{cards.length}</span>
                  </h3>
                  {cards.map((item) => (
                    <TaskRow key={item.id} item={item} lists={lists} h12={h12} onOpen={(it) => setOpen({ path, id: it.id })} draggable={false} />
                  ))}
                </section>
              )
            })}
          </div>
        </div>
      )}

      {open && <CardDialog path={open.path} id={open.id} onClose={() => setOpen(null)} />}
      <ListEditor open={editing} onOpenChange={setEditing} anchor={titleRef} initial={list} onSave={(v) => updateListMeta(path, v)} />
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Delete “${list.name}”?`}
        description="The board and all its cards will be removed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteList(path)
                setConfirm(false)
                navigate('/tasks')
              }}
            >
              Delete board
            </Button>
          </>
        }
      />
    </div>
  )
}
