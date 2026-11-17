/* Checks that the vendored islands are really on disk and that the build really fetches them. */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { VINE_ISLANDS } from '../../game/roster/vine-islands'

const ROOT = process.cwd()
const GRAPES = path.join(ROOT, 'public', 'grapes')
const VENDOR = path.join(ROOT, 'scripts', 'vendor-islands.mjs')

/* Read the script's source instead of importing it. Importing it runs the whole vendor step,
 * network and all, and a test that fetched from GitHub would fail with no internet instead of
 * failing on a real mistake. */
const vendored = (): string[] => {
  const src = fs.readFileSync(VENDOR, 'utf8')
  /* The vine's own three islands are written right in the script, while the members' folders come
   * from `member-islands.json` when the vendor step runs. So this reads the list from the script
   * and adds the same file the script does. */
  const m = src.match(/const VINE_OWN = \[([^\]]*)\]/)
  if (!m) throw new Error('scripts/vendor-islands.mjs no longer declares a VINE_OWN array')
  const own = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  const rows = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'src/game/roster/member-islands.json'), 'utf8',
  )).islands ?? []
  return [...own, ...rows.map((r: { folder?: string }) => r.folder).filter(Boolean)]
}

describe('the islands the vine owns', () => {
  it('are all on the vendor list', () => {
    /* A row added to vine-islands.ts but missing here is an island the engine puts on a map and
     * then can't serve. /grapes/<folder>/ gives a 404 and the map loads with no Python behind it. */
    for (const i of VINE_ISLANDS) expect(vendored()).toContain(i.folder)
  })

  it('are on disk, which means the vendor actually ran', () => {
    for (const id of vendored()) {
      const dir = path.join(GRAPES, id)
      expect(fs.existsSync(dir), `public/grapes/${id} is missing. Run \`npm run vendor\`.`).toBe(true)
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'island.json'), 'utf8'))
      /* The entry is the one file the engine imports, so without it the island is missing, no
       * matter how many other modules got copied. */
      expect(fs.existsSync(path.join(dir, m.entry)), `${id}/${m.entry}`).toBe(true)
    }
  })

  it('are fetched by the build and not only by somebody remembering', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    /* build is the one that matters most. Without it the deploy serves a game whose home base gives
     * a 404, and nobody notices until a player tries to go there. */
    for (const s of ['build', 'dev', 'test']) {
      expect(pkg.scripts[s], `npm run ${s}`).toContain('vendor-islands.mjs')
    }
  })
})
