/* Reads a map's anchors. Anchors are the named places on a map that code can look up. */
import { rolesOf, type Role } from '../run/roles'

export type AnchorKind = 'point' | 'region' | 'door' | 'post' | 'spawn' | 'trigger'

export const ANCHOR_KINDS: AnchorKind[] = ['point', 'region', 'door', 'post', 'spawn', 'trigger']

export interface Anchor {
  name: string
  kind: AnchorKind
  x: number
  y: number
  r: number
  /* The pixel a character stands on when using this place, which is usually beside the thing and
   * not in its middle. If it's missing, the character stands in the middle. */
  stand?: [number, number]
  /* Two opposite corners, [x0,y0,x1,y1]. It's corners and not [x,y,w,h], because that's what the
   * box test below reads. */
  rect?: [number, number, number, number]
  /* How far the interaction circle is moved from the anchor's own pixel. If it's missing, the
   * circle is centered on the anchor. */
  ring?: [number, number]
  to?: string
  toAnchor?: string
  placement?: string
  facing?: string
  label: string
  meta?: Record<string, unknown>
}

/* A bundle lists its anchors under `anchors`, or under the older name `events`. */
export interface AnchorSource {
  anchors?: unknown
  events?: unknown
  /* These are only read to size the standing spot check below. Both are optional so a hand-written
   * test map can be two anchors and nothing else. */
  character?: { heightPx?: number } | unknown
  yScale?: unknown
}

/* How far a standing spot can be from the thing it belongs to, measured in body lengths. */
const STAND_REACH_BODIES = 2

const num = (v: unknown, fallback: number) => (isFinite(Number(v)) ? Number(v) : fallback)

/* The same name rule MAPVIS uses when a name is typed. It's checked again here because a bundle can
 * be edited by hand, and a name that isn't a legal Python identifier can't be handed to the island
 * code. */
export const isAnchorName = (s: unknown) => typeof s === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(s)

/* Read a bundle's anchors. Any anchor it can't understand is skipped so the map still loads. */
export function readAnchors(map: AnchorSource, mapId = ''): Anchor[] {
  const raw = Array.isArray(map.anchors) ? map.anchors
    : Array.isArray(map.events) ? map.events
      : []
  const out: Anchor[] = []
  const seen = new Set<string>()
  /* The character's height and the map's yScale size the standing spot check. Every real bundle has
   * both, and a test map without them gets 20 and 1. */
  const ch = map.character as { heightPx?: unknown } | undefined
  const body = Math.max(4, num(ch?.heightPx, 20))
  const ys = num(map.yScale, 1) || 1
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue
    if (!isFinite(Number(e.x)) || !isFinite(Number(e.y))) continue

    /* An older event has `type` instead of `kind`. A `type` of door, or no type at all, becomes a
     * door, and any other type becomes a point. */
    const legacyType = typeof e.type === 'string' ? e.type : ''
    const kindRaw = typeof e.kind === 'string' ? e.kind : legacyType === 'door' || !legacyType ? 'door' : 'point'
    if (!(ANCHOR_KINDS as string[]).includes(kindRaw)) {
      console.warn(`[anchors] ${mapId}: skipping anchor of unknown kind "${kindRaw}"`)
      continue
    }
    const kind = kindRaw as AnchorKind

    const label = typeof e.label === 'string' ? e.label : ''
    let name = typeof e.name === 'string' ? e.name : ''
    let derived = false
    if (!isAnchorName(name)) {
      name = anchorName(label || `${kind}_${num(e.id, out.length + 1)}`)
      derived = true
    }
    /* A duplicate name gets refused, because a name has to point at exactly one thing. The first
     * one wins, so a map that ends up with a clash keeps working the same way. */
    if (seen.has(name)) {
      console.warn(`[anchors] ${mapId}: duplicate anchor name "${name}", keeping the first`)
      continue
    }
    seen.add(name)

    const meta = e.meta && typeof e.meta === 'object' ? { ...(e.meta as Record<string, unknown>) } : undefined
    const a: Anchor = {
      name,
      kind,
      x: Math.round(num(e.x, 0)),
      y: Math.round(num(e.y, 0)),
      r: Math.max(1, Math.round(num(e.r, 14))),
      label,
      ...(derived ? { meta: { ...(meta || {}), derived: true } } : meta ? { meta } : {}),
    }
    if (Array.isArray(e.rect) && e.rect.length === 4) a.rect = (e.rect as number[]).map(Number) as Anchor['rect']
    /* The ring offset can come as its own field or inside the meta bag. */
    const rawRing = Array.isArray(e.ring) ? e.ring : meta && Array.isArray(meta.ring) ? meta.ring : null
    if (rawRing && rawRing.length === 2 && (rawRing as unknown[]).every((n) => isFinite(Number(n))))
      a.ring = [Math.round(Number(rawRing[0])), Math.round(Number(rawRing[1]))]
    if (Array.isArray(e.stand) && e.stand.length === 2 && e.stand.every((n) => isFinite(Number(n)))) {
      const sx = Math.round(Number(e.stand[0])), sy = Math.round(Number(e.stand[1]))
      /* Measure on the floor, not on the screen. The painting is squashed up and down, so a spot
       * some pixels below a post is farther away on the floor than one the same pixels beside it. */
      const apart = Math.hypot(sx - a.x, (sy - a.y) / ys)
      const reach = STAND_REACH_BODIES * body + a.r
      if (apart <= reach) a.stand = [sx, sy]
      else {
        console.warn(`[anchors] ${mapId}: "${name}" stands at ${sx},${sy}, which is ${Math.round(apart)}`
          + ` pixels of floor from the post itself at ${a.x},${a.y} and past its reach of ${Math.round(reach)}.`
          + ' A standing spot is the floor beside a thing, so this one was left behind when the post moved.'
          + " Using the post's own pixel. Drag the standing spot with it in MAPVIS and republish.")
      }
    }
    if (typeof e.to === 'string' && e.to) a.to = e.to
    if (typeof e.toAnchor === 'string' && e.toAnchor) a.toAnchor = e.toAnchor
    if (typeof e.placement === 'string' && e.placement) a.placement = e.placement
    if (typeof e.facing === 'string' && e.facing) a.facing = e.facing
    out.push(a)
  }
  return out
}

