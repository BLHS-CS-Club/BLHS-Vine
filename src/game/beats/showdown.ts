// The showdown frame: a turn-based football drive. Correct answers move the ball, and there's no
// clock.

import type { ShowdownRound } from '../../vine/contract'
import type { Response } from './palette'

/**
 * Everything about one drive. It's kept small on purpose, because a resume has to save and restore
 * it.
 */
export type ShowdownState = {
  /** Which round is on screen. It equals total when the drive is over. */
  round: number
  /** Rounds answered correctly so far. This is the only thing that moves the ball. */
  earned: number
  /** How many rounds are in this drive. */
  total: number
  /** The pick on the current round, or null until the student answers. */
  picked: number | null
  /**
   * What was picked in each answered round, keyed by round id. The runner hands all of it to the
   * palette as one Response for the whole showdown.
   */
  picks: Record<string, number>
  done: boolean
}

export type ShowdownAction =
  /**
   * Answer the round on screen. It's ignored once the round is answered, so a double click can't
   * score twice.
   */
  | { kind: 'pick'; index: number }
  /** Clear the answered round and start the next one. */
  | { kind: 'next' }

export const startShowdown = (rounds: ShowdownRound[]): ShowdownState => ({
  round: 0, earned: 0, total: rounds.length, picked: null, picks: {}, done: rounds.length === 0,
})

export function showdownReduce(s: ShowdownState, a: ShowdownAction, rounds: ShowdownRound[]): ShowdownState {
  if (s.done) return s
  const rd = rounds[s.round]
  if (!rd) return { ...s, done: true }

  if (a.kind === 'pick') {
    if (s.picked !== null) return s
    if (a.index < 0 || a.index >= rd.options.length) return s
    const right = !!rd.options[a.index].correct
    return {
      ...s,
      picked: a.index,
      earned: s.earned + (right ? 1 : 0),
      picks: { ...s.picks, [rd.id]: a.index },
    }
  }

  /* Only move on from an answered round. Otherwise the drive could skip a question the student
   * never saw and end with a total that doesn't match. */
  if (s.picked === null) return s
  const round = s.round + 1
  return { ...s, round, picked: null, done: round >= s.total }
}

/* ---- what gets drawn on screen --------------------------------------------- */

/** The yard line: the share of rounds not yet earned, spread across the field. */
export const yardsRemaining = (s: ShowdownState, fieldYards = 80): number =>
  s.total === 0 ? 0 : Math.round(fieldYards * ((s.total - s.earned) / s.total))

/** A number from 0 to 1, for whatever draws the drive on screen. */
export const progressOf = (s: ShowdownState): number =>
  s.total === 0 ? 1 : s.earned / s.total

/**
 * Turns the drive into an answer the palette can score, so a showdown is scored by the same
 * function as a two-option choice.
 */
export const responseOf = (checkId: string, s: ShowdownState): Response =>
  Object.fromEntries(Object.entries(s.picks).map(([roundId, i]) => [`${checkId}:${roundId}`, String(i)]))
