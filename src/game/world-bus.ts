/* Tracks what is currently blocking the player's controls. Each hold is counted separately, so it
 * doesn't matter what order they're released in. */

export type HoldRelease = () => void

const holds = new Map<symbol, string>()
const listeners = new Set<(held: boolean) => void>()

let lastHeld = false
function announce() {
  const held = holds.size > 0
  if (held === lastHeld) return
  lastHeld = held
  for (const fn of listeners) fn(held)
}

/* Takes the controls away from the player. The reason is shown in a debug overlay if input gets
 * stuck. */
export function holdWorld(reason: string): HoldRelease {
  const key = Symbol(reason)
  holds.set(key, reason)
  announce()
  let released = false
  return () => {
    /* Releasing twice is normal. The second call does nothing. */
    if (released) return
    released = true
    holds.delete(key)
    announce()
  }
}

export const worldHeld = () => holds.size > 0

/* What is holding the controls, for the debug overlay and for log lines. */
export const worldHolders = () => [...holds.values()]

/* Subscribed scenes are told when the hold state changes. A scene that mounts in the middle of a
 * hold should read worldHeld once. */
export function onWorldHold(fn: (held: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/* Clears every hold when a scene closes. Only the shell calls this, so a lock never carries over
 * into the next scene. */
export function releaseAllWorldHolds() {
  if (!holds.size) return
  console.warn(`[world-bus] releasing stuck holds: ${worldHolders().join(', ')}`)
  holds.clear()
  announce()
}
