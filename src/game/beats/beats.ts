// The list of core beats, one per year. Ask for one with coreBeatFor.

import type { SaveGame } from '../save'
import type { CoreBeat } from './frames'
import { CORE_Y1 } from './y1'
import { CORE_Y2 } from './y2'
import { CORE_Y3 } from './y3'
import { coreY4 } from './y4'
import { beatPassed } from './state'

export const coreBeatId = (year: number) => `core:y${year}`

/** All four years have a required beat. */
export const hasCoreBeat = (year: number) => year >= 1 && year <= 4

/** Gets the year's beat. Years 1 to 3 are fixed, and year 4 is built from the save. */
export function coreBeatFor(year: number, save: SaveGame): CoreBeat | null {
  if (year === 1) return CORE_Y1
  if (year === 2) return CORE_Y2
  if (year === 3) return CORE_Y3
  if (year === 4) return coreY4(save)
  return null
}

/** True if the student has sat this year's required beat, whether they passed or not. */
export const beatDone = (ledger: { id: string }[], year: number): boolean =>
  hasCoreBeat(year) && ledger.some((e) => e.id === coreBeatId(year))

/* A year only counts as finished if its beat was passed. Use this instead of beatDone for any gate,
 * because beatDone also counts a student who failed. */
export const beatPassedIn = (s: SaveGame | null, year: number): boolean =>
  hasCoreBeat(year) && beatPassed(s, coreBeatId(year))

// For code that only needs years 1 to 3 and no save, like tests and tooling.
export const CORE_BEATS: Record<number, CoreBeat> = { 1: CORE_Y1, 2: CORE_Y2, 3: CORE_Y3 }
