// A card opened: everything about it in one place, as on the back of a Trello
// card (laid out the way obi does it). Each change is written to the card's
// line at once.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlignLeft, Archive, CalendarDays, Copy, Flag, ListChecks, Palette, Plus, Trash2, X } from 'lucide-react'
import { DateField, DurationField, Popover, TimeField } from '../../components/ui/index.js'
import { useLists } from '../../store/hooks.js'
import { usePrefs } from '../../store/prefs.js'
import { useWorkspace } from '../../store/workspace.js'
import { addTask, deleteItem, updateItem } from '../../lib/actions.js'
import { archiveCard, moveCard, setCover } from '../../lib/boardActions.js'
import { celebrate } from '../../lib/celebrate.js'
import { joinTitle, splitTitle } from '../../lib/colors.js'
import { navigate } from '../../lib/router.js'
import { todayIso } from '../../../../shared/dates.js'
import { addItem, isOpen } from '../../../../shared/items.js'
import { boardOf } from '../../../../shared/board.js'
import { RepeatField } from '../shared/RepeatField.jsx'
import { renderMarkdown } from '../docs/markdown.js'
import { Label, PRIORITY_NAME, StatusIcon, dueTone } from './Card.jsx'
import { Colors, LabelPicker, PopHead } from './pickers.jsx'
import { toggleTask } from '../../lib/actions.js'
import './boards.css'

const STATUSES = [
  [' ', 'To do'],
  ['/', 'In progress'],
  ['x', 'Done'],
]
const PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest']
const COLOR_NAME = (c) => c[0].toUpperCase() + c.slice(1)

const grow = (el) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function Field({ label, children, wide }) {
  return (
    <div className={`cd-field${wide ? ' wide' : ''}`}>
      <div className="td-label">{label}</div>
      {children}
    </div>
  )
}

function Labels({ item, settings, known }) {
  const [anchor, setAnchor] = useState(null)
  const { text, tags } = splitTitle(item.title)
  const show = (e) => setAnchor(anchor ? null : { current: e.currentTarget })
  return (
    <div className="cd-labels">
      {tags.map((t) => (
        <Label key={t} tag={t} color={settings.labels[t]} onClick={show} onRemove={() => updateItem(item.path, item.id, { title: joinTitle(text, tags.filter((x) => x !== t)) })} />
      ))}
      <button type="button" className={`cd-label-add${anchor ? ' on' : ''}`} aria-label="Labels" aria-expanded={!!anchor} onClick={show}>
        <Plus size={14} />
        {!tags.length && <span>Add a label</span>}
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && setAnchor(null)} anchor={anchor} placement="bottom-start" className="label-pop">
        <LabelPicker item={item} settings={settings} known={known} onClose={() => setAnchor(null)} />
      </Popover>
    </div>
  )
}

function CoverField({ item, cover }) {
  const [anchor, setAnchor] = useState(null)
  return (
    <>
      <button type="button" className={`cd-cover-btn${anchor ? ' on' : ''}`} aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        {cover ? (
          <>
            <span className="cd-cover-chip" style={{ '--lc': `var(--c-${cover})` }} /> {COLOR_NAME(cover)}
          </>
        ) : (
          <>
            <Palette size={14} /> Add a cover
          </>
        )}
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && setAnchor(null)} anchor={anchor} placement="bottom-start" className="cover-pop">
        <PopHead title="Cover" onClose={() => setAnchor(null)} />
        <div className="pop-body">
          <div className="pop-label">Colours</div>
          <Colors value={cover} onPick={(c) => setCover(item.path, item.id, c)} />
          {cover && (
            <button type="button" className="lp-create" onClick={() => (setCover(item.path, item.id, null), setAnchor(null))}>
              Remove cover
            </button>
          )}
        </div>
      </Popover>
    </>
  )
}

