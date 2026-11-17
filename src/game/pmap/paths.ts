/* Reads paths from a map bundle. A path is a named line that a character, the ship or the camera
 * can be sent along. */

export type PathKind = 'walk' | 'sail' | 'camera'

export const PATH_KINDS: PathKind[] = ['walk', 'sail', 'camera']

/* A named waypoint. It lets a scene say "be at the doorway by the end of this line" instead of
 * "walk for 2.4 seconds". `at` is an index into `points`, so a mark can't name a waypoint that
 * doesn't exist. */
export type PathMark = { at: number; name: string; label?: string }

export type Pathway = {
  name: string
  kind: PathKind
  points: { x: number; y: number }[]
  /** A patrol loops back to its first point. An approach doesn't. */
  closed: boolean
  /**
   * Whether the path can be traveled backwards. A sailing line into a berth isn't a line out of it,
   * so paths are one-way unless they say otherwise.
   */
  twoWay: boolean
  /** Which way to face on arrival, using the same eight direction words as walking. */
  facing?: string
  /**
   * The same direction as an angle, in degrees clockwise from north. Trust this one when it's
   * present, because eight words can't describe a coast that runs at 23 degrees. `facing` is still
   * saved next to it as the nearest of the eight, so code that reads the words and older bundles
   * keep working.
   */
  bearing?: number
  marks: PathMark[]
  meta?: Record<string, unknown>
}

export type PathSource = { paths?: unknown }

/* Reads a number and only a number, so null and empty strings don't turn into zero. */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v)
  return null
}

/* Names are checked again here because a bundle can be edited by hand. A name that isn't a legal
 * Python identifier can't be handed to the island code. */
export const isPathName = (s: unknown) => typeof s === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(s)

/* Reads the paths from a map, skipping any it can't understand. */
export function readPaths(map: PathSource, mapId = ''): Pathway[] {
  const raw = Array.isArray(map.paths) ? map.paths : []
  const out: Pathway[] = []
  const seen = new Set<string>()
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue
    const name = typeof e.name === 'string' ? e.name : ''
    if (!isPathName(name)) {
      console.warn(`[paths] ${mapId}: dropping a path whose name is not addressable: "${String(e.name)}"`)
      continue
    }
    if (seen.has(name)) {
      console.warn(`[paths] ${mapId}: duplicate path name "${name}", keeping the first`)
      continue
    }
    /* If any waypoint can't be read, the whole path is dropped instead of being renumbered. */
    const pts: { x: number; y: number }[] = []
    let broken = -1
    const raw = Array.isArray(e.points) ? e.points : []
    for (let pi = 0; pi < raw.length && broken < 0; pi++) {
      const p = raw[pi]
      const px = Array.isArray(p) ? num(p[0]) : num((p as Record<string, unknown>)?.x)
      const py = Array.isArray(p) ? num(p[1]) : num((p as Record<string, unknown>)?.y)
      if (px === null || py === null) { broken = pi; break }
      pts.push({ x: Math.round(px), y: Math.round(py) })
    }
    if (broken >= 0) {
      console.warn(`[paths] ${mapId}: path "${name}" has an unreadable waypoint at index ${broken}, `
        + `so the whole route is dropped rather than silently renumbered`)
      continue
    }
    /* A path needs at least two points. A single waypoint would move zero pixels but still report
     * that it went somewhere. */
    if (pts.length < 2) {
      console.warn(`[paths] ${mapId}: path "${name}" has ${pts.length} usable point${pts.length === 1 ? '' : 's'} and needs two`)
      continue
    }
    /* If no kind is given it's a walk, which is MAPVIS's default too. */
    const kindRaw = typeof e.kind === 'string' ? e.kind : 'walk'
    const kind = (PATH_KINDS as string[]).includes(kindRaw) ? kindRaw as PathKind : 'walk'
    if (kind !== kindRaw)
      console.warn(`[paths] ${mapId}: path "${name}" says kind "${kindRaw}", which is not one of ${PATH_KINDS.join(', ')}; reading it as a walk`)

    const marks: PathMark[] = []
    for (const m of Array.isArray(e.marks) ? e.marks : []) {
      const o = m as Record<string, unknown>
      const at = num(o?.at)
      const mn = typeof o?.name === 'string' ? o.name : ''
      /* A mark that points past the end of the line could never fire, and nothing would say why. So
       * it gets a warning here when the map loads. */
      if (at === null || !mn || at < 0 || at >= pts.length) {
        if (mn) console.warn(`[paths] ${mapId}: mark "${mn}" on "${name}" points at waypoint ${String(o?.at)} of ${pts.length}`)
        continue
      }
      marks.push({ at: Math.round(at), name: mn, ...(typeof o.label === 'string' && o.label ? { label: o.label } : {}) })
    }

    seen.add(name)
    out.push({
      name,
      kind,
      points: pts,
      closed: e.closed === true,
      twoWay: e.twoWay === true,
      ...(typeof e.facing === 'string' && e.facing ? { facing: e.facing } : {}),
      ...(Number.isFinite(Number(e.bearing)) ? { bearing: Number(e.bearing) } : {}),
      marks,
      ...(e.meta && typeof e.meta === 'object' ? { meta: e.meta as Record<string, unknown> } : {}),
    })
  }
  return out
}

/* ---- the questions a route is asked ---------------------------------------- */

/**
 * The waypoints in the order they're traveled. They're reversed when a two-way path runs backwards,
 * and a patrol gets its first point added again at the end.
 */
export function legsOf(p: Pathway, backwards = false): { x: number; y: number }[] {
  const pts = backwards ? [...p.points].reverse() : [...p.points]
  if (p.closed && pts.length > 2) pts.push({ ...pts[0] })
  return pts
}

/**
 * How long the path is, in painting pixels. A caller can size a timeout from the real route instead
 * of a fixed number that's wrong on the next map.
 */
export function lengthOf(p: Pathway, backwards = false): number {
  const pts = legsOf(p, backwards)
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return d
}

export const pathNames = (ps: Pathway[]): string[] => ps.map((p) => p.name).sort()

/* Finds the points on a walk path where a character can't stand. It checks along each line, not
 * only at the corners. */
export function walkFaults(
  p: Pathway,
  standable: (x: number, y: number) => boolean,
  step = 6,
): { at: { x: number; y: number }; leg: number }[] {
  if (p.kind !== 'walk') return []
  const pts = legsOf(p)
  const bad: { at: { x: number; y: number }; leg: number }[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * (k / n)
      const y = a.y + (b.y - a.y) * (k / n)
      if (!standable(x, y)) { bad.push({ at: { x: Math.round(x), y: Math.round(y) }, leg: i }); break }
    }
  }
  return bad
}
