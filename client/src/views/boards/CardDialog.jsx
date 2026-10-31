// A card opened: everything about one task, the way Trello shows a card. Each
// change is written to the task's line at once.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlignLeft, ArrowRight, CalendarDays, Check, CircleCheckBig, Copy, Kanban, ListChecks, Palette, Plus, Tag, Trash2, X } from 'lucide-react'
import { Button, ColorPicker, DateField, DurationField, Popover, Segmented, Select, TaskCheckbox, Textarea, TimeField } from '../../components/ui/index.js'
import { useLists } from '../../store/hooks.js'
import { usePrefs } from '../../store/prefs.js'
import { useWorkspace } from '../../store/workspace.js'
import { addTask, deleteItem, toggleTask, updateItem } from '../../lib/actions.js'
import { moveCard, setCover, setLabelColor } from '../../lib/boardActions.js'
import { colorFor, joinTitle, splitTitle } from '../../lib/colors.js'
import { navigate } from '../../lib/router.js'
import { relativeDay, todayIso } from '../../../../shared/dates.js'
import { addItem, isOpen } from '../../../../shared/items.js'
import { boardOf } from '../../../../shared/board.js'
import { RepeatField } from '../shared/RepeatField.jsx'
import { renderMarkdown } from '../docs/markdown.js'

const PRIORITY = [
  { value: '', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'highest', label: 'Urgent' },
]

export function Label({ tag, color, onRemove }) {
  return (
    <span className="label" style={{ '--lc': `var(--c-${color})`, '--lc-bg': `var(--c-${color}-bg)`, '--lc-fg': `var(--c-${color}-fg)` }}>
      {tag}
      {onRemove && (
        <button type="button" aria-label={`Remove ${tag}`} onClick={onRemove}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}

function Description({ item }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.notes || '')
  useEffect(() => {
    if (!editing) setText(item.notes || '')
  }, [item.notes, editing])
  const save = () => {
    setEditing(false)
    if (text !== (item.notes || '')) updateItem(item.path, item.id, { notes: text })
  }
  if (editing)
    return (
      <div className="cd-desc-edit">
        <Textarea value={text} autoSize autoFocus onChange={(e) => setText(e.target.value)} placeholder="Add details, links, notes… (markdown)" aria-label="Description" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), save())} />
        <div className="cd-row-actions">
          <Button size="sm" variant="primary" onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText(item.notes || '')
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  return item.notes ? (
    <div className="cd-desc md" role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)} dangerouslySetInnerHTML={{ __html: renderMarkdown(item.notes) }} />
  ) : (
    <button type="button" className="cd-desc-empty" onClick={() => setEditing(true)}>
      Add a more detailed description…
    </button>
  )
}

