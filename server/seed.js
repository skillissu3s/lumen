// First-run content for an empty workspace (the files themselves are in
// shared/seed.js, shared with GitHub mode). Writes only what doesn't exist yet,
// so seeding is safe to run again on a folder someone already uses.
import { seedFiles } from '../shared/seed.js'
import * as files from './files.js'

/** Makes the starter files for `handle`. `chat`: also the general channel. Returns the paths created. */
export async function seedWorkspace({ handle, name, chat = false }) {
  const created = []
  for (const [path, text] of Object.entries(seedFiles({ handle, name, chat }))) {
    if (await files.read(path)) continue
    await files.write(path, text, { by: 'seed' })
    created.push(path)
  }
  return created
}
