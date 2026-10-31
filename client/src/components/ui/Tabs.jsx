import { useRef } from 'react'

export function Tabs({ value, onChange, tabs = [], className = '', ...props }) {
  const refs = useRef([])
  const selected = tabs.findIndex((tab) => tab.value === value)

  function choose(index) {
    const next = tabs[index]
    if (!next) return
    onChange?.(next.value)
    refs.current[index]?.focus()
  }

  function onKeyDown(event, index) {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (delta) {
      event.preventDefault()
      choose((index + delta + tabs.length) % tabs.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      choose(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      choose(tabs.length - 1)
    }
  }

  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist" {...props}>
      {tabs.map((tab, i) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[i] = node
            }}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ui-tab ${active ? 'is-active' : ''}`.trim()}
            tabIndex={active || (selected < 0 && i === 0) ? 0 : -1}
            onClick={() => choose(i)}
            onKeyDown={(event) => onKeyDown(event, i)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
