// Everything about one task, on the right. Each change saves at once.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Copy, Plus, Trash2, X } from 'lucide-react'
import { Button, DateField, DurationField, EmojiPicker, IconButton, Popover, Segmented, Select, TaskCheckbox, TimeField, Textarea } from '../../components/ui/index.js'
import { useLists } from '../../store/hooks.js'
import { usePrefs } from '../../store/prefs.js'
import { useWorkspace } from '../../store/workspace.js'
import { addTask, deleteItem, moveItemToFile, toggleTask, updateItem } from '../../lib/actions.js'
import { navigate } from '../../lib/router.js'
import { relativeDay } from '../../../../shared/dates.js'
import { addItem, isOpen, joinIcon } from '../../../../shared/items.js'
import { RepeatField } from '../shared/RepeatField.jsx'

const STATUS = [
  { value: ' ', label: 'Open' },
  { value: '/', label: 'In progress' },
  { value: 'x', label: 'Done' },
]
const PRIORITY = [
  { value: '', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'highest', label: 'Urgent' },
]

/** The live item for path + id, from every list */
export function useLiveItem(path, id) {
  const lists = useLists()
  return useMemo(() => {
    const list = lists.find((l) => l.path === path)
    const item = list?.all.get(id)
    return item ? { ...item, path, list } : null
  }, [lists, path, id])
}

function Row({ label, children }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="prop-value">{children}</div>
    </div>
  )
}

function Notes({ item }) {
  const [text, setText] = useState(item.notes || '')
  const timer = useRef(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(item.notes || '')
  }, [item.notes])
  useEffect(() => () => clearTimeout(timer.current), [])
  const save = (v) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => updateItem(item.path, item.id, { notes: v }), 500)
  }
  return (
    <Textarea
      className="panel-notes"
      value={text}
      placeholder="Notes"
      aria-label="Notes"
      autoSize
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        clearTimeout(timer.current)
        if (text !== (item.notes || '')) updateItem(item.path, item.id, { notes: text })
      }}
      onChange={(e) => {
        setText(e.target.value)
        save(e.target.value)
      }}
    />
  )
}

function Subtasks({ item }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (!t) return
    useWorkspace.getState().edit(item.path, (src) => addItem(src, { title: t, status: ' ' }, { parent: item.id }).text)
    setText('')
  }
  return (
    <div className="subtasks">
      {item.subtasks.map((s) => (
        <div key={s.id} className={`subtask${isOpen(s.status) ? '' : ' is-done'}`}>
          <TaskCheckbox status={s.status} label={`Complete “${s.title}”`} onToggle={() => toggleTask(item.path, s.id)} />
          <input
            className="subtask-title"
            defaultValue={s.title}
            key={s.title}
            aria-label="Subtask"
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.title && updateItem(item.path, s.id, { title: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <IconButton icon={X} label="Delete subtask" size="sm" onClick={() => deleteItem(item.path, s.id)} />
        </div>
      ))}
      <div className="subtask subtask-add">
        <Plus size={14} />
        <input className="subtask-title" value={text} placeholder="Add a subtask" aria-label="New subtask" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} />
      </div>
    </div>
  )
}

