// Picking a repeat rule: the common ones from a menu, anything else typed.
import { useEffect, useState } from 'react'
import { Repeat } from 'lucide-react'
import { Input, Select } from '../../components/ui/index.js'
import { parseRecurrence, describeRecurrence } from '../../../../shared/recurrence.js'
import { weekdayOf } from '../../../../shared/dates.js'

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function repeatOptions(date) {
  const wd = date ? weekdayOf(date) : 1
  return [
    { value: '', label: 'Does not repeat' },
    { value: 'every day', label: 'Every day' },
    { value: 'every weekday', label: 'Every weekday' },
    { value: `every ${DAYS[wd]}`, label: `Weekly on ${DAY_NAMES[wd]}` },
    { value: `every 2 weeks on ${DAYS[wd]}`, label: `Every 2 weeks on ${DAY_NAMES[wd]}` },
    { value: 'every month', label: 'Every month' },
    { value: 'every year', label: 'Every year' },
    { value: 'custom', label: 'Custom…' },
  ]
}

/** value: rule text or null */
export function RepeatField({ value, onChange, date, id }) {
  const options = repeatOptions(date)
  const known = !value || options.some((o) => o.value === value)
  const [custom, setCustom] = useState(!known)
  const [text, setText] = useState(value || '')
  useEffect(() => {
    setText(value || '')
    if (value && !options.some((o) => o.value === value)) setCustom(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const valid = !text.trim() || parseRecurrence(text)
  return (
    <div className="repeat-field">
      <Select
        id={id}
        value={custom ? 'custom' : value || ''}
        options={options}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'custom') return setCustom(true)
          setCustom(false)
          onChange(v || null)
        }}
      />
      {custom && (
        <div className="repeat-custom">
          <Input
            icon={Repeat}
            value={text}
            invalid={!valid}
            placeholder="every 3 days · every mon, thu · every month until 2027-06-01"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => valid && onChange(text.trim() || null)}
            onKeyDown={(e) => e.key === 'Enter' && valid && onChange(text.trim() || null)}
            aria-label="Custom repeat rule"
          />
          <span className={valid ? 'faint' : 'repeat-bad'}>{valid ? (text.trim() ? describeRecurrence(text) : '') : 'Try “every 2 weeks” or “every mon, wed”.'}</span>
        </div>
      )}
    </div>
  )
}
