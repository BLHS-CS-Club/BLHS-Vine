// The roster: every place, programme and map in the world, and the ids used to look each one up.
import type { Season } from '../save'
import { MEMBER_ISLANDS } from './member-islands'
import { EXAMPLE_BLURB, EXAMPLE_SOURCE, exampleLabel, examplePlace } from './example'

export type MapId = string
export type PlaceId = string
export type ProgrammeId = string

/** The season each school sport runs in. Every screen gets sport seasons from here. */
export const SPORT_SEASONS: Record<string, Season> = {
  // fall
  'cross-country': 'Fall', football: 'Fall', 'girls-golf': 'Fall', 'girls-soccer': 'Fall',
  'girls-swim-dive': 'Fall', 'boys-tennis': 'Fall', volleyball: 'Fall',
  // winter
  'boys-basketball': 'Winter', 'girls-basketball': 'Winter', gymnastics: 'Winter',
  'girls-bowling': 'Winter', 'boys-swim-dive': 'Winter', wrestling: 'Winter',
  'girls-flag-football': 'Winter',
  // spring
  baseball: 'Spring', 'boys-golf': 'Spring', 'boys-lacrosse': 'Spring',
  'girls-lacrosse': 'Spring', 'boys-soccer': 'Spring', softball: 'Spring',
  'girls-tennis': 'Spring', 'track-field': 'Spring',
}

/* ---- a place ------------------------------------------------------------- */

export type Place = {
  id: PlaceId
  /** The real place's name, as the player sees it. */
  name: string
  // The maps this place is made of, from one to four. An empty list means nobody has painted it
  // yet.
  maps: MapId[]
  /** Which of its maps the ship arrives at. Left out while the place has no maps. */
  arrival?: MapId

  // A place has no position here. The roster says what exists and the world layout says where it
  // is. `paintings` is how many maps this place is allowed, not how many it has.
  paintings: number
  /* A description of which real place this is and what a student should recognize there. Leave it
   * out when nobody has written one. Never guess it. */
  recognise?: string
  /** Where it really is in the building, when a source says so. Never made up. */
  room?: string

  // Which class departments are taught here, so a class scene can name a real room.
  teaches?: string[]

  /** Where the two fields above came from. */
  source: string
}

/* ---- a programme --------------------------------------------------------- */

export type Programme = {
  id: ProgrammeId
  name: string
  /** The place where this happens. Each place's list of programmes is built from this field. */
  place: PlaceId
  kind: 'sport' | 'club'
  /** Clubs can run in any season. A sport's season comes from SPORT_SEASONS, looked up by id. */
  season?: Season
  /** Tags that count toward graduation cords. They use the same words classes use. */
  tags: string[]
  /* The programme's own rank ladder, left out when it has none. There's one track per programme,
   * not one per place, and that's a choice that could still change. */
  rankTrack?: string
  // Whether this programme has a playable island behind it.
  playable: boolean
  /** One line saying what it is, taken from a source. */
  blurb: string
  /** Who runs it, when a source names them. Never made up. */
  host?: string
  /** Where the blurb and the host came from. */
  source: string
}

/* ---- the registry: a list of places -------------------------------------- */

const SPORTS_SRC = 'blhs.sumnersd.org/athletics/our-sports, 2025-26'
const CLUBS_SRC = 'blhs.sumnersd.org/activities/clubs-activities/blhs-clubs, 2025-26'

/**
 * The real place names, before the placeholder names below are put on top. Screens read PLACES, not
 * this.
 */