function Description({ item }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.notes || '')
  const box = useRef(null)
  const text = item.notes || ''
  useLayoutEffect(() => {
    if (!editing) return
    grow(box.current)
    box.current?.focus()
  }, [editing])
  const save = () => {
    setEditing(false)
    if (draft !== text) updateItem(item.path, item.id, { notes: draft })
  }
  return (
    <section className="cd-section">
      <div className="cd-section-head">
        <AlignLeft />
        <h3>Description</h3>
        {!editing && text && (
          <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => (setDraft(text), setEditing(true))}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            ref={box}
            className="cd-desc-edit"
            value={draft}
            placeholder="Add a more detailed description…"
            onChange={(e) => {
              setDraft(e.target.value)
              grow(e.target)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
              else if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft(text)
                setEditing(false)
              }
            }}
          />
          <div className="cd-row">
            <button type="button" className="ui-button ui-button--primary ui-button--sm" onClick={save}>
              Save
            </button>
            <button type="button" className="ui-button ui-button--ghost ui-button--sm" onClick={() => (setDraft(text), setEditing(false))}>
              Cancel
            </button>
          </div>
        </>
      ) : text ? (
        <div className="md cd-desc" onClick={(e) => !e.target.closest('a') && !window.getSelection()?.toString() && (setDraft(text), setEditing(true))} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      ) : (
        <button type="button" className="cd-desc-empty" onClick={() => (setDraft(''), setEditing(true))}>
          Add a more detailed description…
        </button>
      )}
    </section>
  )
}

