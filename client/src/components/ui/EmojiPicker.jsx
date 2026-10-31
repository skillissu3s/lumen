import { useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from './FormControls.jsx'

const GROUPS = [
  {
    title: 'Activities',
    items: [
      ['⚽', 'soccer ball sport'],
      ['🏀', 'basketball sport'],
      ['🎾', 'tennis sport'],
      ['🏓', 'table tennis sport'],
      ['🏸', 'badminton sport'],
      ['🏋️', 'weight lifting gym'],
      ['🏃', 'running exercise'],
      ['🚴', 'cycling bicycle exercise'],
      ['🏊', 'swimming exercise'],
      ['🧘', 'yoga meditation'],
      ['🎮', 'video game controller'],
      ['🎲', 'dice game'],
      ['🎯', 'target goal'],
      ['🎸', 'guitar music'],
      ['🎨', 'art palette paint'],
      ['📚', 'books reading'],
      ['🎬', 'movie film clapper'],
    ],
  },
  {
    title: 'Work',
    items: [
      ['💼', 'briefcase work'],
      ['📁', 'folder'],
      ['📂', 'open folder'],
      ['🗂️', 'card index files'],
      ['📄', 'document page'],
      ['📝', 'memo note writing'],
      ['📌', 'pushpin pin'],
      ['📎', 'paperclip attachment'],
      ['📊', 'bar chart'],
      ['📈', 'chart increasing growth'],
      ['📉', 'chart decreasing'],
      ['🖥️', 'desktop computer'],
      ['💻', 'laptop computer'],
      ['⌨️', 'keyboard'],
      ['🖱️', 'mouse computer'],
      ['🖨️', 'printer'],
      ['📅', 'calendar date'],
    ],
  },
  {
    title: 'People',
    items: [
      ['👤', 'person profile'],
      ['👥', 'people group'],
      ['👨', 'man'],
      ['👩', 'woman'],
      ['🧑', 'person'],
      ['👶', 'baby'],
      ['🧒', 'child'],
      ['👦', 'boy'],
      ['👧', 'girl'],
      ['🧓', 'older person'],
      ['👴', 'older man'],
      ['👵', 'older woman'],
      ['🤝', 'handshake agreement'],
      ['👍', 'thumbs up yes'],
      ['👎', 'thumbs down no'],
      ['🙌', 'raising hands celebrate'],
      ['💪', 'flexed biceps strong'],
    ],
  },
  {
    title: 'Food',
    items: [
      ['🍎', 'apple fruit'],
      ['🍌', 'banana fruit'],
      ['🍇', 'grapes fruit'],
      ['🍓', 'strawberry fruit'],
      ['🍊', 'tangerine orange fruit'],
      ['🥑', 'avocado'],
      ['🥕', 'carrot vegetable'],
      ['🍞', 'bread'],
      ['🥐', 'croissant'],
      ['🧀', 'cheese'],
      ['🥚', 'egg'],
      ['🍕', 'pizza'],
      ['🍔', 'hamburger'],
      ['🍜', 'ramen noodles'],
      ['🍣', 'sushi'],
      ['☕', 'coffee'],
      ['🍵', 'tea'],
    ],
  },
  {
    title: 'Travel',
    items: [
      ['🚗', 'car'],
      ['🚕', 'taxi'],
      ['🚌', 'bus'],
      ['🚆', 'train'],
      ['✈️', 'airplane flight'],
      ['🚀', 'rocket launch'],
      ['🚲', 'bicycle bike'],
      ['🛴', 'scooter'],
      ['⛵', 'sailboat'],
      ['🏖️', 'beach holiday'],
      ['🏔️', 'mountain'],
      ['🏕️', 'camping tent'],
      ['🗺️', 'map'],
      ['🧭', 'compass'],
      ['🏠', 'house home'],
      ['🏢', 'office building'],
      ['🌍', 'globe earth'],
    ],
  },
  {
    title: 'Objects',
    items: [
      ['💡', 'light bulb idea'],
      ['🔑', 'key'],
      ['🔒', 'lock'],
      ['🔔', 'bell notification'],
      ['⏰', 'alarm clock time'],
      ['⏳', 'hourglass time'],
      ['📱', 'mobile phone'],
      ['☎️', 'telephone call'],
      ['📷', 'camera photo'],
      ['🎧', 'headphones music'],
      ['🔊', 'speaker sound'],
      ['🔋', 'battery'],
      ['💰', 'money bag'],
      ['💳', 'credit card'],
      ['🎁', 'gift present'],
      ['🧰', 'toolbox'],
      ['🪴', 'potted plant'],
    ],
  },
  {
    title: 'Symbols',
    items: [
      ['❤️', 'red heart love'],
      ['💚', 'green heart'],
      ['💙', 'blue heart'],
      ['💜', 'purple heart'],
      ['🖤', 'black heart'],
      ['⭐', 'star'],
      ['✨', 'sparkles'],
      ['🔥', 'fire hot'],
      ['✅', 'check mark done'],
      ['❌', 'cross mark no'],
      ['⚠️', 'warning'],
      ['❓', 'question mark'],
      ['❗', 'exclamation mark'],
      ['➕', 'plus add'],
      ['➖', 'minus remove'],
      ['♻️', 'recycling'],
      ['🏁', 'chequered flag finish'],
    ],
  },
]

export function EmojiPicker({ value, onChange, className = '', ...props }) {
  const [query, setQuery] = useState('')
  const refs = useRef([])
  const q = query.trim().toLowerCase()

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        title: group.title,
        items: group.items.filter(([, name]) => !q || name.includes(q)),
      })).filter((group) => group.items.length),
    [q],
  )

  const flat = groups.flatMap((group) => group.items)
  const selectedIndex = flat.findIndex(([emoji]) => emoji === value)

  function focusAt(index) {
    const next = (index + flat.length) % flat.length
    refs.current[next]?.focus()
  }

  function onKeyDown(event, index) {
    const delta = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 8,
      ArrowUp: -8,
    }[event.key]
    if (delta) {
      event.preventDefault()
      focusAt(index + delta)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(flat.length - 1)
    }
  }

  let cursor = -1

  return (
    <div className={`ui-emoji-picker ${className}`.trim()} {...props}>
      <div className="ui-emoji-search">
        <Input
          size="sm"
          icon={Search}
          placeholder="Search emoji"
          aria-label="Search emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="ui-emoji-scroll">
        <button
          type="button"
          className={`ui-emoji-none ${value ? '' : 'is-selected'}`.trim()}
          onClick={() => onChange?.(null)}
        >
          None
        </button>
        {groups.length ? (
          groups.map((group) => (
            <div key={group.title} className="ui-emoji-group">
              <div className="ui-emoji-group-title">{group.title}</div>
              <div className="ui-emoji-grid">
                {group.items.map(([emoji, name]) => {
                  cursor += 1
                  const at = cursor
                  const active = emoji === value
                  return (
                    <button
                      key={emoji}
                      ref={(node) => {
                        refs.current[at] = node
                      }}
                      type="button"
                      className={`ui-emoji-option ${active ? 'is-selected' : ''}`.trim()}
                      aria-label={name}
                      title={name}
                      aria-pressed={active}
                      tabIndex={active || (selectedIndex < 0 && at === 0) ? 0 : -1}
                      onClick={() => onChange?.(emoji)}
                      onKeyDown={(event) => onKeyDown(event, at)}
                    >
                      {emoji}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="ui-emoji-empty">No emoji found</div>
        )}
      </div>
    </div>
  )
}
