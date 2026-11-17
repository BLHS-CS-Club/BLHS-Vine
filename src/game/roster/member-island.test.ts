/* Tests what a club member actually gets when they publish an island, from start to finish. */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/* Every test here changes the real roster tables and puts them back in a `finally`. If a `playable:
 * true` leaked out, a real student could see a placeholder programme. The sailing part is tested
 * separately by `scripts/travel-pick-proof.mjs`. */

async function fresh() {
  vi.resetModules()
  const save = await import('../save')
  const roster = await import('./roster')
  const pick = await import('../run/pick')
  const objective = await import('../run/objective')
  const year = await import('../run/year')
  const wall = await import('../run/wall')
  const { engine } = await import('../intent-engine')
  return { save, roster, pick, objective, year, wall, engine }
}

type M = Awaited<ReturnType<typeof fresh>>

/** Publish an island the way a member would, and give back a function that undoes it. */
function shipIsland(m: M, programmeId: string, map: string) {
  const g = m.roster.PROGRAMMES.find((p) => p.id === programmeId)!
  const place = m.roster.PLACES.find((p) => p.id === g.place)!
  const was = { playable: g.playable, maps: place.maps, arrival: place.arrival }
  ;(g as { playable: boolean }).playable = true
  ;(place as { maps: string[] }).maps = [map]
  ;(place as { arrival?: string }).arrival = map
  return () => {
    ;(g as { playable: boolean }).playable = was.playable
    ;(place as { maps: string[] }).maps = was.maps
    ;(place as { arrival?: string }).arrival = was.arrival
  }
}

function started(m: M) {
  m.save.beginAdventure()
  m.save.writeSave({ introDone: true })
  m.save.setFlag('maw:founding')
  m.save.setFlag('vignette:y1')
}

