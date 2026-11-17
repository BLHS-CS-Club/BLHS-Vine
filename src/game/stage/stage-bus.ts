/* Carries requests from the Pixi stage over to React, like showing the arrival card. */

export type PlaceCardRequest = {
  /** The name the player sees. Never a map id. `covers.ts` works out the name. */
  title: string
  /** One line under the title, when the destination has something to say. */
  line?: string
  /* The first arrival at a place is a big moment, but by the fourth time it's just a sign. So a
   * repeat visit gets the same card smaller and gone sooner. */
  brief?: boolean
}

const cardListeners = new Set<(c: PlaceCardRequest) => void>()

/**
 * Show the card and move on. It hides itself and takes no input, so there's nothing to wait for and
 * nothing to clean up.
 */
export function showPlaceCard(c: PlaceCardRequest) {
  for (const fn of cardListeners) fn(c)
}

export function onPlaceCard(fn: (c: PlaceCardRequest) => void): () => void {
  cardListeners.add(fn)
  return () => { cardListeners.delete(fn) }
}

/* Whether an arrival card is on screen right now, so nothing else talks over it. */
let cardUp = false
const busyListeners = new Set<() => void>()

export const placeCardUp = (): boolean => cardUp

export function setPlaceCardUp(v: boolean): void {
  if (v === cardUp) return
  cardUp = v
  for (const fn of busyListeners) fn()
}

export function onStageBusy(fn: () => void): () => void {
  busyListeners.add(fn)
  return () => { busyListeners.delete(fn) }
}

/* Whether a map is actually drawn on screen yet, so nothing talks over a black loading screen. */
let drawnMap: string | null = null
const drawnListeners = new Set<(map: string | null) => void>()

/** The id of the map whose first frame is on screen, or null while it's still loading. */
export const sceneDrawn = (): string | null => drawnMap

export function setSceneDrawn(map: string | null): void {
  if (map === drawnMap) return
  drawnMap = map
  for (const fn of drawnListeners) fn(map)
}

export function onSceneDrawn(fn: (map: string | null) => void): () => void {
  drawnListeners.add(fn)
  return () => { drawnListeners.delete(fn) }
}
