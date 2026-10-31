// File naming: stable slugs for paths, and unique paths that never collide.

/** Lowercase `a-z0-9` and `-`, max 48 chars, `untitled` when there is nothing left. */
export function slugify(name) {
  const s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return s || 'untitled'
}

/** `uniquePath('lists', 'groceries', 'md', paths)` → `lists/groceries.md` or `-2`. */
export function uniquePath(dir, name, ext, existingPaths) {
  const base = slugify(name)
  const suffix = ext ? `.${ext}` : ''
  const seen = new Set(existingPaths)
  let candidate = `${dir}/${base}${suffix}`
  let n = 2
  while (seen.has(candidate)) {
    candidate = `${dir}/${base}-${n}${suffix}`
    n++
  }
  return candidate
}
