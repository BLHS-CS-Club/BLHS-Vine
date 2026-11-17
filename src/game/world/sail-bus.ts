/* Sail there: a panel asks the scene to take the ship somewhere, and the scene answers. The request
 * travels as a window event, so the panel and the scene don't need to know about each other. */
import type { WorldSlot } from './composition'

const EVENT = 'blhs:sail-to'

export type SailAnswer =
  /** The ship is on its way. The panel closes to get out of the way. */
  | { ok: true }
  /** The ship isn't going, and `why` is what the student is told. */
  | { ok: false; why: string }

type SailDetail = {
  slot: WorldSlot
  answer: (a: SailAnswer) => void
}

let listening = 0
let here: string | null = null

/**
 * How many scenes can take a sail request right now. The chart checks this before drawing a sail
 * control, so it never shows a button that can't do anything.
 */
export const sailListenerCount = (): number => listening

/* `sailListenerCount() > 0` only means this map has water on it. It doesn't mean the player is on
 * the ship, so don't use it that way or the chart offers "Sail to The Hub" to someone standing on
 * the hub's own quay. The scene reports whether the player is afloat itself. */
let afloat = false
export const isAfloat = (): boolean => afloat
export function setAfloat(on: boolean) {
  if (afloat === on) return
  afloat = on
  window.dispatchEvent(new CustomEvent('blhs:afloat'))
}

/* Which painting is on screen. The scene drawing it gives the answer, not the URL. A map with no
 * ocean still answers, because a journey starts with walking out of the room. */
export const sailFrom = (): string | null => (listening > 0 || voyagers > 0 ? here : null)

/**
 * Asks the world to take the ship to this slot. It resolves once the scene has decided, not when
 * the ship arrives, because the player watches the crossing instead of waiting on it.
 */
export function requestSail(slot: WorldSlot): Promise<SailAnswer> {
  return new Promise<SailAnswer>((resolve) => {
    let settled = false
    const answer = (a: SailAnswer) => {
      if (settled) return
      settled = true
      resolve(a)
    }
    window.dispatchEvent(new CustomEvent<SailDetail>(EVENT, { detail: { slot, answer } }))
    /* Listeners answer during the dispatch, which runs right away. If one already answered, this
     * refusal is ignored. If nobody did, it becomes the answer. */
    answer({ ok: false, why: 'There is no water under you right now.' })
  })
}

export function onSailRequest(
  mapId: string,
  fn: (slot: WorldSlot, answer: (a: SailAnswer) => void) => void,
): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<SailDetail>).detail
    if (d) fn(d.slot, d.answer)
  }
  window.addEventListener(EVENT, h)
  listening++
  here = mapId
  return () => {
    window.removeEventListener(EVENT, h)
    listening--
    /* When the last listener leaves, clear the map id too. A map id left over from a scene that's
     * gone would make the chart refuse to offer the island the student was on a moment ago. */
    if (listening <= 0) { listening = 0; here = null }
  }
}

/* The whole trip between islands (walk out, board, black bars, cross under a cover, tie up, show
 * the card) is `sail_to`. It's a separate event instead of a flag on `requestSail`, because a scene
 * that can steer the ship across its own ocean may still refuse an island with no dock. */
const VOYAGE = 'blhs:voyage-to'

type VoyageDetail = { map: string; answer: (a: SailAnswer) => void }

let voyagers = 0

/** How many scenes could take a voyage right now, so a panel can hide a button that wouldn't work. */
export const voyageListenerCount = (): number => voyagers

/** Asks the world to sail the whole way to this map. Resolves once the scene has decided. */
export function requestVoyage(map: string): Promise<SailAnswer> {
  return new Promise<SailAnswer>((resolve) => {
    let settled = false
    const answer = (a: SailAnswer) => { if (!settled) { settled = true; resolve(a) } }
    window.dispatchEvent(new CustomEvent<VoyageDetail>(VOYAGE, { detail: { map, answer } }))
    answer({ ok: false, why: 'There is nowhere to sail from right now.' })
  })
}

export function onVoyageRequest(
  mapId: string,
  fn: (map: string, answer: (a: SailAnswer) => void) => void,
): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<VoyageDetail>).detail
    if (d) fn(d.map, d.answer)
  }
  window.addEventListener(VOYAGE, h)
  voyagers++
  here = mapId
  return () => {
    window.removeEventListener(VOYAGE, h)
    voyagers--
    if (voyagers <= 0) voyagers = 0
    if (listening <= 0 && voyagers <= 0) here = null
  }
}
