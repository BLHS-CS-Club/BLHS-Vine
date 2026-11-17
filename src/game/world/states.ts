/* Works out which of the seven island states each island is in for one student, by combining the
 * world as it was built with that student's save. */
import { completedIn, type SaveGame, type Season } from '../save'
import { programmesAt, programmeAllowedIn, seasonOf, type Programme } from '../roster/roster'
import { distanceTo, type SlotState, type WorldPt, type WorldSlot } from './composition'

/* True if a token the student still holds would be accepted by this programme this year. */
export function affordable(p: Programme, s: SaveGame): boolean {
  if (!p.playable) return false
  /* Finishing a programme closes it for this year only, not the whole run. A rank ladder is the
   * same programme placed three years in a row, so finishing it in year 1 must not remove it from
   * year 2. */
  if (completedIn(s, p.id, s.year)) return false
  return s.tokens.some((t) => programmeAllowedIn(p, t))
}

/** What the student sees this slot as right now. */
export function stateOf(slot: WorldSlot, s: SaveGame | null): SlotState {
  /* The world's own states come first. A slot with no map is always a `rumour`, because there's
   * nothing there to have done. `rising` is set by the world, not by the student. */
  if (!slot.map) return 'rumour'
  if (slot.state === 'rising') return 'rising'
  if (!s) return 'misty'

  const here = programmesAt(slot.place)

  /* A club the student signed up for shouldn't show up as somewhere they've never heard of. So a
   * slot with a programme the student planned, started or finished counts as known. Islands they
   * haven't picked still stay misty until they sail near them. */
  const known = here.some((p) => (s.islands ?? {})[p.id]
    || (s.completions ?? []).some((c) => c.programme === p.id)
    || Object.values(s.plans?.[s.year]?.slots ?? {}).includes(p.id))
  /* Being seen belongs to a place, and that's what the exposure record tracks. That way discovery
   * fires once when the student sails past a stadium, not three times. */
  const seen = (s.exposure ?? []).some((e) => e.place === slot.place)
  if (!seen && !known) return 'misty'

  if (!here.length) return 'discovered'

  /* Completion comes from the append-only completions record, per programme per year. That way a
   * ladder that places the same programme three years in a row doesn't have to erase its history to
   * know what color it should be. */
  const done = here.filter((p) => (s.completions ?? []).some((c) => c.programme === p.id))
  if (done.length === here.length) return 'completed'
  if (here.some((p) => s.islands[p.id] === 'active')) return 'active'
  /* Available means a token the student still holds would be accepted here. That's about the year,
   * not today: the Fall token buys a fall sport whenever it's spent. */
  if (here.some((p) => affordable(p, s))) return 'available'
  return 'discovered'
}

/* A season name in lower case, for the sentence a place shows when it's out of season. */
const lower = (x: Season): string => x.toLowerCase()

/* A place is resting only when it has seasons and none of them is the season the run is in now. */
function restingIn(slot: WorldSlot, s: SaveGame): Programme | null {
  const locked = programmesAt(slot.place).filter((p) => !!seasonOf(p))
  if (!locked.length) return null
  if (locked.some((p) => seasonOf(p) === s.season)) return null
  return locked[0]
}

/**
 * Finds a programme at this place that's out of reach this year because its season token is already
 * spent.
 */
function tokenSpent(slot: WorldSlot, s: SaveGame): Programme | null {
  for (const p of programmesAt(slot.place)) {
    if (!p.playable || affordable(p, s)) continue
    if (completedIn(s, p.id, s.year)) continue
    if (seasonOf(p)) return p
  }
  return null
}

/**
 * The season this place runs in. If it has more than one, prefer the one the run is in now, so a
 * shared field that's used all year shows as open.
 */
export function seasonAt(slot: WorldSlot, now?: Season | null): Season | null {
  const locked = programmesAt(slot.place)
    .map((p) => seasonOf(p))
    .filter((x): x is Season => !!x)
  if (!locked.length) return null
  if (now && locked.includes(now)) return now
  return locked[0]
}

