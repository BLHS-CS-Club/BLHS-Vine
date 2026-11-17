/* Builds the url a scene uses to send the player into a painted map. This is the only place that
 * format is written. */
import { transitionBusy, type TransitionSpec } from '../../app/transitions'
import { HUB_MAP, MAW_MAP } from '../run/objective'

/** Which map, where in it, and whether the player arrives on the water. */
export type PmapTarget = {
  map: string
  /**
   * The anchor to arrive at, named by a door. It can also be the save's own position, which
   * run/resume.ts checks.
   */
  at?: string
  /* True when the player arrives on the water instead of on foot. */
  aboard?: boolean
}

/** The default map. It lives here, next to the code that reads the url, and not in the scene. */
export const DEFAULT_MAP = 'quayprop'

export function targetFromUrl(search = window.location.search): PmapTarget {
  const p = new URLSearchParams(search)
  return {
    map: p.get('map') || DEFAULT_MAP,
    at: p.get('at') || undefined,
    aboard: p.get('aboard') === '1',
  }
}

/** Turns a target into a url query. Every other setting already on the url is kept. */
export function searchFor(t: PmapTarget, search = window.location.search): string {
  const q = new URLSearchParams(search)
  q.set('scene', 'pmap')
  q.set('map', t.map)
  if (t.at) q.set('at', t.at); else q.delete('at')
  if (t.aboard) q.set('aboard', '1'); else q.delete('aboard')
  return q.toString()
}

/* Uses replaceState, because a real navigation would reload the whole page. */
export function setMapUrl(t: PmapTarget) {
  window.history.replaceState(null, '', `${window.location.pathname}?${searchFor(t)}`)
}

/** The scene id for every painted map, so no caller has to type it. */
export const PMAP_SCENE = 'pmap'

/* ---- write the address only when the navigation is really going to happen */
export function enterMap(
  go: (to: string, spec?: TransitionSpec) => void,
  t: PmapTarget,
  spec?: TransitionSpec,
): boolean {
  if (transitionBusy()) {
    console.warn(`[route] refused to open "${t.map}": a transition is already running`)
    return false
  }
  setMapUrl(t)
  go(PMAP_SCENE, spec)
  return true
}

/* ---- the two places the game itself sends a student */

/** Set Sail goes here: the one ocean, around the published hub, with the player steering the ship. */
export const SEA_ARRIVAL: PmapTarget = { map: HUB_MAP, aboard: true }

/* Continue always lands in the Maw. It uses an anchor name, not a saved position. */
export const HOME_TARGET: PmapTarget = { map: MAW_MAP, at: 'arrive_maw' }
