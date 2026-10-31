// Colours for things that don't pick their own: a #label gets the same colour
// every time, chosen from the item palette by its name.
export const PALETTE = ['blue', 'violet', 'teal', 'orange', 'pink', 'green', 'amber', 'indigo', 'red']

export function colorFor(name) {
  let h = 0
  for (const ch of String(name || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** The tags at the end (or anywhere) of a title, split from its words */
export function splitTitle(title) {
  const tags = []
  const text = String(title || '')
    .replace(/(^|\s)#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu, (m, sp, tag) => {
      tags.push(tag)
      return sp
    })
    .replace(/\s+/g, ' ')
    .trim()
  return { text, tags }
}

export const joinTitle = (text, tags) => [String(text).trim(), ...tags.map((t) => `#${t}`)].filter(Boolean).join(' ')
