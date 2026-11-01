// Front matter written the same way every time: the keys in the order given,
// values formatted by the shared front matter code (so files read back exactly).

import { withFrontMatter } from '../../../shared/frontmatter.js'

/** `{ key: value }` (in order) → the `---` block, without a trailing newline */
export function frontMatter(meta) {
  return withFrontMatter(meta).replace(/\n+$/, '')
}
