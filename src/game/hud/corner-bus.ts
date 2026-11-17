/* Lets an island show the corner plaques (map, guide, my year) one at a time instead of all at
 * once. */

export type Plaque = 'map' | 'guide' | 'my-year'
export const PLAQUES: Plaque[] = ['map', 'guide', 'my-year']

export const PLAQUE_EVENT = 'blhs:hud-plaque'

/* The longest the corner can stay half revealed. After this, all three plaques come back on their
 * own. */
export const HANDOVER_CEILING_MS = 90_000

let armed = false
const shown = new Set<Plaque>()
const listeners = new Set<() => void>()
let ceiling = 0

const tell = () => { for (const fn of [...listeners]) fn() }

const holdCeiling = () => {
  window.clearTimeout(ceiling)
  if (!armed) return
  ceiling = window.setTimeout(() => {
    console.error(`[corner] the handover was armed ${HANDOVER_CEILING_MS / 1000}s ago and never `
      + 'finished, so the corner is being handed back whole. An island armed it and did not '
      + "reveal all three; call revealAllPlaques() (or dispatch 'all') in a finally.")
    revealAllPlaques()
  }, HANDOVER_CEILING_MS)
}

/** Hide all three plaques so they can be revealed one at a time. */
export function armHandover(): void {
  armed = true
  shown.clear()
  holdCeiling()
  tell()
}

/** Show one plaque. If nobody called armHandover() first, this arms it, so one call is enough. */
export function revealPlaque(which: Plaque): void {
  if (!armed) { armed = true; shown.clear() }
  shown.add(which)
  if (PLAQUES.every((p) => shown.has(p))) { armed = false; window.clearTimeout(ceiling) }
  else holdCeiling()
  tell()
}

/**
 * Show every plaque and stop the one-at-a-time reveal. It's safe to call even when nothing was
 * armed.
 */
export function revealAllPlaques(): void {
  window.clearTimeout(ceiling)
  if (!armed && shown.size === 0) return
  armed = false
  shown.clear()
  tell()
}

/** Whether this plaque is showing right now. */
export const plaqueShown = (which: Plaque): boolean => !armed || shown.has(which)

/** Whether a one-at-a-time reveal is running. Tests use it, and so does the arrival animation. */
export const handoverArmed = (): boolean => armed

/** The plaques revealed so far, listed in PLAQUES order (not the order they were revealed). */
export const plaquesRevealed = (): Plaque[] => PLAQUES.filter((p) => shown.has(p))

export function onCornerChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/* The single page listener. An island's Python runs in a worker, so its messages arrive here as an
 * event and get passed to the functions above. */
if (typeof window !== 'undefined') {
  window.addEventListener(PLAQUE_EVENT, (e: Event) => {
    const d = (e as CustomEvent<unknown>).detail
    const word = typeof d === 'string' ? d : (d as { plaque?: string })?.plaque
    if (word === 'arm') return armHandover()
    if (word === 'all') return revealAllPlaques()
    if (PLAQUES.includes(word as Plaque)) return revealPlaque(word as Plaque)
    console.error(`[corner] "${String(word)}" is not a plaque. Say one of `
      + `${['arm', ...PLAQUES, 'all'].join(', ')}.`)
  })
}

/* Resets everything in memory. A scene teardown uses it too, and it doesn't touch the save. */
export const resetCornerForTests = (): void => {
  window.clearTimeout(ceiling)
  armed = false
  shown.clear()
  listeners.clear()
}
