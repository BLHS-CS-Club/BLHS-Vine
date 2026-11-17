// Scoring a beat, and the retake rule: under a B- the student can retake once.

import type { SaveGame } from '../save'
import { checksOf, type CoreBeat } from './frames'
/* Each kind of check declares its own points in the palette. Using pointsOf here means the
 * transcript total and the total the runner scores against are always the same number. */
import { pointsOf } from './palette'
import { retakeKind } from './state'

/** Points earned and points possible for a beat. The runner adds to them as the student answers. */
export type BeatScore = { earned: number; total: number }

export const emptyScore = (beat: CoreBeat): BeatScore => ({
  earned: 0,
  total: checksOf(beat).reduce((n, c) => n + pointsOf(c), 0),
})

/** The grade on the 0 to 4.0 scale, rounded to 2 decimal places like everything on the transcript. */
export const gradeOf = (s: BeatScore): number =>
  s.total === 0 ? 4 : Math.round((s.earned / s.total) * 4 * 100) / 100

/**
 * B- on the scale that letterOf in progress.ts prints, where B- starts at 2.5. Keep the two
 * matching, or a 2.6 prints as a B- above a line saying the student scored under a B-. This is the
 * game's rule for offering a retake, separate from the school's under 79 percent rule, and nothing
 * in the year waits on a retake being taken.
 */
export const RETAKE_BELOW = 2.5

/* The real rule lives in state.ts, which treats a failed beat and a near miss as different retake
 * offers. This wrapper stays because a lot of code calls it. */
export function retakeAvailable(save: SaveGame, beatId: string): boolean {
  return retakeKind(save, beatId) !== 'none'
}