/** The sentence the chart writes next to a slot, worded to fit that state. */
export function stateLine(st: SlotState, slot: WorldSlot, s: SaveGame | null): string {
  switch (st) {
    case 'rumour': return 'It will be something Bonney Lake really offers.'
    case 'rising': return 'Opening now.'
    case 'misty': return 'Sail closer to see what this is.'
    case 'discovered': {
      if (!s) return 'You have sailed past here.'
      /* The out-of-season sentence. It's only for a place where nothing runs right now. */
      const shut = restingIn(slot, s)
      if (shut) {
        const own = seasonOf(shut)!
        return `${shut.name} is a ${lower(own)} sport. Come back in ${lower(own)}.`
      }
      const spent = tokenSpent(slot, s)
      if (spent) return `Your ${lower(seasonOf(spent)!)} season token is spent. ${spent.name} stays closed this year.`
      const here = programmesAt(slot.place)
      if (here.length && !here.some((p) => p.playable)) return 'Not open yet.'
      const ashore = (s.exposure ?? []).some((e) => e.place === slot.place && e.docked)
      return ashore ? 'You have been here.' : 'You have sailed past here.'
    }
    case 'available': {
      const open = s ? programmesAt(slot.place).filter((p) => affordable(p, s)) : []
      const locked = open.map((p) => seasonOf(p)).find((x): x is Season => !!x)
      return locked ? `You can sign up here with your ${lower(locked)} season token.` : 'You can sign up here with any season token.'
    }
    case 'active': return 'You started it.'
    case 'completed': return 'You finished everything here.'
  }
}

/* The dock: six markers in a fixed order. The state decides which of them are showing. */
export type DockObject = 'pin' | 'pip' | 'open' | 'flag' | 'stamp' | 'ashore'

/** The order the six markers stand in, left to right, on every island in the game. */
export const DOCK_ORDER: DockObject[] = ['pin', 'pip', 'open', 'flag', 'stamp', 'ashore']

export type DockDrawn = {
  kind: DockObject | 'fog' | 'pencil' | 'rising'
  /** The art piece and face to show when the art kit is in use, or null when nobody has drawn one. */
  face: [piece: string, face: string] | null
  /** The CSS class of the stand-in token drawing. That's what the game uses right now. */
  shape: string
  /** What the marker means, in words, for screen readers and for the list under the chart. */
  word: string
  /** Whether the marker is showing at all. */
  on: boolean
}

export type Dock = {
  state: SlotState
  /** Always all six markers, each one on or off. */
  slots: DockDrawn[]
  /* What shows instead of a dock. A misty place hasn't been found, a `rumour` has nothing built
   * yet, and a rising island is still appearing, so each of those gets one marker and no row. */
  instead: DockDrawn | null
  /** How much fog is left over a misty slot, from 3 (far away) to 0 (nearly clear). */
  fog: 0 | 1 | 2 | 3
  /** The season this place runs in, if it has one. */
  season: Season | null
  /** Whether that season is the one the run is in right now. */
  inSeason: boolean
  /** The school's own sentence about a closed season. It's never an error message. */
  closed: string | null
  /** Whether the student has gotten off the ship here. */
  ashore: boolean
  /** Whether the chart is allowed to show this place's name yet. */
  named: boolean
}

/* How much fog is left, in four steps, based on how far the slot is from where the ship last
 * docked. */
function fogAt(slot: WorldSlot, from: WorldPt | null): 0 | 1 | 2 | 3 {
  if (!from) return 3
  const reach = Math.max(1, slot.discover ?? slot.release / 2)
  const k = Math.max(0, distanceTo(slot, from)) / (reach * 3)
  return k >= 1 ? 3 : k >= 0.55 ? 2 : k >= 0.25 ? 1 : 0
}

