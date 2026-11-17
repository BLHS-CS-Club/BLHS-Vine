/* The three states a scored thing can be in. This file is the only place that decides which one
 * it's in. */

import type { LedgerEntry, SaveGame } from '../save'
import { PASSING_GRADE } from '../progress'
import { RETAKE_BELOW } from './score'

/* A scored thing is untried, failed or passed. Every screen gets that answer from beatState, so the
 * year gate and the trophy wall always agree. */

export type BeatState = 'untried' | 'failed' | 'passed'

/** The ledger row for this scored thing, or undefined if it has never been sat. */
export const rowOf = (s: SaveGame | null, id: string): LedgerEntry | undefined =>
  s?.ledger.find((e) => e.id === id)

/**
 * What the ledger says about one scored thing. The id already carries its year (like core:y2 or
 * class:spanish-1), so don't filter by year here.
 */
export function beatState(s: SaveGame | null, id: string): BeatState {
  const row = rowOf(s, id)
  if (!row) return 'untried'
  return row.grade >= PASSING_GRADE ? 'passed' : 'failed'
}

/** True if it was passed. Every gate on the year should use this. */
export const beatPassed = (s: SaveGame | null, id: string): boolean =>
  beatState(s, id) === 'passed'

/** True if it has been sat at least once, passed or failed. The trophy wall's frame uses this. */
export const beatTried = (s: SaveGame | null, id: string): boolean =>
  beatState(s, id) !== 'untried'

/** How many times it has been sat. The result card shows this. */
export const attemptsOn = (s: SaveGame | null, id: string): number =>
  rowOf(s, id)?.attempts ?? 0

/* Required means the student failed and the year won't close until they retake it. Offered means a
 * retake is there if they want it. */
export type RetakeKind = 'required' | 'offered' | 'none'

export function retakeKind(s: SaveGame | null, id: string): RetakeKind {
  const row = rowOf(s, id)
  if (!row) return 'none'
  if (row.grade < PASSING_GRADE) return 'required'
  return row.grade < RETAKE_BELOW && !row.retaken ? 'offered' : 'none'
}

/** The line a station says about something in this state, written for the student. */
export function stateLine(state: BeatState, what: string): string {
  if (state === 'untried') return `${what} is waiting for you.`
  if (state === 'failed') return `${what} is not passed yet. You can take it again.`
  return `${what} is done for this year.`
}