export const SOURCED_PLACES: Place[] = [
  {
    // The home base. It's one place made of two maps with a door between them.
    id: 'home-island',
    // This place is the school itself, so it uses the school's name.
    name: 'Bonney Lake High School',
    maps: ['hub', 'panther-maw'],
    arrival: 'hub',
    paintings: 2,
    recognise: 'You land at the harbor. The school is inside the mountain.',
    source: 'the game\'s own home base; not a claim about a real BLHS location',
  },
  {
    /* A shared space: three programmes in three seasons with three coaches, all on one field. */
    id: 'stadium',
    name: 'the stadium',
    maps: [],
    paintings: 0,
    source: SPORTS_SRC,
  },
  {
    /* The other shared space in the sources. Key Club meets here on Tuesdays and DECA on Thursdays,
     * but only Key Club is on the roster right now. */
    id: 'flex-200',
    name: '200 Flex',
    maps: [],
    paintings: 0,
    room: '200 Flex',
    source: CLUBS_SRC,
  },
  {
    /* No room is listed for the CS Club, so none is made up. The club is real and student founded,
     * but the school's official clubs page doesn't list it yet. */
    id: 'atc-room',
    name: 'the CS Club',
    /* `maps` stays empty and `arrival` is left out on purpose. `MEMBER_MAPS` groups member rows by
     * place, and `PLACES` adds their map as the arrival. If this place listed a member's map id by
     * hand, the engine would need editing every time somebody publishes an island. */
    maps: [],
    paintings: 1,
    source: 'student-founded Sep 2025; not yet on the official clubs list',
  },
]

/* The programmes the engine itself knows about, written by hand from sources. The club's own
 * islands get added below from a data file, so members never have to edit this array, which is
 * engine code. */
const OURS: Programme[] = [
  /* The club's islands live in `member-islands.json`, not here. Never give two rows the same id:
   * `programmeIndex` is a Map and keeps the last one, but `islandForProgramme` uses `.find` and
   * keeps the first. A programme could then be playable and unreachable at once, and `rosterFaults`
   * doesn't check for this. */
  {
    id: 'football', name: 'Football', place: 'stadium', kind: 'sport',
    tags: [], rankTrack: 'football', playable: false,
    // The blurb names the season, because the card a student reads doesn't show the season anywhere
    // else.
    blurb: 'Varsity, JV and Freshmen. Coach Bruce. No tryouts, it runs in fall, and Fridays get loud.',
    host: 'Ashton Bruce', source: SPORTS_SRC,
  },
  {
    id: 'girls-flag-football', name: 'Girls Flag Football', place: 'stadium', kind: 'sport',
    tags: [], rankTrack: 'girls-flag-football', playable: false,
    blurb: 'Varsity, JV and C. Coach Jarvis. No-cut, and it runs in winter.',
    host: 'Eric Jarvis', source: SPORTS_SRC,
  },
  {
    id: 'track-field', name: 'Track and Field', place: 'stadium', kind: 'sport',
    tags: [], rankTrack: 'track-field', playable: false,
    blurb: 'Varsity and JV, co-ed. Coach Wilson. No-cut, and it runs in spring.',
    host: 'Brooke Wilson', source: SPORTS_SRC,
  },
  {
    id: 'key-club', name: 'Key Club', place: 'flex-200', kind: 'club',
    tags: ['key-club'], rankTrack: 'keyclub', playable: false,
    blurb: 'Student-led service. Tuesdays 2:10, 200 Flex, with Ms. Berwick.',
    host: 'Ellen Berwick', source: CLUBS_SRC,
  },
]

// Member islands get added from a data file after the hand-written ones, so a member row can't
// replace a sourced one.
/** The real programmes, before the placeholder names are put on top. See `SOURCED_PLACES`. */
export const SOURCED_PROGRAMMES: Programme[] = [
  ...OURS,
  ...MEMBER_ISLANDS.map((i): Programme => ({
    id: i.programme,
    name: i.name,
    place: i.place,
    kind: i.kind,
    ...(i.season ? { season: i.season } : {}),
    tags: i.tags,
    ...(i.rankTrack ? { rankTrack: i.rankTrack } : {}),
    playable: i.playable,
    blurb: i.blurb,
    ...(i.host ? { host: i.host } : {}),
    source: i.source,
  })),
]

/**
 * The programmes as a student sees them. Anything that isn't playable gets a placeholder name like
 * Example A.
 */
