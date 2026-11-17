// The reusable frame every activity runs on. A beat is plain data: dialogue lines and checks, in
// order.

import type { CheckStep, SceneLine } from '../../vine/contract'
import type { Intent, IntentResult } from '../../vine/intents'
import { checkIdOf, pointsOf as palettePoints, refuseCheck } from './palette'

export type BeatStep =
  | { kind: 'say'; line: SceneLine }
  | { kind: 'check'; check: CheckStep }

export type CoreBeat = {
  id: string             // Ledger id, like 'core:y1' or 'class:ap-human-geo'.
  year: number
  title: string
  place: string          // Where it happens in the story, like "the Advisory Hearth".
  /* The ledger kind. Core beats, class beats and an island's own activities all use this same
   * frame, and finish() copies this straight onto LedgerEntry.kind. */
  kind: 'core' | 'class' | 'island'
  /* How the activity is framed. A card is the usual panel, and a screen is the full-size monitor an
   * island moves the camera into. It only changes the look, never what's asked, answered or scored. */
  chrome?: 'card' | 'screen'
  /**
   * Cord tags copied onto the ledger entry, like 'ap', 'cte' or 'lang'. The cord code in
   * progress.ts reads them.
   */
  tags?: string[]
  steps: BeatStep[]
  /** Handbook fact ids the student collects on finishing. These become the takeaway cards. */
  takeaways: string[]
  credit: number         // 0.5 for core and class beats.
}

/* A check that fails validation gets dropped here, and the author is warned once, by name. */
const warned = new Set<string>()

export function checksOf(beat: CoreBeat): CheckStep[] {
  const out: CheckStep[] = []
  for (const s of beat.steps) {
    if (s.kind !== 'check') continue
    const why = refuseCheck(s.check)
    if (!why) { out.push(s.check); continue }
    const key = `${beat.id}:${checkIdOf(s.check)}`
    if (!warned.has(key)) { warned.add(key); console.warn(`[beat ${beat.id}] item refused and dropped: ${why}`) }
  }
  return out
}

/**
 * The beat's steps with any refused check taken out, so the path plays exactly the checks that
 * checksOf counts.
 */
export function playableSteps(beat: CoreBeat): BeatStep[] {
  const kept = new Set(checksOf(beat).map(checkIdOf))
  return beat.steps.filter((s) => s.kind !== 'check' || kept.has(checkIdOf(s.check)))
}

/* The points a check is worth. It comes from palette.ts so there's only one place that decides. */
export const pointsOf = palettePoints

/* What a beat gets when it plays out in the world: a way to send intents, and a message when the
 * player reaches an anchor. */
export type BeatWorld = {
  /** Sends an intent. It's performed and refused the same way as an intent sent from anywhere else. */
  issue: (i: Intent) => Promise<IntentResult>
  /**
   * The one event that comes back, which says the player reached an anchor. It returns its own
   * unsubscribe function.
   */
  onReached: (cb: (anchor: string) => void) => () => void
}
