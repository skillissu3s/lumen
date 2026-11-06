// What every account gets: its own candle, with starter content the first time.
// On a server, people who came in through the server's own invites (or set it
// up) also join the home workspace, as everyone did before spaces.
import { DESKTOP } from './config.js'
import { db } from './db.js'
import * as files from './files.js'
import * as spaces from './spaces.js'
import { seedSpace } from './seed.js'

export async function setUpAccount(user, { joinHome = false } = {}) {
  if (DESKTOP) return null
  const { space, created } = spaces.ensureCandle(user)
  if (created) await seedSpace(files.space(space.id), { handle: user.handle, name: user.name, title: space.name })
  const home = files.homeSpaceId()
  if (joinHome && home) {
    const ws = spaces.get(home)
    // the first person on a new server owns its home workspace
    if (ws && !ws.owner_id) {
      db.prepare('UPDATE spaces SET owner_id = ? WHERE id = ?').run(user.id, home)
      spaces.addMember(home, user.id, 'owner')
    } else spaces.addMember(home, user.id, user.role === 'admin' ? 'admin' : 'member')
  }
  return space
}