export const PROGRAMMES: Programme[] = (() => {
  let n = 0
  return SOURCED_PROGRAMMES.map((p) => p.playable ? p : {
    ...p,
    name: exampleLabel(n++),
    blurb: EXAMPLE_BLURB,
    host: undefined,
    source: EXAMPLE_SOURCE,
  })
})()

/* Adds the maps from member rows onto the hand-written `SOURCED_PLACES`, so `islandForProgramme`
 * can find them. A member still can't make up a new place. Naming one that doesn't exist gets
 * reported as a fault. */
const MEMBER_MAPS = (() => {
  const out = new Map<string, string[]>()
  for (const i of MEMBER_ISLANDS) {
    if (!i.map || !i.place) continue
    out.set(i.place, [...(out.get(i.place) ?? []), i.map])
  }
  return out
})()

/**
 * The places as a student sees them. A place with no map and nothing playable gets a placeholder
 * name.
 */
export const PLACES: Place[] = (() => {
  const real = new Set(PROGRAMMES.filter((p) => p.playable).map((p) => p.place))
  let n = 0
  return SOURCED_PLACES.map((p0) => {
    const added = (MEMBER_MAPS.get(p0.id) ?? []).filter((m) => !p0.maps.includes(m))
    /* The arrival is the place's own, if it has one. Otherwise it's the first map anybody published
     * for it. */
    const p = added.length
      ? { ...p0, maps: [...p0.maps, ...added], arrival: p0.arrival ?? [...p0.maps, ...added][0] }
      : p0
    return (p.maps.length || real.has(p.id)) ? p : {
    ...p,
      name: examplePlace(n++),
      recognise: undefined,
      room: undefined,
      source: EXAMPLE_SOURCE,
    }
  })
})()

// These lookups are built once when the file loads, because the objective arrow calls them every
// frame.

const placeIndex = new Map<PlaceId, Place>(PLACES.map((p) => [p.id, p]))
const programmeIndex = new Map<ProgrammeId, Programme>(PROGRAMMES.map((p) => [p.id, p]))
const mapIndex = new Map<MapId, Place>()
for (const p of PLACES) for (const m of p.maps) if (!mapIndex.has(m)) mapIndex.set(m, p)

export const placeById = (id: PlaceId | undefined): Place | undefined =>
  id ? placeIndex.get(id) : undefined

export const programmeById = (id: ProgrammeId | undefined): Programme | undefined =>
  id ? programmeIndex.get(id) : undefined

/** The place a map belongs to. Each map belongs to exactly one place. */
export const placeOfMap = (mapId: MapId | undefined): Place | undefined =>
  mapId ? mapIndex.get(mapId) : undefined

// Which place teaches a department. undefined is a normal answer here, and every caller has to
// handle it.
const deptIndex = new Map<string, Place>()
for (const p of PLACES) for (const d of p.teaches ?? []) if (!deptIndex.has(d)) deptIndex.set(d, p)

/* The optional places argument works like the one on `rosterFaults`. No place on the real roster
 * teaches a department yet, so tests need to pass their own places to check the lookup works. */
export const placeOfDept = (dept: string | undefined, places?: readonly Place[]): Place | undefined => {
  if (!dept) return undefined
  if (!places) return deptIndex.get(dept)
  return places.find((p) => (p.teaches ?? []).includes(dept))
}

/** The place a programme happens at, found through the programme's own place field. */
export const placeOfProgramme = (id: ProgrammeId | undefined): Place | undefined =>
  placeById(programmeById(id)?.place)

/* Every programme at one place. The board at the shore needs this to say things like which sport
 * there is in season and which isn't. */
export const programmesAt = (placeId: PlaceId | undefined): Programme[] =>
  placeId ? PROGRAMMES.filter((p) => p.place === placeId) : []

/* Each pick gets one button, and the roster decides whether it plays a short scene or sails to an
 * island. A class only has an island if a playable programme has the same course id and its place
 * has a map. Right now no class does, so every class is a short scene. */
export function islandForClass(classId: string): { programme: Programme; map: string } | null {
  return islandForProgramme(classId)
}

/* Finding the island for a club and for a class is the same lookup. `islandForClass` is this
 * function with the course id passed in, and it stays because a lot of code calls it. */
