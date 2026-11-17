/* The six badges. Most of them are worked out from the run instead of being handed out by an event. */
import { FACTS } from './facts'
import type { SaveGame } from './save'
import { ranksOf, rankName } from './progress'
import { PROGRAMMES, rankTrackOf } from './roster/roster'

export type BadgeId = 'resident' | 'cartographer' | 'early-bird' | 'renaissance' | 'loyal' | 'bookworm'

/** How many true facts about Bonney Lake there are to collect in total. */
export const FACT_POOL = FACTS.length

export type BadgeRow = {
  id: BadgeId
  name: string
  /** What it takes to earn it, in the words a student reads. */
  how: string
  earned: boolean
  /** Where the badge comes from. This decides what the card says before it's earned. */
  from: 'run' | 'world'
  /** Live progress for badges that count something. Otherwise undefined. */
  detail?: string
}

/* The list of islands comes from the world, not the save. An island the student can't reach yet
 * doesn't count against them, so the total matches what the chart shows. */
function visitedEvery(s: SaveGame, isles: string[]): { done: boolean; detail: string } {
  const seen = new Set((s.exposure ?? []).map((e) => e.place))
  const found = isles.filter((i) => seen.has(i)).length
  return { done: isles.length > 0 && found >= isles.length, detail: `${found} of ${isles.length} islands seen` }
}

/** Every category the roster offers. That's what "every category" means here. */
const CATEGORIES = [...new Set(PROGRAMMES.map((p) => p.kind))]

function everyCategory(s: SaveGame): { done: boolean; detail: string } {
  const spent = new Set<string>()
  for (const plan of Object.values(s.plans ?? {})) {
    for (const id of Object.values(plan.slots ?? {})) {
      const p = PROGRAMMES.find((q) => q.id === id)
      if (p) spent.add(p.kind)
    }
  }
  const n = CATEGORIES.filter((c) => spent.has(c)).length
  return { done: n >= CATEGORIES.length, detail: `${n} of ${CATEGORIES.length} kinds of activity` }
}

function anyCaptain(s: SaveGame): { done: boolean; detail: string } {
  const ladders = ranksOf(s)
  let best = 0
  for (const years of Object.values(ladders)) best = Math.max(best, years)
  /* `rankName` gives back null below JV, which means the run hasn't stuck with anything yet. Don't
   * print it as a string. */
  const named = rankName(best)
  return { done: named === 'Captain', detail: named ?? 'No rank yet' }
}

/** Every badge, with what it takes to earn it and whether this run has earned it. */
export function badgesOf(s: SaveGame | null, isles: string[] = []): BadgeRow[] {
  const has = (id: string) => !!s?.badges?.includes(id)
  const facts = s?.facts.length ?? 0
  const carto = s ? visitedEvery(s, isles) : { done: false, detail: '' }
  const ren = s ? everyCategory(s) : { done: false, detail: '' }
  const cap = s ? anyCaptain(s) : { done: false, detail: '' }
  return [
    {
      id: 'resident', name: 'Orca Spotter', from: 'world',
      how: 'Spot the orca on open water.',
      earned: has('resident'),
    },
    {
      id: 'cartographer', name: 'Island Finder', from: 'run',
      how: 'See every island on the chart.',
      earned: has('cartographer') || carto.done,
      detail: carto.detail,
    },
    {
      id: 'early-bird', name: 'Early Bird', from: 'world',
      how: 'Finish a year with time to spare.',
      earned: has('early-bird'),
    },
    {
      id: 'renaissance', name: 'All-Around Panther', from: 'run',
      how: 'Spend a season on a sport and a season in a club.',
      earned: has('renaissance') || ren.done,
      detail: ren.detail,
    },
    {
      id: 'loyal', name: 'Loyal', from: 'run',
      how: `Reach ${rankName(3) ?? 'Captain'} in any sport or club.`,
      earned: has('loyal') || cap.done,
      detail: cap.detail,
    },
    {
      id: 'bookworm', name: 'Bookworm', from: 'run',
      /* Read the goal count from the fact list. Never type a number here, or the badge can ask for
       * more facts than the game has. */
      how: `Collect all ${FACT_POOL} school facts.`,
      earned: has('bookworm') || facts >= FACT_POOL,
      detail: `${facts} of ${FACT_POOL} facts`,
    },
  ]
}

/** The one badge a save can earn by itself while the player reads the Handbook. */
export const bookwormThreshold = FACT_POOL

/* Checks whether a track is real. It sits next to the ladder it reads, so an island added later
 * can't quietly drop out of every track. */
export const trackOf = rankTrackOf
