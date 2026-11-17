/* Keeps track of how much of the bottom of the window is covered by dialogue and other UI, so the
 * camera can lift the view above it. */

type Claim = { px: number; stacked: boolean }

const claims = new Map<string, Claim>()
let band = 0

/**
 * How many pixels at the bottom of the window the UI covers, including anything stacked on top of
 * it. The renderer reads this.
 */
export const uiBand = (): number => band

function tallest(only: (c: Claim) => boolean): number {
  let top = 0
  for (const c of claims.values()) if (only(c) && c.px > top) top = c.px
  return top
}

function recompute(): void {
  band = tallest(() => true)
  /* Also publish the band as the CSS variable `--ui-band`, for surfaces that place themselves above
   * the dialogue. Stacked claims are left out of this one. */
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ui-band', `${Math.round(tallest((c) => !c.stacked))}px`)
  }
}

function claim(key: string, px: number, stacked: boolean): void {
  /* A rect measured before layout can give NaN or Infinity. A NaN here would make the camera target
   * NaN and the scene would go blank. */
  const v = Number.isFinite(px) && px > 0 ? px : 0
  if (v === 0) claims.delete(key)
  else claims.set(key, { px: v, stacked })
  recompute()
}

/**
 * A surface along the bottom of the window reports how tall it is. Reporting 0, or unmounting,
 * removes its claim.
 */
export const setUiBand = (key: string, px: number): void => claim(key, px, false)

/**
 * The same, for a surface that places itself above the band using `--ui-band` in CSS. The camera
 * still counts its height, but it's left out of `--ui-band` itself.
 */
export const setUiBandStacked = (key: string, px: number): void => claim(key, px, true)

/**
 * Finds the highest top edge among the laid-out elements, and gives back how far that is above the
 * bottom of the window.
 */
export function bandFromRects(els: readonly (Element | null | undefined)[]): number {
  if (typeof window === 'undefined') return 0
  let top = Infinity
  for (const el of els) {
    if (!el) continue
    const r = el.getBoundingClientRect()
    /* A zero-height rect means the element hasn't been laid out yet. Counting it would make the
     * band the whole window and point the camera off the top of the map. */
    if (r.height <= 0) continue
    if (r.top < top) top = r.top
  }
  if (!Number.isFinite(top)) return 0
  return Math.max(0, window.innerHeight - top)
}
