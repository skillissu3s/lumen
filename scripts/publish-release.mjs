// Publishes a built release to the public downloads repository.
//
//   node scripts/publish-release.mjs v0.1.1
//
// The Release workflow builds the installers into a draft release of this
// (private) repository. This copies them — with the notes from CHANGELOG.md — to
// a release of skillissu3s/lumen-releases and marks it latest, which is what the
// download links and the apps' automatic updates read. Needs the GitHub CLI,
// signed in with access to both repositories.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SOURCE = 'skillissu3s/lumen'
const PUBLIC = 'skillissu3s/lumen-releases'
const EXPECTED = ['Lumen-Setup.exe', 'Lumen.dmg', 'Lumen.AppImage', 'lumen.deb', 'latest.yml', 'latest-mac.yml', 'latest-linux.yml']

const tag = process.argv[2]
if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) {
  console.error('Usage: node scripts/publish-release.mjs vX.Y.Z')
  process.exit(1)
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })

// everything built?
const assets = JSON.parse(gh('release', 'view', tag, '-R', SOURCE, '--json', 'assets')).assets.map((a) => a.name)
const missing = EXPECTED.filter((n) => !assets.includes(n))
if (missing.length) {
  console.error(`The build of ${tag} isn't complete yet (missing: ${missing.join(', ')}). Check the Release workflow.`)
  process.exit(1)
}

// the notes: this version's section of CHANGELOG.md
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const version = tag.slice(1)
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`))
const title = section ? `Lumen ${section.split('\n')[0].replace(/\s+—\s+/, ' — ')}` : `Lumen ${version}`
const notes = section ? section.split('\n').slice(1).join('\n').trim() : `Lumen ${version}`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-release-'))
try {
  console.log(`Downloading ${assets.length} files from ${SOURCE} ${tag}…`)
  gh('release', 'download', tag, '-R', SOURCE, '-D', dir, '--clobber')
  const notesFile = path.join(dir, 'NOTES.md')
  fs.writeFileSync(notesFile, notes)
  const files = fs.readdirSync(dir).filter((f) => f !== 'NOTES.md').map((f) => path.join(dir, f))

  let exists = true
  try {
    gh('release', 'view', tag, '-R', PUBLIC, '--json', 'tagName')
  } catch {
    exists = false
  }
  if (exists) {
    // resuming: send only what isn't there yet (or differs in size)
    const there = new Map(JSON.parse(gh('release', 'view', tag, '-R', PUBLIC, '--json', 'assets')).assets.map((a) => [a.name, a.size]))
    const todo = files.filter((f) => there.get(path.basename(f)) !== fs.statSync(f).size)
    console.log(`Updating ${PUBLIC} ${tag}: ${todo.length} of ${files.length} files to upload…`)
    if (todo.length) gh('release', 'upload', tag, '-R', PUBLIC, '--clobber', ...todo)
    gh('release', 'edit', tag, '-R', PUBLIC, '--title', title, '--notes-file', notesFile, '--draft=false', '--latest')
  } else {
    console.log(`Publishing ${PUBLIC} ${tag}…`)
    gh('release', 'create', tag, '-R', PUBLIC, '--title', title, '--notes-file', notesFile, '--latest', ...files)
  }
  console.log(`Done: https://github.com/${PUBLIC}/releases/tag/${tag}`)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
