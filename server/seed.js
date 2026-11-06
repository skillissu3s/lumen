// First-run content for an empty space (the files themselves are in
// shared/seed.js). Writes only what doesn't exist yet, so seeding is safe to
// run again on a space someone already uses.
import { seedFiles } from '../shared/seed.js'
import * as files from './files.js'

/**
 * Makes the starter files in `space` (a files.space()) for `handle`. `title`:
 * the space's name in its lumen.json. `chat`: also the general channel.
 * Returns the paths created.
 */
export async function seedSpace(space, { handle, name, title, chat = false }) {
  const created = []
  const all = seedFiles({ handle, name, chat })
  if (title) all['lumen.json'] = `${JSON.stringify({ ...JSON.parse(all['lumen.json']), name: title }, null, 2)}\n`
  for (const [path, text] of Object.entries(all)) {
    if (await space.read(path)) continue
    await space.write(path, text, { by: 'seed' })
    created.push(path)
  }
  return created
}

/** The home space's starter files */
export const seedWorkspace = (opts) => seedSpace(files.home(), opts)
