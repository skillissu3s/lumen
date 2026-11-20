// Your name and your username, asked together wherever an account is made: the
// name is what people see (and names your candle), the username is how they
// mention and share with you. The username follows the name until you change it.
import { useState } from 'react'
import { Field, Input } from '../components/ui/index.js'

/** "Nikhil Kumar" → "nikhil-kumar": a username the server will take, if it's free */
export function suggestHandle(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
}

/** `form` has `name` and `handle`; `onChange(patch)` */
export default function NameFields({ form, onChange, autoFocus = true }) {
  const [typed, setTyped] = useState(!!form.handle && form.handle !== suggestHandle(form.name))
  return (
    <>
      <Field label="Your name" hint="What people see, and the name of your candle.">
        <Input autoComplete="name" value={form.name} onChange={(e) => onChange({ name: e.target.value, ...(typed ? {} : { handle: suggestHandle(e.target.value) }) })} required autoFocus={autoFocus} maxLength={80} />
      </Field>
      <Field label="Username" hint="How people mention you and share with you. Lowercase letters, digits and dashes.">
        <Input
          autoComplete="username"
          value={form.handle}
          onChange={(e) => {
            setTyped(true)
            onChange({ handle: e.target.value.toLowerCase().replace(/^@/, '') })
          }}
          required
          minLength={2}
          maxLength={24}
          pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
          spellCheck={false}
        />
      </Field>
    </>
  )
}
