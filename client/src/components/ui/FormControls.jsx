import { Children, cloneElement, forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export const Input = forwardRef(function Input(
  { size = 'md', icon: Icon, invalid = false, className = '', type = 'text', ...props },
  ref,
) {
  const wrapClasses = ['ui-input-wrap', size === 'sm' ? 'ui-input-wrap--sm' : '', Icon ? 'ui-input-wrap--icon' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <span className={wrapClasses}>
      {Icon ? (
        <span className="ui-input-icon">
          <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        </span>
      ) : null}
      <input
        ref={ref}
        type={type}
        className={`ui-input ${invalid ? 'is-invalid' : ''} ${className}`.trim()}
        aria-invalid={invalid || undefined}
        {...props}
      />
    </span>
  )
})

export const Textarea = forwardRef(function Textarea(
  { autoSize = false, invalid = false, className = '', value, onInput, ...props },
  ref,
) {
  const innerRef = useRef(null)
  useImperativeHandle(ref, () => innerRef.current)

  function resize() {
    const node = innerRef.current
    if (!node || !autoSize) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }

  useLayoutEffect(resize, [value, autoSize])

  return (
    <textarea
      ref={innerRef}
      value={value}
      onInput={(event) => {
        resize()
        onInput?.(event)
      }}
      className={`ui-textarea ${invalid ? 'is-invalid' : ''} ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
})

export function Field({ label, hint, error, children, className = '', ...props }) {
  const autoId = useId()
  const child = Children.only(children)
  const id = child.props.id || autoId
  const hintId = `${autoId}-hint`
  const errorId = `${autoId}-error`
  const describedBy = [child.props['aria-describedby'], hint && !error ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  const control = cloneElement(child, {
    id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : child.props['aria-invalid'],
  })

  return (
    <div className={`ui-field ${className}`.trim()} {...props}>
      {label ? (
        <label className="ui-field-label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {control}
      {hint && !error ? (
        <span className="ui-field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ui-field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export const Select = forwardRef(function Select(
  { options = [], className = '', ...props },
  ref,
) {
  return (
    <span className="ui-select-wrap">
      <select ref={ref} className={`ui-select ${className}`.trim()} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="ui-select-icon">
        <ChevronDown size={15} strokeWidth={1.75} aria-hidden="true" />
      </span>
    </span>
  )
})

export function Checkbox({ checked = false, onChange, label, className = '', ...props }) {
  return (
    <label className={`ui-checkbox ${className}`.trim()}>
      <input
        type="checkbox"
        className="ui-checkbox-input"
        checked={checked}
        onChange={onChange}
        {...props}
      />
      <span className="ui-checkbox-box" aria-hidden="true">
        {checked ? <Check size={12} strokeWidth={2.25} /> : null}
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  )
}

export function Switch({ checked = false, onChange, label, className = '', ...props }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : props['aria-label'] || 'Toggle'}
      className={`ui-switch ${className}`.trim()}
      onClick={() => onChange?.(!checked)}
      {...props}
    >
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  )
}
