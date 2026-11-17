/* Finds a route for the ship over water. Aiming straight at the destination and sliding along the
 * shore wastes a lot of time aground, so this runs A* over a coarse grid of the depth field and
 * then pulls out the corners. */

export type Pt = { x: number; y: number }
/** Whether there's enough water at this point for the ship, counting its probe. */
export type Water = (x: number, y: number) => boolean

export type SeaRouteOpts = {
  /**
   * Grid spacing in world pixels. A coarse grid is fine, because pulling the path taut afterward
   * fixes the corners.
   */
  step?: number
  /** How many cells the search can open before it gives up. */
  budget?: number
}

/* The eight moves out of a cell. Diagonals come last so a tie goes to a straight move. */
const WAYS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
]

/** True if every point on the segment is water. It checks at half the grid spacing. */
export function clearWater(a: Pt, b: Pt, water: Water, step = 16): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(2, step / 2)))
  for (let i = 0; i <= n; i++) {
    const k = i / n
    if (!water(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false
  }
  return true
}

/* A grid path is a staircase, and a ship steering along one turns on every step. Pulling the path
 * taut keeps only the points the straight line can't see past, so open water ends up as two points
 * and going around a headland as three. */
export function pullTaut(pts: Pt[], water: Water, step: number): Pt[] {
  if (pts.length < 3) return pts
  const out: Pt[] = [pts[0]]
  let i = 0
  while (i < pts.length - 1) {
    let j = pts.length - 1
    /* Find the furthest point that can still be reached in a straight line over water. */
    while (j > i + 1 && !clearWater(pts[i], pts[j], water, step)) j--
    out.push(pts[j])
    i = j
  }
  return out
}

/** Finds the nearest cell center with water, spiraling out from a point that has none. */
function nearestWater(p: Pt, water: Water, step: number, rings = 6): Pt | null {
  if (water(p.x, p.y)) return p
  for (let r = 1; r <= rings; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const q = { x: p.x + dx * step, y: p.y + dy * step }
        if (water(q.x, q.y)) return q
      }
    }
  }
  return null
}

/**
 * Works out the path the ship should steer from where it is to where it's going, over water only.
 * It returns the waypoints, ending with the destination, or null when there's no way through at
 * this grid spacing. On null the caller goes back to aiming straight and sliding along the shore.
 */
export function seaRoute(from: Pt, to: Pt, water: Water, opts: SeaRouteOpts = {}): Pt[] | null {
  const step = opts.step ?? 24
  const budget = opts.budget ?? 9000

  /* Try the straight line first. Most crossings are one, and running A* over nine thousand cells to
   * say "sail forward" wastes a Chromebook's frame. */
  if (clearWater(from, to, water, step)) return [to]

  const start = nearestWater(from, water, step)
  const goal = nearestWater(to, water, step)
  if (!start || !goal) return null

  /* The grid is centered on the start, so the start is always cell 0,0 and nothing has to be
   * rounded onto some world-space origin. */
  const key = (cx: number, cy: number) => cx + ',' + cy
  const at = (cx: number, cy: number): Pt => ({ x: start.x + cx * step, y: start.y + cy * step })
  const gx = Math.round((goal.x - start.x) / step)
  const gy = Math.round((goal.y - start.y) / step)
  const h = (cx: number, cy: number) => Math.hypot(cx - gx, cy - gy)

  const g = new Map<string, number>([[key(0, 0), 0]])
  const came = new Map<string, string>()
  /* A plain array, scanned for the lowest score each time. The budget keeps it small enough that a
   * binary heap isn't worth it. */
  const open: Array<{ cx: number; cy: number; f: number }> = [{ cx: 0, cy: 0, f: h(0, 0) }]
  const shut = new Set<string>()
  let opened = 0

  while (open.length) {
    let best = 0
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i
    const cur = open.splice(best, 1)[0]
    const ck = key(cur.cx, cur.cy)
    if (shut.has(ck)) continue
    shut.add(ck)
    if (cur.cx === gx && cur.cy === gy) break
    if (++opened > budget) return null

    for (const [dx, dy] of WAYS) {
      const nx = cur.cx + dx, ny = cur.cy + dy
      const nk = key(nx, ny)
      if (shut.has(nk)) continue
      const np = at(nx, ny)
      if (!water(np.x, np.y)) continue
      /* A diagonal move can't cut across a corner of land. Without this check a grid route can clip
       * a headland it never stepped on. */
      if (dx && dy) {
        const a = at(cur.cx + dx, cur.cy)
        const b = at(cur.cx, cur.cy + dy)
        if (!water(a.x, a.y) || !water(b.x, b.y)) continue
      }
      const cost = (g.get(ck) ?? 0) + (dx && dy ? Math.SQRT2 : 1)
      if (cost >= (g.get(nk) ?? Infinity)) continue
      g.set(nk, cost)
      came.set(nk, ck)
      open.push({ cx: nx, cy: ny, f: cost + h(nx, ny) })
    }
  }

  if (!shut.has(key(gx, gy))) return null

  const back: Pt[] = []
  let k: string | undefined = key(gx, gy)
  while (k) {
    const [cx, cy] = k.split(',').map(Number)
    back.push(at(cx, cy))
    k = came.get(k)
  }
  back.reverse()
  /* Swap the last cell for the real destination, then pull out the corners. The first point is
   * where the ship already is, so drop it. */
  back[back.length - 1] = to
  return pullTaut([from, ...back], water, step).slice(1)
}
