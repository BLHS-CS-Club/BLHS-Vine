/* The math behind the chart. It works out the box of water the world is drawn in, how big each
 * island is drawn, and which part of its bundle image shows the island. */
import type { WorldPt, WorldSlot } from './composition'

/* The box the world fits in also sets the shape of the water on screen, which gets it as an
 * `aspect-ratio`. Both axes have to use the same scale, or distances on the chart come out wrong. */

/** The flattest and tallest the water can be, as width divided by height. */
export const CHART_ASPECT = { min: 1.8, max: 2.6 }

/**
 * How much open water to leave around the outermost island, in world units. It's at least
 * CHART_PAD_MIN, or CHART_PAD_SHARE of the spread if that's bigger.
 */
export const CHART_PAD_MIN = 320
export const CHART_PAD_SHARE = 0.35

export type ChartBox = {
  x0: number
  y0: number
  /** The size of the whole box, in world units. */
  w: number
  h: number
  /** Width divided by height. The water element uses this as its aspect ratio. */
  aspect: number
  /** The distance between grid lines, in world units. */
  step: number
}

/* The spacings the grid can use. They're a fixed list of round numbers so the label beside a line
 * is easy to read. */
const STEPS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000]

/**
 * Picks the grid spacing for a span. It's wide enough that there are at most 16 lines, so they stay
 * easy to count.
 */
export const gridStep = (span: number): number =>
  STEPS.find((n) => span / n <= 16) ?? STEPS[STEPS.length - 1]

/* Fixes the aspect by making the short side longer. The long side never shrinks, so no island gets
 * pushed off the edge. */
export function clampAspect(w: number, h: number): { w: number; h: number } {
  const a = w / h
  if (a > CHART_ASPECT.max) return { w, h: w / CHART_ASPECT.max }
  if (a < CHART_ASPECT.min) return { w: h * CHART_ASPECT.min, h }
  return { w, h }
}

/** The box of water that holds all these points, with its aspect pulled into the allowed range. */
export function chartBox(pts: readonly WorldPt[]): ChartBox {
  if (!pts.length) {
    const side = CHART_PAD_MIN * 2
    return { x0: -CHART_PAD_MIN, y0: -CHART_PAD_MIN, w: side * CHART_ASPECT.min, h: side, aspect: CHART_ASPECT.min, step: gridStep(side) }
  }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const pad = Math.max(CHART_PAD_MIN, spread * CHART_PAD_SHARE)

  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad
  const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad

  /* The box grows the same amount on both sides, so everything already on the chart stays in the
   * same place relative to everything else. */
  const fit = clampAspect(x1 - x0, y1 - y0)
  const grewX = (fit.w - (x1 - x0)) / 2
  const grewY = (fit.h - (y1 - y0)) / 2
  return {
    x0: x0 - grewX,
    y0: y0 - grewY,
    w: fit.w,
    h: fit.h,
    aspect: fit.w / fit.h,
    step: gridStep(Math.max(fit.w, fit.h)),
  }
}

/** Where a world point lands on the water, as a percentage of each side. */
export const atPct = (box: ChartBox, p: WorldPt): { left: string; top: string } => ({
  left: `${((p.x - box.x0) / box.w) * 100}%`,
  top: `${((p.y - box.y0) / box.h) * 100}%`,
})

/* Islands are drawn at a readable size instead of at true scale. At true scale the hub's painting
 * is 669 units on a 1466 wide box and would fill half the chart. With lots of islands they shrink
 * to the 30px minimum, so past `CHART_DENSE` the names only show on hover and the list underneath
 * carries them. */

/**
 * How many CSS pixels an island's longest side is drawn at. It gets smaller as the island count
 * goes up, between 30 and 52.
 */
export const pinPx = (islands: number): number =>
  Math.round(Math.max(30, Math.min(52, 150 / Math.sqrt(Math.max(1, islands)))))

/** With more islands than this, the water shows only the pictures and the names wait for hover. */
export const CHART_DENSE = 6

/** The size, in CSS pixels, the same painting is drawn at in the list underneath. */
export const CHART_THUMB = 34

/* The tallest the water can be, as a CSS length. The binder page is `min(760px, 86vh)` minus its
 * header and tab row, so this keeps the legend and the top of the list on screen without scrolling
 * on a school Chromebook. */
export const CHART_TALL = 'min(310px, 40vh)'

/* These numbers come from the island's published bundle. `origin` and `footprint` mark the painted
 * rectangle inside a mostly transparent canvas (the same `base` MAPVIS writes into the manifest),
 * so the crop shows the island and not the empty space around it. */

export type IslandCut = {
  /** The bundle's own painting, copied in at build time. */
  src: string
  /** The committed folder, used for a map that wasn't copied in at build time. */
  spare: string
  /** The size of the window the painting shows through, in CSS pixels. */
  w: number
  h: number
  /**
   * The whole canvas scaled to match, and how far it's shifted up and left so the island lines up
   * with the window.
   */
  imgW: number
  imgH: number
  left: number
  top: number
}

/** An island's own painting, cropped to the painted part and scaled so its longest side is `pin`. */
export function islandCut(slot: WorldSlot, pin: number): IslandCut | null {
  if (!slot.map) return null
  const fw = slot.footprint?.w ?? 0
  const fh = slot.footprint?.h ?? 0
  if (fw <= 0 || fh <= 0) return null
  const cw = slot.canvas?.w ?? fw
  const ch = slot.canvas?.h ?? fh
  /* A bundle with no origin has its painting in the middle of its canvas. That's what
   * `paintedCentre` assumes everywhere else in the engine too. */
  const ox = slot.origin?.x ?? (cw - fw) / 2
  const oy = slot.origin?.y ?? (ch - fh) / 2
  const k = pin / Math.max(fw, fh)
  return {
    src: `/maps-vendored/${slot.map}/scene.png`,
    spare: `/maps-painted/${slot.map}/scene.png`,
    w: Math.round(fw * k),
    h: Math.round(fh * k),
    imgW: Math.round(cw * k),
    imgH: Math.round(ch * k),
    left: -Math.round(ox * k),
    top: -Math.round(oy * k),
  }
}