function Checklist({ item }) {
  const [text, setText] = useState('')
  const subs = item.subtasks || []
  const done = subs.filter((s) => !isOpen(s.status)).length
  const add = () => {
    const t = text.trim()
    if (!t) return
    useWorkspace.getState().edit(item.path, (src) => addItem(src, { title: t, status: ' ' }, { parent: item.id }).text)
    setText('')
  }
  return (
    <div className="cd-check">
      {subs.length > 0 && (
        <div className="cd-progress" aria-label={`${done} of ${subs.length} done`}>
          <span className="tabular">{Math.round((done / subs.length) * 100)}%</span>
          <div className="cd-bar">
            <i style={{ width: `${(done / subs.length) * 100}%` }} />
          </div>
        </div>
      )}
      {subs.map((s) => (
        <div key={s.id} className={`cd-sub${isOpen(s.status) ? '' : ' is-done'}`}>
          <TaskCheckbox status={s.status} label={`Complete “${s.title}”`} onToggle={() => toggleTask(item.path, s.id)} />
          <input
            className="cd-sub-title"
            defaultValue={s.title}
            key={s.title}
            aria-label="Checklist item"
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.title && updateItem(item.path, s.id, { title: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <button type="button" className="cd-sub-x" aria-label="Delete item" onClick={() => deleteItem(item.path, s.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
      <div className="cd-sub cd-sub-add">
        <Plus size={14} />
        <input className="cd-sub-title" value={text} placeholder="Add an item" aria-label="New checklist item" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} />
      </div>
    </div>
  )
}

function LabelsEditor({ item, settings, onDone }) {
  const { text, tags } = splitTitle(item.title)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState(null)
  const lists = useLists()
  // every label used on this board, plus this card's
  const known = useMemo(() => {
    const list = lists.find((l) => l.path === item.path)
    const all = new Set(tags)
    for (const i of list?.all.values() || []) for (const t of i.tags || []) all.add(t)
    for (const t of Object.keys(settings.labels)) all.add(t)
    return [...all].sort()
  }, [lists, item.path, tags, settings.labels])
  const colorOf = (t) => settings.labels[t] || colorFor(t)
  const toggle = (t) => updateItem(item.path, item.id, { title: joinTitle(text, tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]) })
  const addNew = () => {
    const t = name.trim().replace(/^#/, '').replace(/\s+/g, '-')
    if (!t) return
    if (!tags.includes(t)) updateItem(item.path, item.id, { title: joinTitle(text, [...tags, t]) })
    setName('')
  }
  return (
    <div className="labels-editor">
      <div className="labels-editor-head">
        <b>Labels</b>
        <button type="button" className="ui-icon-button ui-icon-button--sm" aria-label="Close" onClick={onDone}>
          <X />
        </button>
      </div>
      {known.map((t) => (
        <div key={t} className="labels-editor-row">
          <button type="button" className="labels-editor-pick" aria-pressed={tags.includes(t)} onClick={() => toggle(t)}>
            <span className="labels-editor-box">{tags.includes(t) && <Check size={12} />}</span>
            <Label tag={t} color={colorOf(t)} />
          </button>
          <button type="button" className="ui-icon-button ui-icon-button--sm" aria-label={`Colour of ${t}`} onClick={() => setEditing(editing === t ? null : t)}>
            <Palette />
          </button>
          {editing === t && (
            <div className="labels-editor-colors">
              <ColorPicker
                value={colorOf(t)}
                onChange={(c) => {
                  setLabelColor(item.path, t, c)
                  setEditing(null)
                }}
              />
            </div>
          )}
        </div>
      ))}
      <div className="labels-editor-new">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} placeholder="New label" aria-label="New label" />
        <Button size="sm" onClick={addNew} disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

/** The live card for path + id */
export function useCard(path, id) {
  const lists = useLists()
  const files = useWorkspace((s) => s.files)
  return useMemo(() => {
    const list = lists.find((l) => l.path === path)
    const item = list?.all.get(id)
    if (!item) return null
    const board = boardOf(list, files[path]?.text || '')
    return { item: { ...item, path }, list, board }
  }, [lists, files, path, id])
}

export function CardDialog({ path, id, onClose }) {
  const card = useCard(path, id)
  const lists = useLists()
  const prefs = usePrefs()
  const [title, setTitle] = useState('')
  const [labels, setLabels] = useState(false)
  const [cover, setCoverOpen] = useState(false)
  const labelsRef = useRef(null)
  const coverRef = useRef(null)
  const item = card?.item
  const parts = splitTitle(item?.title || '')
  useEffect(() => setTitle(parts.text), [parts.text]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !e.defaultPrevented && !labels && !cover && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, labels, cover])

  if (!card) return null
  const { list, board } = card
  const set = (patch) => updateItem(item.path, item.id, patch)
  const today = todayIso()
  const h12 = prefs.timeFormat === '12h'
  const coverColor = board.settings.covers[item.id]
  const columnNames = board.columns.filter((c) => c.name).map((c) => c.name)
  const day = item.date
  const late = day && isOpen(item.status) && day < today
  const status = isOpen(item.status) ? (item.status === '/' ? '/' : ' ') : 'x'

  return (
    <div className="cd-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cd" role="dialog" aria-modal="true" aria-label={parts.text}>
        {coverColor && <div className="cd-cover" style={{ '--cv': `var(--c-${coverColor})` }} />}
        <button type="button" className="cd-close ui-icon-button" aria-label="Close" onClick={onClose}>
          <X />
        </button>
        <div className="cd-head">
          <TaskCheckbox status={item.status} label={isOpen(item.status) ? 'Complete' : 'Mark as open'} onToggle={() => toggleTask(item.path, item.id)} />
          <div className="cd-head-main">
            <textarea
              className="cd-title"
              value={title}
              rows={1}
              aria-label="Title"
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
              onBlur={() => title.trim() && title.trim() !== parts.text && set({ title: joinTitle(title.trim(), parts.tags) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            />
            <p className="cd-where">
              in <a href={`#/board/${list.id}`} onClick={onClose}>{list.name}</a>
              {item.section && (
                <>
                  {' '}
                  · <b>{item.section}</b>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="cd-body">
          <div className="cd-main">
            {(parts.tags.length > 0 || day) && (
              <div className="cd-meta">
                {parts.tags.length > 0 && (
                  <div className="cd-meta-group">
                    <span className="cd-meta-label">Labels</span>
                    <div className="cd-labels">
                      {parts.tags.map((t) => (
                        <Label key={t} tag={t} color={board.settings.labels[t] || colorFor(t)} onRemove={() => set({ title: joinTitle(parts.text, parts.tags.filter((x) => x !== t)) })} />
                      ))}
                      <button type="button" className="cd-add-label" aria-label="Add a label" onClick={() => setLabels(true)}>
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                )}
                {day && (
                  <div className="cd-meta-group">
                    <span className="cd-meta-label">Due</span>
                    <span className={`cd-due${late ? ' is-late' : day === today ? ' is-today' : ''}`}>
                      <CalendarDays size={13} />
                      {relativeDay(day, today)}
                      {item.time ? ` · ${item.time}` : ''}
                      {late ? ' · overdue' : ''}
                    </span>
                  </div>
                )}
              </div>
            )}

            <section className="cd-section">
              <h3>
                <AlignLeft size={15} /> Description
              </h3>
              <Description item={item} />
            </section>

            <section className="cd-section">
              <h3>
                <ListChecks size={15} /> Checklist
              </h3>
              <Checklist item={item} />
            </section>
          </div>

          <aside className="cd-side">
            <div className="cd-field">
              <span>Status</span>
              <Segmented
                label="Status"
                value={status}
                onChange={(v) => set({ status: v })}
                options={[
                  { value: ' ', label: 'Open' },
                  { value: '/', label: 'Doing' },
                  { value: 'x', label: 'Done' },
                ]}
              />
            </div>
            {columnNames.length > 0 && (
              <div className="cd-field">
                <span>Column</span>
                <Select value={item.section || ''} onChange={(e) => moveCard(item.path, item.id, item.path, e.target.value || null)} options={[...(board.columns.some((c) => !c.name) ? [{ value: '', label: 'No column' }] : []), ...columnNames.map((n) => ({ value: n, label: n }))]} aria-label="Column" />
              </div>
            )}
            <div className="cd-field">
              <span>Board</span>
              <Select
                value={item.path}
                onChange={(e) => {
                  moveCard(item.path, item.id, e.target.value, null)
                  onClose()
                }}
                options={lists.map((l) => ({ value: l.path, label: l.name }))}
                aria-label="Board"
              />
            </div>
            <div className="cd-field">
              <span>Due date</span>
              <DateField value={item.date || null} onChange={(v) => set({ date: v })} placeholder="No date" clearable />
            </div>
            <div className="cd-field">
              <span>Time</span>
              <div className="cd-inline">
                <TimeField value={item.time || null} h12={h12} step={prefs.calendar.snap || 15} onChange={(v) => set({ time: v, ...(v && !item.duration ? { duration: prefs.calendar.defaultDuration } : {}) })} />
                {item.time && <DurationField value={item.duration || null} onChange={(v) => set({ duration: v })} />}
              </div>
            </div>
            <div className="cd-field">
              <span>Repeat</span>
              <RepeatField value={item.recurrence || null} date={item.date} onChange={(v) => set({ recurrence: v })} />
            </div>
            <div className="cd-field">
              <span>Priority</span>
              <Select value={item.priority || ''} onChange={(e) => set({ priority: e.target.value || null })} options={PRIORITY} aria-label="Priority" />
            </div>

            <div className="cd-actions">
              <span className="cd-actions-label">Add to card</span>
              <button ref={labelsRef} type="button" className="cd-action" onClick={() => setLabels(true)}>
                <Tag size={14} /> Labels
              </button>
              <button ref={coverRef} type="button" className="cd-action" onClick={() => setCoverOpen(true)}>
                <Palette size={14} /> Cover
              </button>
              {(item.date || item.scheduled) && (
                <button type="button" className="cd-action" onClick={() => navigate(`/calendar?view=day&date=${item.date || item.scheduled}`)}>
                  <CalendarDays size={14} /> Open in calendar
                </button>
              )}
              <span className="cd-actions-label">Actions</span>
              <button
                type="button"
                className="cd-action"
                onClick={() => {
                  addTask(item.path, { title: item.title, date: item.date, time: item.time, duration: item.duration, priority: item.priority, recurrence: item.recurrence, notes: item.notes }, { after: item.id })
                }}
              >
                <Copy size={14} /> Duplicate
              </button>
              {isOpen(item.status) && board.done && item.section !== board.done && (
                <button type="button" className="cd-action" onClick={() => moveCard(item.path, item.id, item.path, board.done)}>
                  <ArrowRight size={14} /> Move to {board.done}
                </button>
              )}
              {isOpen(item.status) && !board.done && (
                <button type="button" className="cd-action" onClick={() => toggleTask(item.path, item.id)}>
                  <CircleCheckBig size={14} /> Complete
                </button>
              )}
              <button
                type="button"
                className="cd-action is-danger"
                onClick={() => {
                  deleteItem(item.path, item.id)
                  onClose()
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
            <p className="cd-foot">
              <Kanban size={12} /> {item.done ? `Done ${relativeDay(item.done, today).toLowerCase()}` : item.created ? `Created ${relativeDay(item.created, today).toLowerCase()}` : 'Saved as a line in ' + item.path}
            </p>
          </aside>
        </div>

        <Popover open={labels} onOpenChange={setLabels} anchor={labelsRef} placement="left-start">
          <LabelsEditor item={item} settings={board.settings} onDone={() => setLabels(false)} />
        </Popover>
        <Popover open={cover} onOpenChange={setCoverOpen} anchor={coverRef} placement="left-start">
          <div className="cover-editor">
            <b>Cover</b>
            <ColorPicker
              value={coverColor || null}
              onChange={(c) => {
                setCover(item.path, item.id, c)
                setCoverOpen(false)
              }}
            />
            {coverColor && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCover(item.path, item.id, null)
                  setCoverOpen(false)
                }}
              >
                Remove cover
              </Button>
            )}
          </div>
        </Popover>
      </div>
    </div>
  )
}
