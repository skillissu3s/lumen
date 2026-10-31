// Small pickers a card and its dialog share: colours, labels, a due date, a
// priority. Each changes the card's line at once.
import { useState } from 'react'
import { CalendarDays, Check, Flag, Pencil, X } from 'lucide-react'
import { MiniMonth } from '../../components/ui/index.js'
import { updateItem } from '../../lib/actions.js'
import { setLabelColor } from '../../lib/boardActions.js'
import { colorFor, joinTitle, splitTitle } from '../../lib/colors.js'
import { addDays, relativeDay, todayIso, weekStartOf } from '../../../../shared/dates.js'
import { BOARD_COLORS } from '../../../../shared/board.js'

const COLOR_NAME = (c) => c[0].toUpperCase() + c.slice(1)

/** The head of a popover: its title in the middle, a way back on the left (if any), × on the right */
export function PopHead({ title, onBack, onClose }) {
  return (
    <div className="pop-head">
      {onBack ? (
        <button type="button" className="pop-icon" aria-label="Back" onClick={onBack}>
          ‹
        </button>
      ) : (
        <span />
      )}
      <b>{title}</b>
      <button type="button" className="pop-icon" aria-label="Close" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}

/** The colours to pick from, as wide tiles; the one in use ticked */
export function Colors({ value, onPick }) {
  return (
    <div className="lp-colors" role="radiogroup" aria-label="Colour">
      {BOARD_COLORS.map((c) => (
        <button key={c} type="button" role="radio" className={`lp-color${value === c ? ' on' : ''}`} style={{ '--lc': `var(--c-${c})` }} title={COLOR_NAME(c)} aria-label={COLOR_NAME(c)} aria-checked={value === c} onClick={() => onPick(c)}>
          {value === c && <Check size={14} />}
        </button>
      ))}
    </div>
  )
}

/** The board's labels: tick one to put it on the card, the pencil to recolour it, or make a new one */
export function LabelPicker({ item, settings, known, onClose }) {
  const { text, tags } = splitTitle(item.title)
  const [view, setView] = useState(null) // null: the list; { name?, color } editing or making one
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const colorOf = (t) => settings.labels[t] || colorFor(t)
  const want = q.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()
  const shown = known.filter((t) => !want || t.toLowerCase().includes(want))
  const has = (t) => tags.includes(t)
  const toggle = (t) => updateItem(item.path, item.id, { title: joinTitle(text, has(t) ? tags.filter((x) => x !== t) : [...tags, t]) })
  const open = (label) => {
    setView(label ? { name: label } : {})
    setName(label || want)
    setColor(label ? colorOf(label) : 'blue')
  }
  if (view) {
    const clean = name.trim().replace(/^#/, '').replace(/\s+/g, '-')
    const save = () => {
      if (!clean) return
      setLabelColor(item.path, clean, color)
      if (!view.name && !has(clean)) updateItem(item.path, item.id, { title: joinTitle(text, [...tags, clean]) })
      setView(null)
      setQ('')
    }
    return (
      <>
        <PopHead title={view.name ? 'Edit label' : 'Create a label'} onBack={() => setView(null)} onClose={onClose} />
        <div className="lp-preview">
          <span className="lp-bar static" style={{ '--lc': `var(--c-${color})` }}>
            {clean || 'label'}
          </span>
        </div>
        <div className="pop-body">
          <label className="pop-label" htmlFor="lp-name">
            Title
          </label>
          <input id="lp-name" className="pop-input" autoFocus value={name} disabled={!!view.name} placeholder="design, waiting, bug…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())} />
          <div className="pop-label">Colour</div>
          <Colors value={color} onPick={setColor} />
          <div className="lp-actions">
            <button type="button" className="ui-button ui-button--primary ui-button--sm" disabled={!clean} onClick={save}>
              {view.name ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </>
    )
  }
  return (
    <>
      <PopHead title="Labels" onClose={onClose} />
      <div className="pop-body">
        <input
          className="pop-input"
          autoFocus
          aria-label="Search labels"
          placeholder="Search labels…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (shown[0] && shown[0].toLowerCase() === want) toggle(shown[0])
            else if (want) open(null)
          }}
        />
        <div className="pop-label">Labels</div>
        <ul className="lp-list">
          {shown.map((t) => (
            <li key={t} className="lp-row">
              <input type="checkbox" className="lp-check" checked={has(t)} aria-label={`${t} on this card`} onChange={() => toggle(t)} />
              <button type="button" className="lp-bar" style={{ '--lc': `var(--c-${colorOf(t)})` }} aria-pressed={has(t)} onClick={() => toggle(t)}>
                {t}
              </button>
              <button type="button" className="pop-icon" aria-label={`Edit ${t}`} title="Edit label" onClick={() => open(t)}>
                <Pencil size={13} />
              </button>
            </li>
          ))}
          {!shown.length && <li className="lp-empty">{want ? `No label called “${want}” yet.` : 'No labels on this board yet.'}</li>}
        </ul>
        <button type="button" className="lp-create" onClick={() => open(null)}>
          {want && !known.some((t) => t.toLowerCase() === want) ? `Create “${want}”` : 'Create a new label'}
        </button>
      </div>
    </>
  )
}


const PRIORITIES = [
  ['highest', 'Urgent'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
]

/** A due date: the usual few days at a tap, or any day on the calendar */
export function DuePicker({ item, onClose }) {
  const today = todayIso()
  const set = (date) => {
    updateItem(item.path, item.id, { date })
    onClose()
  }
  const saturday = addDays(weekStartOf(today, 1), 5)
  const quick = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['This weekend', saturday > today ? saturday : addDays(saturday, 7)],
    ['Next week', weekStartOf(addDays(today, 7), 1)],
  ]
  return (
    <>
      <PopHead title="Due date" onClose={onClose} />
      <div className="pop-body">
        <div className="qp-list">
          {quick.map(([label, d]) => (
            <button key={label} type="button" className={`qp-row${item.date === d ? ' on' : ''}`} onClick={() => set(d)}>
              <CalendarDays size={14} />
              <span>{label}</span>
              <small>{relativeDay(d, today) === label ? '' : relativeDay(d, today)}</small>
            </button>
          ))}
        </div>
        <MiniMonth value={item.date || today} onChange={set} today={today} />
        {item.date && (
          <button type="button" className="lp-create" onClick={() => set(null)}>
            Remove due date
          </button>
        )}
      </div>
    </>
  )
}

/** A priority, shown by its flag's colour */
export function PriorityPicker({ item, onClose }) {
  const set = (priority) => {
    updateItem(item.path, item.id, { priority })
    onClose()
  }
  return (
    <>
      <PopHead title="Priority" onClose={onClose} />
      <div className="pop-body">
        <div className="qp-list">
          {PRIORITIES.map(([p, label]) => (
            <button key={p} type="button" className={`qp-row pri-${p}${item.priority === p ? ' on' : ''}`} onClick={() => set(p)}>
              <Flag size={14} />
              <span>{label}</span>
              {item.priority === p && <Check size={14} />}
            </button>
          ))}
          <button type="button" className={`qp-row${!item.priority ? ' on' : ''}`} onClick={() => set(null)}>
            <X size={14} />
            <span>No priority</span>
          </button>
        </div>
      </div>
    </>
  )
}
