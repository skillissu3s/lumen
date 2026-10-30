// Free-form text (docs) changed in two places at once: our edit, made against
// `base`, is replayed onto `theirs` with diff-match-patch. Item files don't need
// this — their edits are re-applied by id (see items.js).

import DiffMatchPatch from 'diff-match-patch'

const dmp = new DiffMatchPatch()
dmp.Match_Threshold = 0.4
dmp.Patch_DeleteThreshold = 0.4

/** Returns { text, clean } — clean is false if some of our changes couldn't be placed */
export function rebaseText(base, ours, theirs) {
  if (ours === base) return { text: theirs, clean: true }
  if (theirs === base || theirs === ours) return { text: ours, clean: true }
  const patches = dmp.patch_make(base, ours)
  const [text, applied] = dmp.patch_apply(patches, theirs)
  return { text, clean: applied.every(Boolean) }
}

/** Git's blob hash of a text (what GitHub calls a file's sha), in Node and in browsers */
export async function blobSha(text) {
  const body = new TextEncoder().encode(String(text))
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = await globalThis.crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
