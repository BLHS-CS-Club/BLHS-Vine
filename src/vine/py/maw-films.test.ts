/* Checks that the opening film and the closing film never play in the same sitting. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/* Read the vendored copy, because that's the one the game actually serves. */
const read = (f: string) =>
  fs.readFileSync(path.resolve(process.cwd(), 'public', 'grapes', 'panther-maw', f), 'utf8')

const island = read('island.py')
const founding = read('founding.py')

/** How far a line is indented. Indenting is the only way Python shows which block a line is in. */
const indent = (line: string) => line.length - line.replace(/^\s*/, '').length

/** Finds the `if` a line sits under: the nearest line above it with a smaller indent. */
function conditionOver(src: string, needle: string): string {
  const lines = src.split('\n')
  const at = lines.findIndex((l) => l.includes(needle))
  if (at < 0) throw new Error(`islands/panther-maw no longer contains "${needle}"`)
  for (let i = at - 1; i >= 0; i--) {
    const l = lines[i]
    if (!l.trim() || l.trim().startsWith('#')) continue
    if (indent(l) < indent(lines[at]) && l.trim().startsWith('if ')) return l.trim()
    if (indent(l) < indent(lines[at])) break
  }
  throw new Error(`"${needle}" is not guarded by any condition`)
}

describe('the opening and the ending are never the same sitting', () => {
  /* The latch is a module variable, so it resets when the map loads again, not when the run ends. */
  it('remembers the opening in something that dies with the map load', () => {
    expect(island).toMatch(/^_OPENED_HERE = \[\]$/m)
    /* Nothing about this visit goes into the save. */
    expect(island).not.toMatch(/set_flag\([^)]*OPENED/i)
  })

  it('records the opening on the load that plays it', () => {
    const body = island.slice(island.indexOf('def walking_in():'))
    const railAt = body.indexOf('rail(walk=True)')
    const latchAt = body.indexOf('_OPENED_HERE.append(')
    expect(railAt, 'walking_in no longer runs the opening').toBeGreaterThan(-1)
    expect(latchAt, 'walking_in no longer records that it ran').toBeGreaterThan(-1)
    /* Write the latch before the film, not after. The film is minutes long and any word in it can
     * refuse, and a latch that comes after a refusal never gets written. */
    expect(latchAt).toBeLessThan(railAt)
  })

  /* Neither way into the ending can play both films in one sitting. Loading the room checks the
   * latch, so the ending can't start on the same load that played the opening. Pressing the
   * principal is blocked by `maw:handed_over` instead, which is the opening's last line, and every
   * pick on the sheet comes after it. */
  it('will not start the ending on the load that played the opening', () => {
    const endings = [...island.matchAll(/yield from ending\(\)/g)]
    expect(endings.length, 'no road to the ending is left in island.py').toBeGreaterThan(0)
    const fences = endings.map((e) => {
      const line = island.slice(0, e.index).split('\n').pop()!
      return conditionOver(island, `${line}yield from ending()`)
    })
    /* The way in by loading the room, which is the one the latch is for. */
    expect(fences.some((c) => c.includes('not _OPENED_HERE')),
      `no road keeps the latch: ${JSON.stringify(fences)}`).toBe(true)
    /* Every way in has to be blocked by something that means the opening is over. */
    for (const c of fences) {
      expect(/not _OPENED_HERE|HANDED_OVER in flags/.test(c), `an ungated ending: ${c}`).toBe(true)
    }
    /* Both ways ask the sequencer whether the year is really done. */
    for (const c of fences) expect(c, `a road that does not check the year: ${c}`).toContain('done')
  })

  /* There's no third way in at all: no station opens the yearbook. */
  it('leaves the page-turning to the film and to nothing else', () => {
    expect(island, 'a station outside the closing film opens the yearbook')
      .not.toMatch(/open\("yearbook"/)
    expect(founding, 'the closing film no longer turns the page')
      .toMatch(/yield open\("yearbook", wait=True\)/)
  })

  /* Two things start the ending: pressing the principal, and walking into the Maw with the year
   * done. The counselor doesn't, because the closing is the principal coming to find the player.
   * This checks the source code, because what matters is which MicroPython handler makes the call. */
  it('has exactly two roads into the ending, and neither is the counselor', () => {
    const of = (fn: string) => {
      const at = island.indexOf(`def ${fn}(`)
      if (at < 0) throw new Error(`island.py has no ${fn}()`)
      const end = island.indexOf('@on_', at + 4)
      return island.slice(at, end > 0 ? end : undefined)
    }
    expect(of('walking_in'), 'walking in with the year done no longer starts it')
      .toContain('yield from ending()')
    expect(of('the_principal'), 'pressing the principal no longer starts it')
      .toContain('yield from ending()')
    expect(of('the_counselor'), 'the counselor starts the ending again')
      .not.toContain('yield from ending()')
  })

  /* year_is_done only asks the sequencer. The latch is the only extra condition on the ending, so
   * the ending can start on the next entry into the room. */
  it('asks the sequencer and nothing else about whether the year is done', () => {
    expect(founding).toMatch(/def year_is_done\(\):/)
    expect(founding).toMatch(/phase = yield get\("phase"\)/)
    expect(founding).toMatch(/return phase == "yearbook"/)
  })
})

describe('the trophy case', () => {
  /* The trophy case is drawn furniture, so it stays on the wall whatever the count is. */
  it('is never hidden by the room dressing itself', () => {
    const body = founding.slice(founding.indexOf('def dress_the_wall('))
    const end = body.indexOf('\ndef ', 1)
    const fn = body.slice(0, end > 0 ? end : undefined)
    expect(fn).toContain('yield show(WALL, True)')
    expect(fn, 'the count decides the case again').not.toMatch(/show\(WALL,\s*count/)
  })
})

/* No coordinates in the rail. Stand points come from the published map by anchor name. A table of
 * pixel offsets is only right for one export, and once someone drags a mark the offsets are wrong
 * while every test still passes. */
describe('the rail hardcodes no geometry', () => {
  it('passes no offset to any word', () => {
    const bad = founding.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /\boff\s*=/.test(l) && !l.trim().startsWith('#'))
    expect(bad.map(([n, l]) => `${n}: ${l.trim()}`), 'an offset is back in the rail').toEqual([])
  })

  it('names no compass heading at a station, since which way is "at him" is the map\'s to know', () => {
    /* The rule only bans compass directions. A direction typed into a film guesses where a table
     * was left in MAPVIS, while a name gets looked up in the loaded export. So the check is against
     * the eight directions, matching THE_EIGHT in `blhs-islands/tests/test_the_maw.py`. */
    const EIGHT = ['north', 'north-east', 'east', 'south-east',
      'south', 'south-west', 'west', 'north-west']
    const bad = founding.split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => /actor_face\(/.test(l) && !l.trim().startsWith('#'))
      .filter(([, l]) => EIGHT.some((d) => l.includes(`"${d}"`) || l.includes(`'${d}'`)))
    expect(bad.map(([n, l]) => `${n}: ${l.trim()}`), 'a written heading is back').toEqual([])
  })

  /* The stations are still called by name, which is what makes the checks above safe. */
  it('still takes him to the stations by anchor name', () => {
    for (const w of ['chart_table', 'hearth', 'trophy_wall', 'counselor']) {
      expect(founding, `the rail no longer names ${w}`).toContain(`"${w}"`)
    }
  })
})
