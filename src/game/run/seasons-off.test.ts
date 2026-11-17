/* A text search that keeps season words (Fall, Winter, Spring) off every screen a student can't
 * skip. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
/* Comments are removed before the search, because a comment is allowed to mention the thing the
 * code must never use. */
const bare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every file that draws screen parts a student in their first session can't avoid. */
const CHROME = [
  '../../app/scenes/TitleScene.tsx',
  '../hud/Handbook.tsx',
  '../hud/Hud.tsx',
  '../hud/inventory.ts',
  './wall.ts',
  './tasks.ts',
]

describe('no student reads a season', () => {
  for (const f of CHROME) {
    it(`${f} prints no season word`, () => {
      const src = bare(read(f))
      /* Only matches season names inside a quoted string or template. `SEASONS`, `Season` and
       * `s.season` are the game's data and are fine. */
      const said = [...src.matchAll(/(['"`])([^'"`\n]*\b(?:Fall|Winter|Spring)\b[^'"`\n]*)\1/g)]
        .map((m) => m[2])
        /* A string that is only a season name is a key into `plan.slots`, not a sentence.
         * `slots.Fall` and `assignSlot(year, 'Fall', id)` are code, not text a student reads. */
        .filter((t) => !/^(Fall|Winter|Spring)$/.test(t))
      expect(said, `${f} still says: ${said.join(' | ')}`).toEqual([])
    })
  }

  it('the title never offers a season on its continue sign', () => {
    const src = bare(read('../../app/scenes/TitleScene.tsx'))
    expect(src).not.toMatch(/\$\{save\.season\}/)
    expect(src).toMatch(/runLine\(save\)/)
  })

  it('the Guide is exempt, because the school really does run three seasons', () => {
    /* This checks the exception on purpose, so nobody removes the seasons from the directory to
     * match the rule. */
    const dir = read('../hud/directory.ts')
    expect(dir).toMatch(/heading: 'Fall'/)
    expect(dir).toMatch(/heading: 'Winter'/)
    expect(dir).toMatch(/heading: 'Spring'/)
  })
})