/* A copy of MAPVIS's own anchorName. Keep the two identical so an old door gets the same name in
 * both places. */
export function anchorName(s: string): string {
  const n = String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'a$1')
    .slice(0, 48)
  return n || 'anchor'
}

/* ---- asking questions about a map's anchors ------------------------------- */

/* Tells you where a placement is being drawn this frame. It gives back null for a placement name
 * this map doesn't have. */
export type LiveSpots = (placement: string) => { x: number; y: number } | null

export class AnchorSet {
  private byName = new Map<string, Anchor>()
  private byRoleName = new Map<Role, Anchor>()
  private roleByName = new Map<string, Role>()
  private live: LiveSpots | null = null
  readonly all: Anchor[]

  constructor(readonly mapId: string, anchors: Anchor[]) {
    this.all = anchors
    for (const a of anchors) this.byName.set(a.name, a)
    this.byRoleName = rolesOf(anchors, mapId)
    for (const [role, a] of this.byRoleName) this.roleByName.set(a.name, role)
  }

  static from(mapId: string, map: AnchorSource) {
    return new AnchorSet(mapId, readAnchors(map, mapId))
  }

  get(name: string): Anchor | undefined { return this.byName.get(name) }
  has(name: string): boolean { return this.byName.has(name) }

  /* The anchor that fills a role on this map. A null role gives back nothing, which is how a step
   * says it wants no arrow drawn. */
  byRole(role: Role | null | undefined): Anchor | undefined {
    return role ? this.byRoleName.get(role) : undefined
  }

  /* What role this anchor fills on this map, or null if it fills none. */
  roleOf(name: string): Role | null { return this.roleByName.get(name) ?? null }
  ofKind(kind: AnchorKind): Anchor[] { return this.all.filter((a) => a.kind === kind) }

  /* Hand in the function that knows where the painted things are drawn this frame. */
  follow(spots: LiveSpots | null) { this.live = spots }

  /* Where this anchor is right now. If it's attached to a painted thing that moves, it follows that
   * thing. */
  spotOf(a: Anchor): { x: number; y: number } {
    if (a.placement && this.live) {
      const p = this.live(a.placement)
      if (p) return p
    }
    return { x: a.x, y: a.y }
  }

  /* The floor spot a character ends up on at this anchor, and which way it faces there. */
  standAt(a: Anchor): { x: number; y: number; facing?: string } {
    const spot = this.spotOf(a)
    if (!a.stand) return { ...spot, facing: a.facing }
    return {
      x: a.stand[0] + (spot.x - a.x),
      y: a.stand[1] + (spot.y - a.y),
      facing: a.facing,
    }
  }

  /* Checks whether a point is inside this anchor. A region with a rectangle uses the rectangle, and
   * everything else uses its circle. */
  contains(a: Anchor, x: number, y: number): boolean {
    if (a.kind === 'region' && a.rect) {
      const [x0, y0, x1, y1] = a.rect
      return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1)
    }
    const p = this.ringOf(a)
    return Math.hypot(x - p.x, y - p.y) <= a.r
  }

  /* Where the interaction circle is: the anchor's spot plus the offset the map maker set. */
  ringOf(a: Anchor): { x: number; y: number } {
    const p = this.spotOf(a)
    if (!a.ring) return p
    return { x: p.x + a.ring[0], y: p.y + a.ring[1] }
  }

  /* The nearest anchor the player can walk up to and press a button at. */
  nearestInteractive(x: number, y: number): Anchor | null {
    let best: Anchor | null = null
    let bestD = Infinity
    for (const a of this.all) {
      if (a.kind !== 'point' && a.kind !== 'post' && a.kind !== 'door') continue
      // Use the same circle `contains` uses. Otherwise a moved ring would show the prompt at one
      // distance and refuse it at another.
      const p = this.ringOf(a)
      const d = Math.hypot(x - p.x, y - p.y)
      if (d <= a.r && d < bestD) { bestD = d; best = a }
    }
    return best
  }

  /* Every region and trigger the point is inside, not only the nearest. An atmosphere region and a
   * quest trigger can overlap, and both need to know the player is there. */
  regionsAt(x: number, y: number): Anchor[] {
    return this.all.filter((a) => (a.kind === 'region' || a.kind === 'trigger') && this.contains(a, x, y))
  }

  /* Where the player should stand after coming through a door. If the named anchor is missing it
   * tries the spawn anchor, then the map's spawn point, and never 0,0, because that's inside the
   * rock. */
  arrival(at: string | undefined, spawn: [number, number]): { x: number; y: number; facing?: string } {
    // Go through standAt, so a door that leads to a station puts the player on the floor beside it
    // and not on top of it.
    const a = at ? this.get(at) : undefined
    if (a) return this.standAt(a)
    if (at) console.warn(`[anchors] ${this.mapId}: no arrival anchor "${at}", using spawn`)
    const s = this.ofKind('spawn')[0]
    if (s) return this.standAt(s)
    return { x: spawn[0], y: spawn[1] }
  }
}
