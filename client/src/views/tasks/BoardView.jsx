// A list as a board: columns by status, priority or date. Moving a card
// changes that field on the task's line.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { TaskCheckbox } from '../../components/ui/index.js'
import { addTask, toggleTask, updateItem } from '../../lib/actions.js'
import { relativeDay, todayIso } from '../../../../shared/dates.js'
import { isOpen, itemDay } from '../../../../shared/items.js'
import { BOARD, progressOf } from './taskQueries.js'

function Card({ item, onOpen, colIndex, cols, onMove }) {
  const today = todayIso()
  const day = itemDay(item)
  const prog = progressOf(item)
  return (
    <div
      className={`bcard${isOpen(item.status) ? '' : ' is-done'}`}
      tabIndex={0}
      role="listitem"
      draggable
      aria-label={item.title}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-lumen-item', JSON.stringify({ path: item.path, id: item.id }))
      }}
      onClick={(e) => !e.target.closest('button') && onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(item)
        else if (e.key === ' ') {
          e.preventDefault()
          toggleTask(item.path, item.id)
        } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault()
          const to = cols[colIndex + (e.key === 'ArrowRight' ? 1 : -1)]
          if (to) onMove(item, to.id)
        }
      }}
    >
      <div className="bcard-top">
        <TaskCheckbox status={item.status} label="Complete" onToggle={() => toggleTask(item.path, item.id)} tabIndex={-1} />
        <span className="bcard-title">
          {item.icon && <span className="trow-icon">{item.icon}</span>}
          {item.label || item.title}
        </span>
      </div>
      {(day || prog.total || item.priority) && (
        <div className="bcard-meta">
          {day && <span className={`tmeta${isOpen(item.status) && day < today ? ' is-late' : ''}`}>{relativeDay(day, today)}</span>}
          {prog.total > 0 && <span className="tmeta tabular">{`${prog.done}/${prog.total}`}</span>}
          {item.priority && <span className="tmeta">{item.priority}</span>}
        </div>
      )}
    </div>
  )
}

export function BoardView({ list, group = 'status', onOpen }) {
  const today = todayIso()
  const spec = BOARD[group] || BOARD.status
  const items = list.items.filter((i) => i.kind === 'task').map((i) => ({ ...i, path: list.path }))
  const [over, setOver] = useState(null)
  const [adding, setAdding] = useState(null)
  const move = (item, col) => {
    if (spec.of(item, today) === col) return
    const patch = spec.patch(col, today)
    if (!patch) return
    if (!patch.status && !isOpen(item.status)) patch.status = ' '
    updateItem(item.path, item.id, patch)
  }
  return (
    <div className="board" role="list" aria-label={`${list.name} board`}>
      {spec.columns.map((col, ci) => {
        const cards = items.filter((i) => spec.of(i, today) === col.id && (col.id === 'done' || isOpen(i.status) || group === 'status'))
        return (
          <section
            key={col.id}
            className={`bcol${over === col.id ? ' is-over' : ''}`}
            aria-label={col.label}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-lumen-item')) return
              e.preventDefault()
              setOver(col.id)
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(null)}
            onDrop={(e) => {
              setOver(null)
              const raw = e.dataTransfer.getData('application/x-lumen-item')
              if (!raw) return
              const { id } = JSON.parse(raw)
              const item = items.find((i) => i.id === id)
              if (item) move(item, col.id)
            }}
          >
            <header className="bcol-head">
              <span>{col.label}</span>
              <span className="bcol-count">{cards.length}</span>
            </header>
            <div className="bcol-cards" role="list">
              {cards.map((item) => (
                <Card key={item.id} item={item} onOpen={onOpen} colIndex={ci} cols={spec.columns} onMove={move} />
              ))}
            </div>
            {col.id !== 'done' && col.id !== 'overdue' &&
              (adding === col.id ? (
                <input
                  className="bcol-input"
                  autoFocus
                  placeholder="Task name"
                  aria-label={`New task in ${col.label}`}
                  onBlur={(e) => {
                    if (e.target.value.trim()) addTask(list.path, { title: e.target.value.trim(), ...spec.patch(col.id, today) })
                    setAdding(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      addTask(list.path, { title: e.currentTarget.value.trim(), ...spec.patch(col.id, today) })
                      e.currentTarget.value = ''
                    } else if (e.key === 'Escape') setAdding(null)
                  }}
                />
              ) : (
                <button type="button" className="bcol-add" onClick={() => setAdding(col.id)}>
                  <Plus size={14} /> Add
                </button>
              ))}
          </section>
        )
      })}
    </div>
  )
}
