/* Tests that a student can really fill every season. A sport is locked to its own WIAA season and
 * one programme can't take two seasons in a year, so three seasons need three different programmes.
 * If the roster can't do that, the sheet can't be stamped and the run gets stuck with nothing on
 * screen saying why. */
import { describe, expect, it } from 'vitest'
import { PROGRAMMES } from '../roster/roster'
import { refuseSlot } from '../run/refusal'
import { SEASONS, type SaveGame, type Season } from '../save'
import { SEASONS_OWED } from './schedule'

/* The emptiest possible run: year one, nothing picked, nothing stamped. */
const fresh = (slots: Partial<Record<Season, string>> = {}): SaveGame => ({
  plans: { 1: { slots, classes: [], stamped: false } },
  /* The tokens still in hand. refusal.ts checks these before it lets a season be filled, so a
   * season that's already spent gets refused because of its token, not its slot. */
  tokens: SEASONS.filter((se) => !slots[se]),
} as unknown as SaveGame)

describe('every season can be filled', () => {
  it('offers at least one programme per season on an empty sheet', () => {
    for (const season of SEASONS) {
      const open = PROGRAMMES.filter((p) => !refuseSlot(p.id, season, fresh(), 1))
      expect(open.length, `nothing can go in ${season}`).toBeGreaterThan(0)
    }
  })

  it('can fill all three with three different programmes, which is what the stamp asks for', () => {
    /* Try every arrangement instead of counting. A season might only have options that are already
     * used in another season, so the only real check is to lay them all out. */
    const lay = (i: number, slots: Partial<Record<Season, string>>): boolean => {
      if (i >= SEASONS.length) return true
      const season = SEASONS[i]
      for (const p of PROGRAMMES) {
        if (refuseSlot(p.id, season, fresh(slots), 1)) continue
        if (lay(i + 1, { ...slots, [season]: p.id })) return true
      }
      return false
    }
    expect(lay(0, {})).toBe(true)
  })

  it('and the number the stamp asks for is the number of seasons there are', () => {
    expect(SEASONS_OWED).toBe(SEASONS.length)
  })
})