const mark = (
  kind: DockDrawn['kind'], face: DockDrawn['face'], shape: string, word: string, on: boolean,
): DockDrawn => ({ kind, face, shape, word, on })

/** Everything the chart draws for one slot, worked out from the save and nothing else. */
export function dockOf(slot: WorldSlot, s: SaveGame | null, from: WorldPt | null = null): Dock {
  const st = stateOf(slot, s)
  const season = seasonAt(slot, s?.season ?? null)
  const inSeason = !!season && !!s && season === s.season
  const ashore = !!s && (s.exposure ?? []).some((e) => e.place === slot.place && e.docked)
  const shut = s ? restingIn(slot, s) : null
  const closed = shut
    ? `${shut.name} is a ${lower(seasonOf(shut)!)} sport. Come back in ${lower(seasonOf(shut)!)}.`
    : null

  const bare = (instead: DockDrawn | null, fog: 0 | 1 | 2 | 3 = 0): Dock => ({
    state: st, slots: [], instead, fog, season, inSeason, closed, ashore, named: false,
  })

  if (st === 'misty') {
    return bare(mark('fog', null, 'ch-s-fog', 'You have not found this place yet.', true), fogAt(slot, from))
  }
  if (st === 'rumour') {
    return bare(mark('pencil', null, 'ch-s-pencil', 'Nobody has built this place yet.', true))
  }
  if (st === 'rising') {
    /* Show the name, because the point of this moment is the student watching a place they'd only
     * heard about get a name. */
    const d = bare(mark('rising', null, 'ch-s-rising', 'This place is opening now.', true))
    return { ...d, named: true }
  }

  /* The season coin. It shows its own season when that season is now, and a ghost when it isn't. */
  const pipFace: [string, string] | null = season
    ? ['pip', inSeason ? lower(season) : 'ghost']
    : null

  const standing: Record<DockObject, DockDrawn> = {
    pin: mark('pin', ['pointer', 'pin_tail'], 'ch-s-pin', 'A real place you have seen.', true),
    pip: mark('pip', pipFace, inSeason ? 'ch-s-pip' : 'ch-s-pip-shut',
      season
        ? (inSeason
          ? `Something here runs in ${lower(season)}, and it is ${lower(season)} now.`
          : `Something here runs in ${lower(season)}, and it is not ${lower(season)} now.`)
        : 'Nothing here is locked to one season.',
      !!season),
    open: mark('open', ['icon_set', 'star'], 'ch-s-star', 'You can sign up here.', st === 'available'),
    flag: mark('flag', null, 'ch-s-flag', 'You started something here.', st === 'active'),
    stamp: mark('stamp', ['stamp', 'approved'], 'ch-s-stamp', 'You finished everything here.', st === 'completed'),
    ashore: mark('ashore', ['icon_set', 'tick'], 'ch-s-tick', 'You have been here.', ashore),
  }

  /* The row is built from DOCK_ORDER, so each marker stands in the same spot on every island. */
  return {
    state: st,
    slots: DOCK_ORDER.map((k) => standing[k]),
    instead: null, fog: 0, season, inSeason, closed, ashore, named: true,
  }
}

/* For each state: the tint, the word in brackets and how dim the label is when it's drawn on the
 * water. */
export const STATE_INK: Record<SlotState, { tint: number; mark: string; dim: number }> = {
  rumour: { tint: 0x8a7a60, mark: '(not built yet)', dim: 0.35 },
  rising: { tint: 0xffd98a, mark: '(opening now)', dim: 1 },
  misty: { tint: 0x6d7f86, mark: '(you have not been here)', dim: 0.45 },
  discovered: { tint: 0xcbbb95, mark: '(you have been past)', dim: 0.8 },
  available: { tint: 0xe6d6a8, mark: '(you can sign up here)', dim: 1 },
  active: { tint: 0xffc861, mark: '(you started this)', dim: 1 },
  completed: { tint: 0x7fd0a6, mark: '(you finished this)', dim: 1 },
}
