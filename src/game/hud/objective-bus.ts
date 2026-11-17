// Holds what the objective panel says. A line from the island wins over a line from the scene, and
// a line from the scene wins over the line for the year.

let said: string | null = null
let world: string | null = null
/* True during the last shot of the run, for as long as the departure plays. */
let ending = false
const subs = new Set<() => void>()

const fire = () => { for (const s of [...subs]) { try { s() } catch (e) { console.error('[objective] a listener threw', e) } } }

/** What the island said, or null when it hasn't said anything. */
export const objectiveSaid = (): string | null => said

/** What the scene says when it knows something the year's line doesn't. */
export const worldObjective = (): string | null => world

/** Runs the `objective(text)` command. Passing null gives the panel back to the year's line. */
export function setObjectiveSaid(text: string | null) {
  const v = text && text.trim() ? text.trim() : null
  if (v === said) return
  said = v
  fire()
}

/**
 * The scene's own sentence, used out on the water. It works the same way but loses to the island's
 * line.
 */
export function setWorldObjective(text: string | null) {
  const v = text && text.trim() ? text.trim() : null
  if (v === world) return
  world = v
  fire()
}

/** Whether the run is in its last shot. While it is, the panel says nothing. */
export const runEnding = (): boolean => ending

/** `end_run` turns this on for the departure. It turns off when the title screen takes over. */
export function setRunEnding(on: boolean) {
  if (on === ending) return
  ending = on
  fire()
}

/** Subscribe to changes. This only tells you something changed, so read the current value yourself. */
export function onObjectiveSaid(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}