function Checklist({ item }) {
  const [text, setText] = useState('')
  const subs = item.subtasks || []
  const ticked = subs.filter((s) => !isOpen(s.status)).length
  const add = () => {
    const t = text.replace(/\s+/g, ' ').trim()
    if (!t) return
    useWorkspace.getState().edit(item.path, (src) => addItem(src, { title: t, status: ' ' }, { parent: item.id }).text)
    setText('')
  }
  return (
    <section className="cd-section">
      <div className="cd-section-head">
        <ListChecks />
        <h3>Checklist</h3>
        {subs.length > 0 && <span className="cd-count">{Math.round((ticked / subs.length) * 100)}%</span>}
      </div>
      {subs.length > 0 && (
        <div className={`cd-progress${ticked === subs.length ? ' full' : ''}`} role="progressbar" aria-label="Checklist done" aria-valuenow={ticked} aria-valuemax={subs.length}>
          <i style={{ width: `${(ticked / subs.length) * 100}%` }} />
        </div>
      )}
      <ul className="cd-items">
        {subs.map((s) => {
          const done = !isOpen(s.status)
          return (
            <li key={s.id} className={`cd-item${done ? ' done' : ''}`}>
              <input type="checkbox" className="task-cb" checked={done} aria-label={done ? 'Mark not done' : 'Mark done'} onChange={(e) => (!done && celebrate(e.currentTarget), toggleTask(item.path, s.id))} />
              <input
                className="cd-item-text"
                aria-label="Checklist item"
                defaultValue={s.title}
                key={s.title}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                onBlur={(e) => {
                  const t = e.target.value.replace(/\s+/g, ' ').trim()
                  if (!t) e.target.value = s.title
                  else if (t !== s.title) updateItem(item.path, s.id, { title: t })
                }}
              />
              <button type="button" className="pop-icon cd-item-x" aria-label="Delete item" title="Delete item" onClick={() => deleteItem(item.path, s.id)}>
                <X size={14} />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="cd-item-add">
        <Plus />
        <input aria-label="Add an item" placeholder="Add an item…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      </div>
    </section>
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
  const titleEl = useRef(null)
  const item = card?.item
  const parts = splitTitle(item?.title || '')
  useLayoutEffect(() => grow(titleEl.current), [parts.text])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.ui-popover') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // every label the board knows: set colours, and tags used on its cards
  const known = useMemo(() => {
    if (!card) return []
    const all = new Set(Object.keys(card.board.settings.labels))
    for (const i of card.list.all.values()) for (const t of splitTitle(i.title).tags) all.add(t)
    return [...all].sort((a, b) => a.localeCompare(b))
  }, [card])

  if (!card) return null
  const { list, board } = card
  const set = (patch) => updateItem(item.path, item.id, patch)
  const today = todayIso()
  const h12 = prefs.timeFormat === '12h'
  const cover = board.settings.covers[item.id]
  const columns = board.columns.filter((c) => c.name)
  const status = isOpen(item.status) ? (item.status === '/' ? '/' : ' ') : 'x'
  const tone = dueTone(item.date, item.status, today)
  const setStatus = (v, el) => {
    if (v === 'x' && status !== 'x' && el) celebrate(el)
    if (v === 'x' && board.done && item.section !== board.done) return moveCard(item.path, item.id, item.path, board.done)
    set({ status: v })
  }

  return (
    <div className="cd-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card-dialog${cover ? ' has-cover' : ''}`} style={cover ? { '--cover': `var(--c-${cover})` } : undefined} role="dialog" aria-modal="true" aria-label={parts.text}>
        <button type="button" className="cd-close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        {cover && <div className="cd-cover-band" aria-hidden="true" />}
        <div className="cd">
          <header className="cd-head">
            <button type="button" className={`pb-check cd-check${status === 'x' ? ' on' : ''}`} aria-label={status === 'x' ? 'Mark not done' : 'Mark done'} onClick={(e) => setStatus(status === 'x' ? ' ' : 'x', e.currentTarget)}>
              <StatusIcon status={item.status} />
            </button>
            <div className="cd-head-main">
              <textarea
                ref={titleEl}
                key={`title:${parts.text}`}
                className="cd-title"
                rows={1}
                aria-label="Title"
                defaultValue={parts.text}
                onInput={(e) => grow(e.target)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
                onBlur={(e) => {
                  const next = e.target.value.replace(/\s+/g, ' ').trim()
                  if (!next) e.target.value = parts.text
                  else if (next !== parts.text) set({ title: joinTitle(next, parts.tags) })
                }}
              />
              <div className="cd-where">
                in
                <select className="cd-list" aria-label="Board" value={item.path} onChange={(e) => (moveCard(item.path, item.id, e.target.value, null), onClose())}>
                  {lists.map((l) => (
                    <option key={l.path} value={l.path}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {columns.length > 0 && (
                  <>
                    list
                    <select className="cd-list" aria-label="List" value={item.section || ''} onChange={(e) => moveCard(item.path, item.id, item.path, e.target.value || null)}>
                      {board.columns.some((c) => !c.name) && <option value="">No list</option>}
                      {columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </div>
          </header>

          <div className="cd-grid">
            <div className="cd-main">
              <div className="cd-fields">
                <Field label="Status">
                  <div className="te-seg">
                    {STATUSES.map(([v, label]) => (
                      <button key={v} type="button" className={status === v ? 'active' : ''} onClick={(e) => setStatus(v, e.currentTarget)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Priority">
                  <div className="te-seg td-pri">
                    <button type="button" className={!item.priority ? 'active' : ''} onClick={() => set({ priority: null })}>
                      None
                    </button>
                    {PRIORITIES.map((p) => (
                      <button key={p} type="button" className={`pri-${p}${item.priority === p ? ' active' : ''}`} title={PRIORITY_NAME[p]} aria-label={PRIORITY_NAME[p]} onClick={() => set({ priority: p })}>
                        <Flag />
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={<>Due date {tone && <span className={`cd-due-tone ${tone}`}>{tone.replace('soon', 'tomorrow')}</span>}</>}>
                  <DateField value={item.date || null} onChange={(v) => set({ date: v })} placeholder="No due date" clearable />
                </Field>
                <Field label="Repeat">
                  <RepeatField value={item.recurrence || null} date={item.date} onChange={(v) => set({ recurrence: v })} />
                </Field>
                <Field label="Time">
                  <div className="cd-inline">
                    <TimeField value={item.time || null} h12={h12} step={prefs.calendar.snap || 15} onChange={(v) => set({ time: v, ...(v && !item.duration ? { duration: prefs.calendar.defaultDuration } : {}) })} />
                    {item.time && <DurationField value={item.duration || null} onChange={(v) => set({ duration: v })} />}
                  </div>
                </Field>
                <Field label="Cover">
                  <CoverField item={item} cover={cover} />
                </Field>
                <Field label="Labels" wide>
                  <Labels item={item} settings={board.settings} known={known} />
                </Field>
              </div>
              <Description item={item} />
              <Checklist item={item} />
            </div>

            <aside className="cd-side">
              <div className="td-label">Actions</div>
              {(item.date || item.scheduled) && (
                <button type="button" className="cd-act" onClick={() => navigate(`/calendar?view=day&date=${item.date || item.scheduled}`)}>
                  <CalendarDays /> In calendar
                </button>
              )}
              <button type="button" className="cd-act" onClick={() => addTask(item.path, { title: item.title, date: item.date, time: item.time, duration: item.duration, priority: item.priority, recurrence: item.recurrence, notes: item.notes }, { after: item.id })}>
                <Copy /> Duplicate
              </button>
              <button type="button" className="cd-act" onClick={() => (archiveCard(item.path, item.id), onClose())}>
                <Archive /> Archive
              </button>
              <button type="button" className="cd-act danger" onClick={() => (deleteItem(item.path, item.id), onClose())}>
                <Trash2 /> Delete
              </button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