export function islandForProgramme(id: string | undefined): { programme: Programme; map: string } | null {
  const g = PROGRAMMES.find((p) => p.id === id)
  if (!g?.playable) return null
  const place = PLACES.find((pl) => pl.id === g.place)
  const map = place?.arrival ?? place?.maps[0]
  return map ? { programme: g, map } : null
}

export function seasonOf(p: Programme): Season | undefined {
  return p.kind === 'sport' ? (p.season ?? SPORT_SEASONS[p.id]) : undefined
}

/* The season lock. A sport can only be picked in its own season, so the student learns that rule by
 * playing before anyone explains it. */
export function programmeAllowedIn(p: Programme, season: Season): boolean {
  const s = seasonOf(p)
  return s === undefined || s === season
}

/** True when this programme's island can really be played right now. */
export const isPlayable = (id: ProgrammeId | undefined): boolean =>
  !!programmeById(id)?.playable

/** The rank ladder this programme climbs, or null when it has none. */
export const rankTrackOf = (id: ProgrammeId | undefined): string | null =>
  programmeById(id)?.rankTrack ?? null

// The reverse lookup, from rank track to programme. Rank track names are their own set of ids, so
// look them up here instead of guessing the programme id from them.
const trackIndex = new Map<string, Programme>()
for (const p of PROGRAMMES) if (p.rankTrack && !trackIndex.has(p.rankTrack)) trackIndex.set(p.rankTrack, p)

export const programmeOfRankTrack = (track: string | undefined): Programme | undefined =>
  track ? trackIndex.get(track) : undefined

// A problem found in a roster entry. These are checked up front, not while the game is drawing.
export type RosterFault = { key: string; why: string }

/* Prints every roster fault to the console. Faults are reported and never thrown, because one bad
 * row must not crash the game. */
function sayRosterFaults() {
  for (const f of rosterFaults()) {
    console.error(`[roster] ${f.key}: ${f.why}`)
  }
}

export function rosterFaults(places = PLACES, programmes = PROGRAMMES): RosterFault[] {
  const out: RosterFault[] = []
  const seenMap = new Map<MapId, PlaceId>()
  const seenDept = new Map<string, PlaceId>()
  for (const p of places) {
    // A department is taught in exactly one place, so two places claiming it is a fault.
    for (const d of p.teaches ?? []) {
      const owner = seenDept.get(d)
      if (owner) out.push({ key: d, why: `department is taught at both "${owner}" and "${p.id}"` })
      else seenDept.set(d, p.id)
    }
    if (p.arrival && !p.maps.includes(p.arrival))
      out.push({ key: p.id, why: `arrival map "${p.arrival}" is not one of this place's maps` })
    if (!p.arrival && p.maps.length)
      out.push({ key: p.id, why: 'has maps but names none of them as the arrival' })
    if (p.maps.length > p.paintings)
      out.push({ key: p.id, why: `carries ${p.maps.length} maps against ${p.paintings} authorised paintings` })
    for (const m of p.maps) {
      const owner = seenMap.get(m)
      if (owner) out.push({ key: m, why: `map is claimed by both "${owner}" and "${p.id}"` })
      else seenMap.set(m, p.id)
    }
  }
  const placeIds = new Set(places.map((p) => p.id))
  for (const g of programmes) {
    if (!placeIds.has(g.place)) out.push({ key: g.id, why: `names place "${g.place}", which is not on the roster` })
    if (g.kind === 'sport' && seasonOf(g) === undefined)
      out.push({ key: g.id, why: 'is a sport with no season in the vocabulary' })
    /* Programme ids, place ids and map ids must never share a string. The types don't stop it, so
     * this check does. */
    if (placeIds.has(g.id)) out.push({ key: g.id, why: 'is both a programme id and a place id' })
    if (seenMap.has(g.id)) out.push({ key: g.id, why: 'is both a programme id and a map id' })
  }
  return out
}

/* Check the roster when this file loads, so a bad row shows up before anybody plays it. */
sayRosterFaults()