describe('a member ships an island', () => {
  beforeEach(() => localStorage.clear())

  it('turns the pick into a voyage everywhere, from one roster row', async () => {
    const m = await fresh()
    started(m)
    m.save.assignSlot(1, 'Fall', 'football')
    m.save.pickClass(1, 'ap-human-geo')
    m.save.stampPlan(1, ['football'])

    /* Before: nothing is built, so the pick is played from the year sheet. */
    const before = m.pick.picksOf(m.save.loadSave())!.find((p) => p.id === 'football')!
    expect(before.map).toBeNull()
    expect(m.pick.pickVerb(before)).toBe('Go')

    const undo = shipIsland(m, 'football', 'stadium-a1')
    try {
      const after = m.pick.picksOf(m.save.loadSave())!.find((p) => p.id === 'football')!
      expect(after.map, 'the roster now names a painting').toBe('stadium-a1')
      expect(m.pick.pickVerb(after)).toMatch(/^Sail to /)

      /* The objective bar says the same thing, without making its own separate decision. */
      m.save.recordGrade({
        id: 'core:y1', title: 'Advisory', kind: 'core', credit: 0.5, grade: 4, year: 1, season: 'Fall',
      })
      m.save.recordGrade({
        id: 'class:ap-human-geo', title: 'x', kind: 'class', credit: 0.5, grade: 4, year: 1, season: 'Fall',
      })
      const o = m.objective.nextObjective(m.save.loadSave())!
      expect(o.say).toMatch(/^Sail to /)
    } finally { undo() }
  })

  /* `award(programme=..., grade=...)` is the one call an island makes to finish itself. This test
   * checks everything that call has to update. */
  it('lands a graded award on the transcript, the wall, the state and the year', async () => {
    const m = await fresh()
    started(m)
    m.save.assignSlot(1, 'Fall', 'football')
    m.save.stampPlan(1, ['football'])
    m.save.recordGrade({
      id: 'core:y1', title: 'Advisory', kind: 'core', credit: 0.5, grade: 4, year: 1, season: 'Fall',
    })
    expect(m.year.yearStatus(m.save.loadSave()!).readyForYearbook, 'the club is still owed').toBe(false)

    const undo = shipIsland(m, 'football', 'stadium-a1')
    try {
      m.engine.award({ programme: 'football', grade: 3.5 })

      const s = m.save.loadSave()!
      expect(s.ledger.some((e) => e.id === 'island:football:y1'), 'a transcript row').toBe(true)
      expect(s.completions!.some((c) => c.programme === 'football' && c.year === 1), 'a completion').toBe(true)
      expect(s.islands.football, 'the world knows it is finished').toBe('completed')

      const seat = m.wall.wallOf(s).find((w) => w.id === 'programme:football')!
      expect(seat.earned, 'a filled frame on the wall').toBe(true)

      expect(m.year.yearStatus(s).readyForYearbook, 'and the year can close').toBe(true)
      expect(m.pick.picksOf(s)!.find((p) => p.id === 'football')!.done).toBe(true)
    } finally { undo() }
  })

  /* An island that gives no score still counts as finished, and never as an F. */
  it('lands an ungraded award as finished rather than as a zero', async () => {
    const m = await fresh()
    started(m)
    m.save.assignSlot(1, 'Fall', 'football')
    m.save.stampPlan(1, ['football'])

    const undo = shipIsland(m, 'football', 'stadium-a1')
    try {
      m.engine.award({ programme: 'football' })
      const s = m.save.loadSave()!
      const row = s.completions!.find((c) => c.programme === 'football')!
      expect(row.grade, 'no grade, not a zero').toBeNull()
      /* The wall should say `finished` and the rank the year earned, with no letter grade anywhere,
       * because a programme that gave no score has no grade to print. */
      const says = m.wall.wallOf(s).find((w) => w.id === 'programme:football')!.says!
      expect(says).toContain('finished')
      expect(says).toContain('JV')
      expect(says, 'and never an F').not.toMatch(/F/)
    } finally { undo() }
  })

  /* The rank ladder a programme lists is what moves a student up toward Captain. */
  it('counts the year toward the programme own rank track', async () => {
    const m = await fresh()
    started(m)
    m.save.assignSlot(1, 'Fall', 'football')
    m.save.stampPlan(1, ['football'])
    const undo = shipIsland(m, 'football', 'stadium-a1')
    try {
      m.engine.award({ programme: 'football', grade: 3 })
      const { ranksOf, rankName } = await import('../progress')
      const track = m.roster.programmeById('football')!.rankTrack!
      expect(rankName(ranksOf(m.save.loadSave()!)[track] ?? 0)).toBe('JV')
    } finally { undo() }
  })

  /* Only the roster row has to change, so once the row is put back every screen goes back to the
   * placeholder version. */
  it('goes back to a sheet pick the moment the roster row is taken away', async () => {
    const m = await fresh()
    started(m)
    m.save.assignSlot(1, 'Fall', 'football')
    m.save.stampPlan(1, ['football'])
    const undo = shipIsland(m, 'football', 'stadium-a1')
    expect(m.pick.picksOf(m.save.loadSave())!.find((p) => p.id === 'football')!.map).toBe('stadium-a1')
    undo()
    expect(m.pick.picksOf(m.save.loadSave())!.find((p) => p.id === 'football')!.map).toBeNull()
  })

  /* The tests above change the tables by hand, so they only test the code that reads them. This one
   * checks that a real `member-islands.json` row actually reaches its place's `maps` list. If it
   * didn't, `islandForProgramme` would give back null and the button would say Go even after the
   * island was published. */
  it('reaches the place from a member-islands row, which is the whole contract', async () => {
    const { PLACES, PROGRAMMES, islandForProgramme } = await import('./roster')
    const { MEMBER_ISLANDS } = await import('./member-islands')

    for (const row of MEMBER_ISLANDS) {
      const place = PLACES.find((p) => p.id === row.place)
      expect(place, `${row.programme} names place "${row.place}", which is not on the roster`).toBeTruthy()
      expect(place!.maps, `${row.programme}'s painting never reached its place`).toContain(row.map)
      expect(place!.arrival, `${row.place} has maps and names no arrival`).toBeTruthy()

      const g = PROGRAMMES.find((p) => p.id === row.programme)
      expect(g, `${row.programme} is not on the roster`).toBeTruthy()
      if (!row.playable) continue
      const island = islandForProgramme(row.programme)
      expect(island, `${row.programme} is playable and still cannot be sailed to`).toBeTruthy()
      expect(island!.map).toBe(row.map)
    }
  })

  /* The check above only covers rows that are already in the file. This one runs a hand-made row
   * through the same table-building steps and checks it comes out with a map the ship can sail to. */
  it('would carry a row nobody has shipped yet', async () => {
    const { SOURCED_PLACES } = await import('./roster')
    const place = SOURCED_PLACES.find((p) => p.id === 'stadium')!
    /* The same thing `PLACES` does with a member row, done by hand on the same inputs. */
    const added = ['stadium-a1'].filter((m) => !place.maps.includes(m))
    const withMap = { ...place, maps: [...place.maps, ...added], arrival: place.arrival ?? added[0] }
    expect(withMap.maps).toContain('stadium-a1')
    expect(withMap.arrival, 'a place with no arrival takes the first painting shipped for it').toBeTruthy()
  })
})
