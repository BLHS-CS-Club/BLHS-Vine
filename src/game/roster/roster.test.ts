// Tests that the roster keeps its four kinds of id separate: map ids, place ids, programme ids and
// rank track ids.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PLACES, PROGRAMMES, placeById, placeOfMap, placeOfProgramme, programmeById,
  programmeOfRankTrack, programmesAt, programmeAllowedIn, isPlayable, rankTrackOf,
  rosterFaults, seasonOf, SPORT_SEASONS, SOURCED_PLACES, SOURCED_PROGRAMMES,
} from './roster'
import { EXAMPLE_BLURB } from './example'

beforeEach(() => { localStorage.clear() })

describe('the roster refuses a key that holds two things', () => {
  it('has no faults at all', () => {
    expect(rosterFaults()).toEqual([])
  })

  it('names every fault kind rather than only the ones the shipped data has', () => {
    // A place whose arrival isn't one of its maps.
    expect(rosterFaults(
      [{ id: 'p', name: 'p', maps: ['m'], arrival: 'other', paintings: 1, source: 't' }], [],
    )).toEqual([{ key: 'p', why: 'arrival map "other" is not one of this place\'s maps' }])

    // Two places claiming the same map.
    expect(rosterFaults([
      { id: 'a', name: 'a', maps: ['m'], arrival: 'm', paintings: 1, source: 't' },
      { id: 'b', name: 'b', maps: ['m'], arrival: 'm', paintings: 1, source: 't' },
    ], [])).toContainEqual({ key: 'm', why: 'map is claimed by both "a" and "b"' })

    // A place with more maps than its `paintings` limit.
    expect(rosterFaults(
      [{ id: 'a', name: 'a', maps: ['m', 'n'], arrival: 'm', paintings: 1, source: 't' }], [],
    )).toContainEqual({ key: 'a', why: 'carries 2 maps against 1 authorised paintings' })

    // A programme naming a place that isn't on the roster.
    expect(rosterFaults([], [
      { id: 'g', name: 'g', place: 'nowhere', kind: 'club', tags: [], playable: false, blurb: '', source: 't' },
    ])).toContainEqual({ key: 'g', why: 'names place "nowhere", which is not on the roster' })

    // One string used as two kinds of id at once.
    expect(rosterFaults(
      [{ id: 'stadium', name: 's', maps: ['stadium'], arrival: 'stadium', paintings: 1, source: 't' }],
      [{ id: 'stadium', name: 's', place: 'stadium', kind: 'club', tags: [], playable: false, blurb: '', source: 't' }],
    ).map((f) => f.why)).toEqual(expect.arrayContaining([
      'is both a programme id and a place id',
      'is both a programme id and a map id',
    ]))
  })
})

describe('a place holds more than one programme (W1, the stadium)', () => {
  it('derives the stadium\'s three programmes from their own place field', () => {
    expect(programmesAt('stadium').map((p) => p.id).sort())
      .toEqual(['football', 'girls-flag-football', 'track-field'])
  })

  it('gives them three different seasons out of one vocabulary', () => {
    expect(seasonOf(programmeById('football')!)).toBe('Fall')
    expect(seasonOf(programmeById('girls-flag-football')!)).toBe('Winter')
    expect(seasonOf(programmeById('track-field')!)).toBe('Spring')
    // The seasons all come from the one school table.
    expect(SPORT_SEASONS['girls-flag-football']).toBe('Winter')
  })

  it('gives them three different rank tracks, so one ladder is not three', () => {
    const tracks = programmesAt('stadium').map((p) => rankTrackOf(p.id))
    expect(new Set(tracks).size).toBe(3)
  })

  it('resolves all three to the same place and the place to no map yet', () => {
    for (const id of ['football', 'girls-flag-football', 'track-field'])
      expect(placeOfProgramme(id)?.id).toBe('stadium')
    // A place with no painting has an empty maps list, not a made-up map id.
    expect(placeById('stadium')!.maps).toEqual([])
    expect(placeById('stadium')!.paintings).toBe(0)
  })
})

describe('a place made of more than one painting (W2, the home island)', () => {
  it('is one place holding both the hub and the Maw', () => {
    expect(placeOfMap('hub')?.id).toBe('home-island')
    expect(placeOfMap('panther-maw')?.id).toBe('home-island')
    expect(placeById('home-island')!.arrival).toBe('hub')
  })
  it('answers nothing for a map nobody has put on a place', () => {
    expect(placeOfMap('quayprop')).toBeUndefined()
  })
})

describe('playability is a field, not a hardcoded Set (N1)', () => {
  it('is read off the programme, and only what somebody built is true', () => {
    /* atc is the only playable programme on the roster right now. */
    const playable = PROGRAMMES.filter((p) => p.playable).map((p) => p.id)
    expect(playable).toEqual(['atc'])
    expect(isPlayable('atc')).toBe(true)
    expect(isPlayable('football')).toBe(false)
    expect(isPlayable('nothing-by-that-name')).toBe(false)
  })
})

