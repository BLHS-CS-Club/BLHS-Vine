// Tests for when the year sheet's button turns on. Both electives are always needed, and the
// after-school slot only when a real club or sport exists.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scheduleOwed, SEASONS_OWED } from './schedule'
import { SEASONS } from '../save'

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('../roster/member-islands')
})

describe('the two electives are owed whatever the roster says', () => {
  it('is QUIET with nothing picked at all, which reverses rail-3', () => {
    const o = scheduleOwed({ electivesLeft: 2, chosen: 0, realClasses: 0, realActivities: 0 })
    expect(o.ready).toBe(false)
    expect(o.stage).toBe('schedule')
    expect(o.notYet).toBe('Not yet: fill both Elective periods.')
  })

  it('says which one is missing when one is in', () => {
    const o = scheduleOwed({ electivesLeft: 1, chosen: 0, realClasses: 0, realActivities: 0 })
    expect(o.ready).toBe(false)
    expect(o.notYet).toBe('Not yet: fill the last Elective period.')
  })

  it('goes live on the second elective, with no club picked and none real', () => {
    const o = scheduleOwed({ electivesLeft: 0, chosen: 0, realClasses: 0, realActivities: 0 })
    expect(o.ready).toBe(true)
    expect(o.stage).toBe('go')
    expect(o.notYet).toBeNull()
  })
})

describe('the plank, the moment something real exists', () => {
  it('waits for one club or sport and says so', () => {
    const o = scheduleOwed({ electivesLeft: 0, chosen: 0, realClasses: 0, realActivities: 1 })
    expect(o.ready).toBe(false)
    expect(o.stage).toBe('after')
    expect(o.notYet).toBe('Not yet: pick something for all 3 seasons. 3 still empty.')
  })

  it('lights the schedule before the after-school box, never both', () => {
    /* Only one box is lit, the one nearer the top of the page. A lit box further down would pull
     * the student's eye away from what they're reading. */
    const o = scheduleOwed({ electivesLeft: 2, chosen: 0, realClasses: 1, realActivities: 1 })
    expect(o.stage).toBe('schedule')
    expect(o.owesClass && o.owesActivity).toBe(true)
  })

  it('goes live once every season is spent, not once one of them is', () => {
    /* Every season token has to be spent before stamping. */
    const one = scheduleOwed({ electivesLeft: 0, chosen: 1, realClasses: 3, realActivities: 5 })
    expect(one.ready).toBe(false)
    expect(one.notYet).toBe('Not yet: pick something for all 3 seasons. 2 still empty.')
    const two = scheduleOwed({ electivesLeft: 0, chosen: 2, realClasses: 3, realActivities: 5 })
    expect(two.notYet).toBe('Not yet: one season is still empty.')
    const all = scheduleOwed({ electivesLeft: 0, chosen: SEASONS_OWED, realClasses: 3, realActivities: 5 })
    expect(all.ready).toBe(true)
    expect(all.notYet).toBeNull()
  })
})

/* `SEASONS_OWED` has to match the number of tokens the save hands out. Otherwise the stamp asks for
 * a season with no token and the sheet can never be finished. It's a plain number in schedule.ts so
 * that file doesn't have to import the save. */
describe('the number of seasons', () => {
  it('is the number of tokens a year really starts with', () => {
    expect(SEASONS_OWED).toBe(SEASONS.length)
  })
})

/* ---- AND THE ROSTER IS WHERE "REAL" COMES FROM ------------------------- */

const fakeRow = {
  programme: 'example-island',
  name: 'The Example Island',
  place: 'home-island',
  kind: 'club' as const,
  season: 'Fall' as const,
  tags: [],
  playable: true,
  blurb: 'A member built this one.',
  source: 'a test',
}

describe('one row in member-islands.json starts the schedule asking', () => {
  it('asks for nothing AFTER SCHOOL while the table is empty', () => {
    /* This uses zero instead of counting the live roster, so shipping a new island doesn't break
     * this test. */
    /* The electives are filled on purpose. This case is about the after-school half, and a blank
     * period would keep the button off for a reason that has nothing to do with the roster. */
    const o = scheduleOwed({ electivesLeft: 0, chosen: 0, realClasses: 0, realActivities: 0 })
    expect(o.owesActivity).toBe(false)
    expect(o.ready).toBe(true)
  })

  it('asks for the after-school slot the moment a club is playable', async () => {
    vi.doMock('../roster/member-islands', () => ({ MEMBER_ISLANDS: [fakeRow] }))
    const { PROGRAMMES } = await import('../roster/roster')
    const real = PROGRAMMES.filter((p) => p.playable).length
    expect(real).toBe(1)
    const o = scheduleOwed({ electivesLeft: 0, chosen: 0, realClasses: 0, realActivities: real })
    expect(o.ready, 'a real club exists and the plank still ends the beat').toBe(false)
    expect(o.notYet).toBe('Not yet: pick something for all 3 seasons. 3 still empty.')
  })

  it('asks for the elective periods the moment a class is playable', async () => {
    vi.doMock('../roster/member-islands', () => ({
      MEMBER_ISLANDS: [{ ...fakeRow, programme: 'spanish-1', name: 'Spanish I' }],
    }))
    const { classIsReal } = await import('../roster/placeholders')
    const { CLASSES } = await import('./catalog')
    const realClasses = CLASSES.filter((c) => classIsReal(c.id)).length
    expect(realClasses).toBe(1)
    expect(scheduleOwed({ electivesLeft: 2, chosen: 0, realClasses, realActivities: 0 }).ready).toBe(false)
  })
})
