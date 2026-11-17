/* Keeps track of a voyage between maps. The map changes twice on a trip, and `enter()` tears down
 * the scene and the island's Python each time, so no single handler can follow the whole journey.
 * The plan lives here instead, started by `sail_to(map)`. */

/* The four legs, in order. `boarding` is its own pause at the berth, with the movie bars showing,
 * until the player presses E. Squeezing the walk to the dock, boarding and casting off into one leg
 * feels like the camera rushing past the ship. The leg is exported because Escape means "not now"
 * before `crossing` and "take me there" after it. */
export type VoyageLeg =
  /* Getting to the dock: out of the room, through any doors, onto the dock. */
  | 'to-dock'
  /* Standing at the berth with the movie bars showing, waiting for the player to press E. */
  | 'boarding'
  /* On the ship and sailing. */
  | 'crossing'
  /* The far map has loaded and still needs to play the arrival. */
  | 'landing'

/** True while the journey is still waiting on the player, before the ship starts carrying them. */
export const voyageWaiting = (): boolean =>
  !!plan && (plan.leg === 'to-dock' || plan.leg === 'boarding')

export type VoyagePlan = {
  /** The map being sailed to. */
  to: string
  /** The map the voyage started from, so the way back is known. */
  from: string
  leg: VoyageLeg
  /** True when this is the trip home, which ends at a door instead of a berth. */
  home: boolean
}

let plan: VoyagePlan | null = null
/* Set when the student asks to skip ahead. The leg that's running checks it. */
let skipped = false
const subs = new Set<(p: VoyagePlan | null) => void>()

function tell() { for (const s of [...subs]) { try { s(plan) } catch (e) { console.error('[travel] a listener threw', e) } } }

/** The current voyage, or null when nobody is traveling. */
export const voyage = (): VoyagePlan | null => plan

/** Starts a voyage. The scene that started it runs the first leg. */
export function beginVoyage(p: VoyagePlan) {
  plan = p
  skipped = false
  calledOff = false
  console.log(`[travel] ${p.from} -> ${p.to}, leg ${p.leg}${p.home ? ', going home' : ''}`)
  tell()
}

/** Moves the same voyage on to its next leg, across a map change. */
export function setLeg(leg: VoyageLeg) {
  if (!plan) return
  plan = { ...plan, leg }
  console.log(`[travel] leg ${leg}`)
  tell()
}

/* Calling a voyage off before it starts. Escape before the ship moves drops the plan and takes the
 * movie bars away, leaving a normal dock where E opens the chart again. It's separate from
 * `endVoyage` so a listener can tell a finished journey from one that was called off. */
/* Both called off and finished set the plan to null, so this flag tells them apart. On a call-off
 * the scene's listener puts the year's objective line back. It must not do that on an arrival,
 * because the island the ship reached has already set its own first line while the ship was still
 * on the water. */
let calledOff = false

/** True if the student dropped the last plan instead of finishing it. */
export const voyageCalledOff = (): boolean => calledOff

export function cancelVoyage() {
  if (!plan) return
  console.log(`[travel] ${plan.from} -> ${plan.to} called off before sailing`)
  plan = null
  skipped = false
  calledOff = true
  tell()
}

/** Ends the voyage, either because it arrived or because it was abandoned. */
export function endVoyage(why = 'arrived') {
  if (!plan) return
  calledOff = false
  console.log(`[travel] ${plan.from} -> ${plan.to} ended: ${why}`)
  plan = null
  skipped = false
  tell()
}

export function onVoyage(f: (p: VoyagePlan | null) => void): () => void {
  subs.add(f)
  f(plan)
  return () => { subs.delete(f) }
}

/* The time limit for every leg. During a voyage the player can't control anything, so a leg that
 * never finishes would leave them stuck behind the black bars forever. */
export const LEG_CEILING_MS = 90_000

/* A crossing is about twenty seconds of watching the ship and is worth seeing once, so skipping
 * sets a flag instead of aborting. The journey still finishes at the same dock with the same card.
 * This is a different skip from the one on `CutsceneRuntime`, which fast-forwards through cutscene
 * steps that a voyage doesn't have. */
export function skipVoyage() {
  if (!plan || skipped) return
  skipped = true
  console.log('[travel] skipped by the student')
  tell()
}

/** True if the student asked to skip ahead. */
export const voyageSkipped = (): boolean => skipped