describe('the rank track is its own key space', () => {
  it('resolves keyclub back to its programme, which a programme lookup could not', () => {
    // The name that comes back is whatever the programme is called right now, including a
    // placeholder name.
    expect(programmeOfRankTrack('keyclub')?.id).toBe('key-club')
    expect(programmeOfRankTrack('keyclub')?.name).toBe(programmeById('key-club')!.name)
    expect(programmeById('keyclub')).toBeUndefined()
  })
})

describe('the year model keys completion on the programme (the fatal break)', () => {
  it('finishing football does NOT finish the other two programmes at the stadium', async () => {
    vi.resetModules()
    const save = await import('../save')
    const { yearStatus } = await import('../run/year')

    save.beginAdventure()
    save.writeSave({ introDone: true })
    save.assignSlot(1, 'Fall', 'football')
    save.assignSlot(1, 'Winter', 'girls-flag-football')
    save.assignSlot(1, 'Spring', 'track-field')
    save.pickClass(1, 'ap-human-geo'); save.pickClass(1, 'spanish-1')
    save.stampPlan(1, ['football', 'girls-flag-football', 'track-field'])

    save.setIslandState('football', 'completed')

    const st = yearStatus(save.loadSave()!)
    const done = Object.fromEntries(st.voyages.map((v) => [v.programmeId, v.done]))
    expect(done).toEqual({ football: true, 'girls-flag-football': false, 'track-field': false })
    // All three are at the same place, and completion is counted per programme, not per place.
    expect(new Set(st.voyages.map((v) => v.placeId))).toEqual(new Set(['stadium']))
  })

  it('refuses a fall sport a winter token, out of the one season vocabulary', () => {
    const football = programmeById('football')!
    expect(programmeAllowedIn(football, 'Winter')).toBe(false)
    expect(programmeAllowedIn(programmeById('girls-flag-football')!, 'Winter')).toBe(true)
  })
})

describe('a place says WHAT it is and never WHERE it is', () => {
  it('carries no position, because the composition owns that and only one of them is authored', () => {
    // A place has no coordinates of its own, because the world layout owns those.
    for (const p of PLACES) expect(p).not.toHaveProperty('at')
    const fields = new Set(PLACES.flatMap((p) => Object.keys(p)))
    for (const banned of ['at', 'x', 'y', 'position', 'footprint', 'berth'])
      expect(fields.has(banned)).toBe(false)
  })
})

describe('every entry says where it came from', () => {
  it('carries a source on every place and every programme', () => {
    for (const p of PLACES) expect(p.source.length).toBeGreaterThan(0)
    for (const g of PROGRAMMES) expect(g.source.length).toBeGreaterThan(0)
  })
  it('leaves a room number absent rather than inventing one for ATC', () => {
    // Check the sourced table, because the shipped table removes the room number along with the
    // real name.
    expect(SOURCED_PLACES.find((p) => p.id === 'atc-room')!.room).toBeUndefined()
    expect(SOURCED_PLACES.find((p) => p.id === 'flex-200')!.room).toBe('200 Flex')
  })

  /* The placeholder names themselves. */
  it('prints no real club or sport name while nothing has an island behind it', () => {
    // Check the shipped table, because every screen reads from it.
    for (const g of PROGRAMMES) {
      if (g.playable) continue
      expect(g.name, `${g.id} is a placeholder and still prints a name`).toMatch(/^Example [A-Z]+$/)
      expect(g.host, `${g.id} is a placeholder and still names a person`).toBeUndefined()
      expect(g.blurb).toBe(EXAMPLE_BLURB)
    }
    for (const p of PLACES) {
      if (p.maps.length || PROGRAMMES.some((g) => g.place === p.id && g.playable)) continue
      expect(p.name, `${p.id} is a place nobody can go to and still prints a name`)
        .toMatch(/^Example place [A-Z]+$/)
      expect(p.room).toBeUndefined()
    }
  })

  it('keeps the wiring under the mask, so a real island needs no other edit', () => {
    /* The id, place, kind, season, tags and rank track stay the same under the placeholder. One
     * member-islands row is all it takes to make the programme real. */
    const kc = programmeById('key-club')!
    const src = SOURCED_PROGRAMMES.find((p) => p.id === 'key-club')!
    expect(kc.place).toBe(src.place)
    expect(kc.kind).toBe(src.kind)
    expect(kc.tags).toEqual(src.tags)
    expect(kc.rankTrack).toBe(src.rankTrack)
    expect(seasonOf(programmeById('football')!)).toBe('Fall')
  })
})
