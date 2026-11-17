/* Finds a walkable route across the level mask. It uses the same rules for where a character can
 * step as the walking code does. */
import { canStandFrom, type MaskDoc, type WalkCfg } from './walk'

export type Pt = { x: number; y: number }

export type PathOpts = {
  /** How many painting pixels one search step covers. Smaller is more exact but slower. */
  step?: number
  /** How close to the goal counts as arriving, in painting pixels. */
  reach?: number
  /** A limit on how much the search can do, so a goal the player can't reach doesn't freeze a frame. */
  maxNodes?: number
}

const KEY = (cx: number, cy: number) => cy * 100000 + cx

/* The eight neighbors. The straight ones come first, so a route across open ground comes out
 * straight and not as a staircase. */
const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

/* The route, plus whether it really reached the goal. A blocked search gives back the closest it
 * got. */
export type PathResult = { points: Pt[]; reached: boolean; nodes: number }

export function findPath(
  doc: MaskDoc,
  cfg: WalkCfg,
  from: Pt,
  to: Pt,
  opts: PathOpts = {},
): PathResult {
  const step = Math.max(1, Math.round(opts.step ?? 4))
  const reach = opts.reach ?? Math.max(step * 2, 10)
  const maxNodes = opts.maxNodes ?? 40_000
  /* The y step is the x step times the painting's squash factor, so one grid step covers the same
   * amount of ground in any direction. walk.ts scales the walker by the same number. */
  const ys = cfg.yScale || 1

  const gx = (x: number) => Math.round(x / step)
  const gy = (y: number) => Math.round(y / (step * ys))
  const wx = (cx: number) => cx * step
  const wy = (cy: number) => cy * step * ys

  const startC = { cx: gx(from.x), cy: gy(from.y) }

  /* If the start is already close enough to the goal, return right away, so a goal one step away
   * doesn't cost a whole search. */
  if (Math.hypot(to.x - from.x, (to.y - from.y) / ys) <= reach)
    return { points: [{ x: to.x, y: to.y }], reached: true, nodes: 0 }

  const came = new Map<number, number>()
  const seen = new Set<number>([KEY(startC.cx, startC.cy)])
  let q: { cx: number; cy: number }[] = [startC]
  let nodes = 0
  let best = { cx: startC.cx, cy: startC.cy }
  let bestD = Math.hypot(wx(startC.cx) - to.x, (wy(startC.cy) - to.y) / ys)
  let found: { cx: number; cy: number } | null = null

  /* Breadth-first search, because every step on this grid costs the same. It stops at the node
   * limit. */
  while (q.length && nodes < maxNodes) {
    const next: typeof q = []
    for (const cur of q) {
      nodes++
      if (nodes > maxNodes) break
      const cwx = wx(cur.cx), cwy = wy(cur.cy)
      const d = Math.hypot(cwx - to.x, (cwy - to.y) / ys)
      if (d < bestD) { bestD = d; best = cur }
      if (d <= reach) { found = cur; break }

      const fromLvl = doc.lvlAt(cwx, cwy)
      for (const [dx, dy] of DIRS) {
        const nc = { cx: cur.cx + dx, cy: cur.cy + dy }
        const k = KEY(nc.cx, nc.cy)
        if (seen.has(k)) continue
        const nwx = wx(nc.cx), nwy = wy(nc.cy)
        /* This is the same check the game loop runs for the player's own next pixel, with the same
         * mask and settings. */
        if (!canStandFrom(doc, cfg, nwx, nwy, fromLvl)) continue
        seen.add(k)
        came.set(k, KEY(cur.cx, cur.cy))
        next.push(nc)
      }
    }
    if (found) break
    q = next
  }

  const end = found ?? best
  const points: Pt[] = []
  let k: number | undefined = KEY(end.cx, end.cy)
  const startK = KEY(startC.cx, startC.cy)
  while (k !== undefined && k !== startK) {
    const cx = k % 100000
    const cy = (k - cx) / 100000
    points.push({ x: wx(cx), y: wy(cy) })
    k = came.get(k)
  }
  points.reverse()
  /* The last point is the real goal, not the grid cell nearest it, so the arrow lands on the table
   * and not four pixels beside it. */
  if (found) points.push({ x: to.x, y: to.y })
  return { points, reached: !!found, nodes }
}

/* The point a set distance along the route. That's where the guiding arrow goes. */
export function aheadOn(points: Pt[], from: Pt, ahead: number, yScale = 1): Pt | null {
  if (!points.length) return null
  const ys = yScale || 1
  let run = 0
  let prev = from
  for (const p of points) {
    run += Math.hypot(p.x - prev.x, (p.y - prev.y) / ys)
    prev = p
    if (run >= ahead) return p
  }
  return points[points.length - 1]
}

/* Moves a goal that isn't on the floor, like a door, to the nearest pixel a character can stand on. */
export function onFloor(
  spot: Pt,
  standable: (x: number, y: number) => boolean,
  yScale = 1,
  within = 24,
): { at: Pt; moved: boolean } {
  if (standable(spot.x, spot.y)) return { at: spot, moved: false }
  const ys = yScale || 1
  let best: Pt | null = null
  let bestD = Infinity
  /* The search box is squashed the same way distance is measured, so it checks the ground that
   * counts as near and not a circle on the screen. */
  const x0 = Math.ceil(spot.x - within), x1 = Math.floor(spot.x + within)
  const y0 = Math.ceil(spot.y - within * ys), y1 = Math.floor(spot.y + within * ys)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - spot.x, (y - spot.y) / ys)
      if (d > within || d >= bestD) continue
      if (!standable(x, y)) continue
      bestD = d; best = { x, y }
    }
  }
  /* If there's no floor within reach, keep the original spot instead of picking somewhere random. */
  return best ? { at: best, moved: true } : { at: spot, moved: false }
}