export function TaskPanel({ path, id, onClose }) {
  const item = useLiveItem(path, id)
  const lists = useLists()
  const prefs = usePrefs()
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState(false)
  const [moreDates, setMoreDates] = useState(false)
  const emojiRef = useRef(null)
  useEffect(() => {
    if (item) setTitle(item.label || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.label, id])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !e.defaultPrevented && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null
  const set = (patch) => updateItem(item.path, item.id, patch)
  const h12 = prefs.timeFormat === '12h'
  const status = isOpen(item.status) ? (item.status === '/' ? '/' : ' ') : 'x'

  return (
    <aside className="panel" aria-label="Task details">
      <div className="panel-head">
        <Select
          className="panel-list"
          aria-label="List"
          value={item.path}
          options={lists.map((l) => ({ value: l.path, label: `${l.icon ? `${l.icon}  ` : ''}${l.name}` }))}
          onChange={(e) => {
            moveItemToFile(item.path, item.id, e.target.value, {})
            onClose()
          }}
        />
        <div className="panel-head-actions">
          <IconButton
            icon={Copy}
            label="Duplicate"
            onClick={() => addTask(item.path, { ...item, id: undefined, title: item.title, status: ' ', done: null }, { after: item.id })}
          />
          <IconButton icon={Trash2} label="Delete task" onClick={() => {
            deleteItem(item.path, item.id)
            onClose()
          }} />
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="panel-body">
        <div className="panel-title-row">
          <TaskCheckbox status={item.status} label="Complete task" onToggle={() => toggleTask(item.path, item.id)} />
          <button ref={emojiRef} type="button" className="panel-emoji" aria-label="Choose an icon" onClick={() => setEmoji(true)}>
            {item.icon || <span className="panel-emoji-empty">☺</span>}
          </button>
          <Textarea
            className="panel-title"
            value={title}
            autoSize
            rows={1}
            aria-label="Title"
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
            onBlur={() => title.trim() && title.trim() !== item.label && set({ title: joinIcon(item.icon, title.trim()) })}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
          />
          <Popover open={emoji} onOpenChange={setEmoji} anchor={emojiRef} placement="bottom-start">
            <EmojiPicker
              value={item.icon}
              onChange={(v) => {
                set({ icon: v || null })
                setEmoji(false)
              }}
            />
          </Popover>
        </div>

        <div className="props">
          <Row label="Status">
            <Segmented label="Status" value={status} options={STATUS} onChange={(v) => set({ status: v })} />
          </Row>
          <Row label="Date">
            <DateField value={item.date || null} onChange={(v) => set({ date: v })} placeholder="No date" clearable />
          </Row>
          <Row label="Time">
            <div className="prop-inline">
              <TimeField value={item.time || null} h12={h12} step={prefs.calendar.snap || 15} onChange={(v) => set({ time: v, ...(v && !item.duration ? { duration: prefs.calendar.defaultDuration } : {}) })} />
              {item.time && <DurationField value={item.duration || null} onChange={(v) => set({ duration: v })} />}
            </div>
          </Row>
          <Row label="Repeat">
            <RepeatField value={item.recurrence || null} date={item.date} onChange={(v) => set({ recurrence: v })} />
          </Row>
          <Row label="Priority">
            <Segmented label="Priority" value={item.priority || ''} options={PRIORITY} onChange={(v) => set({ priority: v || null })} />
          </Row>
          {moreDates || item.scheduled || item.start ? (
            <>
              <Row label="Scheduled">
                <DateField value={item.scheduled || null} onChange={(v) => set({ scheduled: v })} placeholder="Not scheduled" clearable />
              </Row>
              <Row label="Starts">
                <DateField value={item.start || null} onChange={(v) => set({ start: v })} placeholder="Any time" clearable />
              </Row>
            </>
          ) : (
            <button type="button" className="prop-more" onClick={() => setMoreDates(true)}>
              More dates
            </button>
          )}
        </div>

        <section className="panel-section">
          <h4>Notes</h4>
          <Notes item={item} />
        </section>
        <section className="panel-section">
          <h4>Subtasks</h4>
          <Subtasks item={item} />
        </section>
      </div>
      <div className="panel-foot">
        <span>{item.done ? `Done ${relativeDay(item.done)}` : item.created ? `Created ${relativeDay(item.created)}` : ''}</span>
        {(item.date || item.scheduled) && (
          <Button variant="ghost" size="sm" icon={CalendarDays} onClick={() => navigate(`/calendar?view=day&date=${item.date || item.scheduled}`)}>
            Open in calendar
          </Button>
        )}
      </div>
    </aside>
  )
}

