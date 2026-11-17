/* Copies the opening and the Maw in from blhs-islands at build time, so the game serves
 * /grapes/<id>/ from its own site and a school Chromebook never loads them from
 * raw.githubusercontent.com. If an island can't be copied the build fails instead of falling back,
 * because the folders it writes are gitignored. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.join(ROOT, 'public', 'grapes')

/* The list is written out instead of read from a directory. The islands/ folder over there also
 * holds skeleton, the template a member copies, and the GitHub path has no directory to read. Every
 * id here needs a row in src/game/roster/vine-islands.ts or has to be the opening, and
 * vendor-islands.test.ts fails if they don't match. */
/* The vine's own three islands plus every island a member shipped. The member folders come from
 * member-islands.json, the same row that puts the programme on the roster. Don't hardcode this
 * list, or a new member's Python never gets copied and their island loads with nothing happening
 * and no error. */
const VINE_OWN = ['panther-maw', 'castaway', 'the-hub']
const MEMBERS = (() => {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'src/game/roster/member-islands.json'), 'utf8')
    const rows = JSON.parse(raw).islands ?? []
    return rows.map((r) => r.folder).filter((f) => typeof f === 'string' && f.trim())
  } catch (e) {
    console.warn(`[islands] could not read member-islands.json, carrying the vine's own only: ${e.message}`)
    return []
  }
})()
const ISLANDS = [...VINE_OWN, ...MEMBERS.filter((f) => !VINE_OWN.includes(f))]

/* The test islands this repo owns. The grape harness runs them, they're committed here, and this
 * script never touches them. */
const FIXTURES = ['hello', 'broken', 'maw-demo']

const REPO = 'BLHS-CS-Club/BLHS-Island-Explorer'
const BRANCH = process.env.BLHS_ISLANDS_BRANCH || 'main'
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/islands`

/**
 * Finds a local checkout to read instead of the network, if there is one. BLHS_ISLANDS=remote
 * forces it to use the network, which is the only way to test what the deploy will really do
 * without pushing a commit.
 */
function checkout() {
  if (process.env.BLHS_ISLANDS === 'remote') return null
  const tries = [process.env.BLHS_ISLANDS, path.join(path.dirname(ROOT), 'blhs-islands')]
  for (const t of tries) {
    if (t && fs.existsSync(path.join(t, 'islands'))) return t
  }
  return null
}

/* Reads one island's files. The manifest comes first because it lists which .py files exist.
 * Reading the whole directory would copy __pycache__ too, and loader.test.ts checks that the .py
 * files on disk are exactly the modules the manifest lists. */
async function read(from, id) {
  const get = from
    ? async (f) => {
        const p = path.join(from, 'islands', id, f)
        if (!fs.existsSync(p)) throw new Error(`${p} is not there`)
        return fs.readFileSync(p)
      }
    : async (f) => {
        const r = await fetch(`${RAW}/${id}/${f}`)
        if (!r.ok) throw new Error(`${RAW}/${id}/${f} answered ${r.status}`)
        return Buffer.from(await r.arrayBuffer())
      }

  const manifest = await get('island.json')
  let m
  try { m = JSON.parse(manifest.toString('utf8')) }
  catch (e) { throw new Error(`${id}/island.json is not JSON: ${e.message}`) }
  if (!m.entry || !Array.isArray(m.modules)) {
    throw new Error(`${id}/island.json declares no entry or no modules`)
  }
  /* The entry is normally listed in modules too. Add it anyway, so a manifest that forgot it
   * doesn't ship without the one file the engine imports. */
  const names = [...new Set([m.entry, ...m.modules])]
  const files = { 'island.json': manifest }
  for (const n of names) files[n] = await get(n)
  return files
}

/** Writes the files out and deletes anything the manifest doesn't list anymore. */
function write(id, files) {
  const dir = path.join(DEST, id)
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, bytes] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), bytes)
  }
  /* An old leftover module causes more trouble than a missing one. loader.test.ts compares the .py
   * files on disk against the manifest, so a file left over from an older version of an island
   * fails the check. Folders get deleted too, which keeps __pycache__ from a member's laptop out. */
  for (const found of fs.readdirSync(dir)) {
    if (files[found]) continue
    fs.rmSync(path.join(dir, found), { recursive: true, force: true })
  }
}

const from = checkout()
console.log(from
  ? `[islands] reading ${ISLANDS.length} from the checkout at ${from}`
  : `[islands] no checkout next door, reading ${ISLANDS.length} from ${REPO}@${BRANCH}`)

let failed = 0
for (const id of ISLANDS) {
  try {
    write(id, await read(from, id))
    console.log(`[islands] ${id}  ->  public/grapes/${id}`)
  } catch (e) {
    failed++
    console.error(`[islands] ${id} FAILED: ${e.message}`)
  }
}

if (failed) {
  console.error(`\n[islands] ${failed} of ${ISLANDS.length} did not come across, so this build would `
    + 'ship without them. Nothing here falls back to a stale copy on purpose: the folders it '
    + 'writes are gitignored, and a deploy missing the Maw looks finished and is not.\n'
    + `Clone ${REPO} beside this repo, or set BLHS_ISLANDS to where it is.`)
  process.exit(1)
}
console.log(`[islands] ${ISLANDS.length} vendored. The fixtures this repo owns (${FIXTURES.join(', ')}) were not touched.`)
