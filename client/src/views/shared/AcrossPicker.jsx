// In your candle, Today, All tasks and Calendar also show what's in your other
// spaces (docs/CANDLES.md). This picks which: each workspace and each person
// sharing with you, on or off, saved in your preferences for all three views.
import { useState } from 'react'
import { Layers } from 'lucide-react'
import { Popover } from '../../components/ui/index.js'
import { setPrefs, usePrefs } from '../../store/prefs.js'
import { useSpaces, useSpaceLabels } from '../../store/spaces.js'
import { useWorkspace } from '../../store/workspace.js'

export function AcrossPicker() {
  const prefix = useWorkspace((s) => s.prefix)
  const spaces = useSpaces((s) => s.list).filter((s) => s.prefix)
  const labels = useSpaceLabels()
  const off = usePrefs().across.off
  const [anchor, setAnchor] = useState(null)
  // only in your candle, and only when there is somewhere else
  if (prefix || !spaces.length) return null
  const on = spaces.filter((s) => !off.includes(s.prefix)).length
  const toggle = (pre) => setPrefs({ across: { off: off.includes(pre) ? off.filter((p) => p !== pre) : [...off, pre] } })
  return (
    <>
      <button type="button" className={`across-button${anchor ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : { current: e.currentTarget })}>
        <Layers size={14} />
        <span>{on ? `Your candle and ${on} more` : 'Your candle only'}</span>
      </button>
      <Popover open={!!anchor} onOpenChange={(o) => !o && setAnchor(null)} anchor={anchor} placement="bottom-end" className="across-pop" aria-label="Spaces shown here">
        <p className="across-hint">Also show tasks and events from:</p>
        {spaces.map((s) => (
          <label key={s.prefix} className="across-row">
            <input type="checkbox" checked={!off.includes(s.prefix)} onChange={() => toggle(s.prefix)} />
            <span>{labels[s.prefix]}</span>
          </label>
        ))}
      </Popover>
    </>
  )
}
