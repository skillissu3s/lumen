// The box at the foot of a list for adding cards one after another.
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { todayIso } from '../../../../shared/dates.js'
import { parseQuickAdd } from '../../../../shared/quickadd.js'

/** Adds cards one after another: Enter adds and stays open, Escape closes. A date or a priority can be typed in. */
export function Composer({ onAdd, onClose }) {
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
