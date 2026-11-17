// Shows the player a card when they earn something. Call it once per thing earned. It only shows
// things and never writes to the save.
import type { SaveGame } from './save'
import { awarded } from './ui/feedback'
import { badgesOf } from './badges'
import { cordsOf } from './progress'

/** What the caller just gave the player. `detail` is the second line on the card. */
export type Granted = { what: string; detail?: string }

/** Fired on every grant, so the world can update itself and not only the card in the corner. */
export const GRANT_EVENT = 'blhs:granted'

// Runs a step and catches any error, so a broken card can never undo something the player already
// earned.
function safely(fn: () => void) {
  try { fn() } catch (e) { console.warn('[grant] the answer failed, the grant stands', e) }
}

/**
 * Tells the player once that they earned something. Pass in the save from before and after the
 * change.
 */
export function grant(before: SaveGame | null, after: SaveGame | null, said: Granted): void {
  if (!after) return
  safely(() => {
    awarded(said.what, said.detail)

    // If this grant also finished a badge or a cord, show that on its own card. Only one gets
    // shown, never a list.
    if (!before) return
    const wasBadge = new Set(badgesOf(before).filter((b) => b.earned).map((b) => b.id))
    const newBadge = badgesOf(after).find((b) => b.earned && !wasBadge.has(b.id))
    if (newBadge) {
      queue(() => awarded(newBadge.name, newBadge.how))
      return
    }
    const wasCord = new Set(cordsOf(before).filter((c) => c.earned).map((c) => c.id))
    const newCord = cordsOf(after).find((c) => c.earned && !wasCord.has(c.id))
    if (newCord) queue(() => awarded(newCord.name, newCord.rule))
  })
  safely(() => { window.dispatchEvent(new CustomEvent(GRANT_EVENT)) })
}

// A second card waits until the first one has been on screen long enough.
const HOLD_MS = 2400
function queue(fn: () => void) {
  setTimeout(fn, HOLD_MS + 200)
}
