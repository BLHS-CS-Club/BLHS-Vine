/* Which maps sit on the ocean and where, plus the code that loads and checks that world data. */
import type { PlaceId } from '../roster/roster'

/* The seven states a slot on the water can be in. */
export type SlotState =
  | 'rumour'      // A reserved spot with no map. Shows as a rumour.
  | 'rising'      // A map exists and is arriving. Plays its effect once.
  | 'misty'       // Placed, but the player hasn't seen it.
  | 'discovered'  // The ship came close enough to find it.
  | 'available'   // A program here can be picked for a time slot.
  | 'active'      // A token is committed to something here.
  | 'completed'   // Finished.

export const SLOT_STATES: SlotState[] = [
  'rumour', 'rising', 'misty', 'discovered', 'available', 'active', 'completed',
]

/** A point in the ocean's own screen space, before any camera transform. */
export type WorldPt = { x: number; y: number }

/* Where a voyage ties up. It's on the water, not on any painting. */
export type Berth = WorldPt & {
  /* The berth's name, so a route can steer to a name instead of a coordinate. */
  name?: string
  /** The direction the ship ends up facing, as one of the eight compass words the walk code uses. */
  facing?: string
  /**
   * The same direction as an angle, in degrees clockwise from north. Use this one when it's there.
   * Eight compass words can't line the ship up with a coast that runs at 23 degrees, so MAPVIS also
   * keeps `facing` set to the nearest of the eight for code that ignores this.
   */
  bearing?: number
  /** Where the ship aims before the final docking move. If it's missing, the ship goes straight in. */
  approach?: WorldPt
  /** The anchor in the arrival map where the player is put after stepping off. */
  at?: string
}

/* A named mark placed anywhere on the water, outside any painting. */
export type WorldMark = WorldPt & {
  name: string
  kind: 'berth' | string
  label?: string
  facing?: string
  /**
   * The same direction as an angle, in degrees clockwise from north. Use this one when it's there.
   * Eight compass words can't line the ship up with a coast that runs at 23 degrees, so MAPVIS also
   * keeps `facing` set to the nearest of the eight for code that ignores this.
   */
  bearing?: number
  /** The slot this mark belongs to, if it belongs to one. */
  island?: string
  /** The anchor in the arrival map where the player is put after stepping off. */
  at?: string
  r?: number
}

export type WorldSlot = {
  /** The map this slot holds. It's missing for a slot that's empty on purpose. */
  map?: string
  /** The roster place. Discovery and exposure are counted against this. */
  place?: PlaceId
  /** The name the player reads. For a rumour, it's the hint the chart shows. */
  title: string
  /** Where the slot sits on the ocean. */
  at: WorldPt
  /* The size of the painting itself, which is smaller than the canvas around it. */
  footprint: { w: number; h: number }
  /* The painting's top-left corner inside its own canvas. If it's missing, the painting is
   * centered. */
  origin?: WorldPt
  /* The whole canvas the engine decodes. Memory cost is worked out from this. */
  canvas?: { w: number; h: number }
  state: SlotState
  /* How many placed objects this map has. They're the part of its memory cost that isn't the
   * painting. If it's missing, it counts as the hub's 94. */
  placements?: number
  /* How close the ship has to be for this map to stay loaded in memory. */
  release: number
  /* How close the ship has to come before this counts as discovered. */
  discover?: number
  /** Where a voyage arrives. It's missing until someone places a berth off the painting. */
  berth?: Berth
}

/* Named stretches of water, so code can ask about a region by name. */
export type SeaRegionKind = 'sailable' | 'mist' | 'shallow' | 'forbidden' | 'ambience'

export type SeaRegion = {
  name: string
  label?: string
  kind: SeaRegionKind
  /** A box lined up with the axes, in ocean space. */
  rect: { x: number; y: number; w: number; h: number }
}

export type WorldComposition = {
  /* The version a save records, so a resume can refuse a position saved in an older world. */
  version: number
  /** Where a run starts when nothing else says where, and where a graduate is sent back to. */
  home?: { slot: string; }
  slots: WorldSlot[]
  regions?: SeaRegion[]
  /** The marks placed freely on the water, berths included, each one findable by name. */
  marks?: WorldMark[]
  /** Who wrote this data, so a bundle from the platform can be told apart from others. */
  source?: string
}

/* The world built into the game, used when no world data can be fetched. */
export const FALLBACK: WorldComposition = {
  version: 1,
  source: 'hand-written, engine-side, pending BRIEF-MAPVIS-W2 item 1',
  home: { slot: 'home-island' },
  slots: [
    {
      /* The published hub, with its painted area measured from the export. */
      map: 'hub', place: 'home-island', title: 'Bonney Lake High School',
      at: { x: 0, y: 0 },
      footprint: { w: 669, h: 377 }, origin: { x: 7, y: 194 }, canvas: { w: 688, h: 640 },
      placements: 94,
      state: 'available', release: 1400, discover: 520,
      /* The berth and its approach point, both in water deep enough for the ship to float. */
      berth: { x: 228, y: 177, facing: 'south', approach: { x: 300, y: 258 } },
    },
    {
      /* The same island as a local file, for running without the platform. Its painting is cropped
       * to 465x335 at x 92, and the data says so instead of assuming the whole canvas is painting. */
      map: 'hub-a2', place: 'home-island', title: 'Bonney Lake High School',
      at: { x: 0, y: 0 },
      footprint: { w: 465, h: 335 }, origin: { x: 92, y: 0 }, canvas: { w: 688, h: 384 },
      placements: 0,
      state: 'available', release: 1400, discover: 520,
      berth: { x: 76, y: 202, facing: 'south', approach: { x: 200, y: 300 } },
    },
    {
      /* The Maw isn't on the water. It's the same place as the hub, reached through a door, so it
       * has no berth and `seaSlots` leaves it off the chart. Keeping one position per place stops
       * the same painting being drawn twice on the chart. */
      map: 'panther-maw', place: 'home-island', title: 'the Panther’s Maw, inside the mountain',
      at: { x: 0, y: 0 }, footprint: { w: 512, h: 512 }, canvas: { w: 512, h: 512 }, placements: 0,
      state: 'available', release: 1400,
    },
    {
      /* A slot with no map yet, saving the spot where a future island will rise. */
      place: 'stadium', title: 'the stadium',
      at: { x: 1480, y: -260 }, footprint: { w: 688, h: 377 },
      state: 'rumour', release: 1400, discover: 520,
    },
  ],
  regions: [
    { name: 'home_water', label: 'the home water', kind: 'sailable', rect: { x: -900, y: -700, w: 2000, h: 1500 } },
    { name: 'the_reach', label: 'the far water', kind: 'sailable', rect: { x: 1100, y: -900, w: 1400, h: 1600 } },
    { name: 'the_grey', label: 'the fog', kind: 'mist', rect: { x: -2600, y: -2200, w: 1600, h: 4400 } },
  ],
}

/* Fetch the world once, cache it, and never throw. There's always a world to fall back on. */
let cached: WorldComposition | null = null
let inflight: Promise<WorldComposition> | null = null
let lastFaults: WorldFault[] = []
let lastOrigin = ''

export function compositionCache(): WorldComposition | null { return cached }

/** What was wrong with the world data that loaded, for the proof scripts and the report. */
export function compositionReport(): { origin: string; faults: WorldFault[] } {
  return { origin: lastOrigin, faults: lastFaults }
}

/** For tests and the proof scripts: install world data without fetching it. */
export function setComposition(c: WorldComposition) {
  cached = c; inflight = null; lastFaults = []; lastOrigin = 'installed'
}

/* Where the platform lives, from one environment variable. Empty means there's no platform. */
export const mapvisHost = (): string =>
  (import.meta.env?.VITE_MAPVIS_URL || '').replace(/\/+$/, '')

/* Which world data to read. `?world=local` forces the copy in this repo. */
export const worldUrl = (): string => {
  const asked = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('world') : null
  if (asked === 'local') return LOCAL_WORLD
  if (asked === 'platform') { const host = mapvisHost(); return host ? `${host}/api/v1/world` : VENDORED_WORLD }
  if (asked) return asked
  // The copy vendored at build time, so a student's browser never has to ask the platform.
  return VENDORED_WORLD
}

export const LOCAL_WORLD = '/world/composition.json'
export const VENDORED_WORLD = '/world-vendored/composition.json'

export async function loadComposition(url = worldUrl()): Promise<WorldComposition> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    /* Try the url that was asked for first, then the copy vendored at build time, then the copy
     * committed in this repo, and last the built-in FALLBACK. */
    const order = url === LOCAL_WORLD ? [LOCAL_WORLD]
      : url === VENDORED_WORLD ? [VENDORED_WORLD, LOCAL_WORLD]
        : [url, VENDORED_WORLD, LOCAL_WORLD]
    for (const src of order) {
      const doc = await tryWorld(src)
      if (doc) { cached = doc; publish(); return doc }
    }
    lastOrigin = 'built in'
    console.warn('[world] nothing answered, running on the built-in composition')
    cached = FALLBACK
    publish()
    return FALLBACK
  })()
  return inflight
}

/* Put the world the running game loaded on `window`, so you can read it from the console. */
const publish = () => {
  if (typeof window === 'undefined') return
  ;(window as unknown as { __world?: unknown }).__world = {
    get composition() { return cached },
    get report() { return { origin: lastOrigin, faults: lastFaults } },
  }
}

async function tryWorld(url: string): Promise<WorldComposition | null> {
  let j: WorldComposition
  try {
    const r = await fetch(url)
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null
    j = (await r.json()) as WorldComposition
  } catch { return null }
  /* `Array.isArray(slots)` only checks the shape. It doesn't catch a map placed twice, a rumour
   * that holds a map, or a footprint of zero, so `compositionFaults` checks those next. */
  if (!Array.isArray(j?.slots)) return null

  /* A faulty slot is dropped and the rest of the data is kept. */
  const faults = compositionFaults(j)
  if (!faults.length) {
    lastFaults = []; lastOrigin = url
    return j
  }
  const bad = new Set(faults.map((f) => f.slot).filter((i): i is number => i !== undefined))
  const kept = j.slots.filter((_, i) => !bad.has(i))
  const line = `[world] ${url}: ${faults.length} fault${faults.length > 1 ? 's' : ''}, `
    + `${bad.size} of ${j.slots.length} slot${j.slots.length === 1 ? '' : 's'} dropped\n`
    + faults.map((f) => `  ${f.key}: ${f.why}`).join('\n')
  if (!kept.length) {
    console.error(`${line}\n[world] nothing survived, so this document is refused whole`)
    lastFaults = faults
    return null
  }
  /* Use error, not warn. Browsers print warnings for small things like old CSS properties, so a
   * warning here is easy to miss while slots are being dropped from the world. */
  console.error(line)
  lastFaults = faults; lastOrigin = url
  return { ...j, slots: kept }
}

/* Every mark on the water, keyed by name and by island, with each slot's berth added in too. */
export function marksOf(c: WorldComposition): Map<string, WorldMark> {
  const out = new Map<string, WorldMark>()
  for (const m of c.marks ?? []) {
    if (!m || typeof m.name !== 'string' || !m.name) continue
    if (!isFinite(Number(m.x)) || !isFinite(Number(m.y))) continue
    out.set(m.name, m)
    /* Also key the same mark by its island, because members will write routes like "sail to the
     * hub". */
    if (m.island && !out.has(m.island)) out.set(m.island, m)
  }
  for (const s of c.slots) {
    if (!s.berth?.name || out.has(s.berth.name)) continue
    out.set(s.berth.name, { ...s.berth, name: s.berth.name, kind: 'berth', island: s.map })
  }
  return out
}

/** A named berth, wherever it was placed, or undefined. Nothing is made up. */
export const markByName = (c: WorldComposition, name: string): WorldMark | undefined =>
  marksOf(c).get(name)

/** Every name a route can end at, for the error message that lists them. */
export const markNames = (c: WorldComposition): string[] => [...marksOf(c).keys()].sort()

/* The berth a name points to, in the shape the ship's docking code takes. */
export function berthOf(c: WorldComposition, name: string): Berth | undefined {
  const own = c.slots.find((s) => s.berth?.name === name)?.berth
  if (own) return own
  const m = markByName(c, name)
  if (!m || m.kind !== 'berth') return undefined
  return {
    x: m.x,
    y: m.y,
    name: m.name,
    ...(m.facing ? { facing: m.facing } : {}),
    /* Pass the exact angle along with the compass word. Without it, a berth turned to any angle
     * would dock at the nearest of eight directions, and the game would lose the heading the chart
     * was drawn with. */
    ...(Number.isFinite(Number(m.bearing)) ? { bearing: Number(m.bearing) } : {}),
    ...(m.at ? { at: m.at } : {}),
  }
}

/* `approachTo` below gives the crossing to a berth: the loose marks around it, farthest out first,
 * then the berth itself. */
/* The offshore mark an arrival by sea starts from, when the world names one. */
export const FAR_START = 'the_far_start'
export const farStart = (c: WorldComposition): WorldMark | undefined => {
  const m = marksOf(c).get(FAR_START)
  return m && m.kind !== 'berth' ? m : undefined
}

export function approachTo(c: WorldComposition, berthName: string): WorldMark[] {
  const all = marksOf(c)
  const berth = all.get(berthName)
  if (!berth || berth.kind !== 'berth') return []

  /* `marksOf` stores a mark twice, by name and by island, so skip names already seen. Otherwise a
   * mark with an island would show up twice in the crossing and the ship would sail the same water
   * two legs in a row. */
  const seen = new Set<string>()
  const berths: WorldMark[] = []
  const loose: WorldMark[] = []
  for (const m of all.values()) {
    if (seen.has(m.name)) continue
    seen.add(m.name)
    ;(m.kind === 'berth' ? berths : loose).push(m)
  }

  const d = (a: WorldMark, b: WorldMark) => Math.hypot(a.x - b.x, a.y - b.y)
  const mine = loose.filter((m) => {
    let best = berth
    for (const b of berths) if (d(m, b) < d(m, best)) best = b
    return best.name === berth.name
  })

  mine.sort((a, b) => d(b, berth) - d(a, berth))
  /* The far start always goes first, however far it is, because the ship is already there. Starting
   * the crossing anywhere else would sail the ship away from the island before sailing it back. */
  const fs = mine.findIndex((m) => m.name === FAR_START)
  if (fs > 0) mine.unshift(...mine.splice(fs, 1))
  return [...mine, berth]
}

/* Which berth a route name points to. It matches a berth name, the island it belongs to, or either
 * one with _approach on the end. */
const slug = (s: string | undefined): string => (s ?? '').replace(/-/g, '_')
export function berthOfRoute(c: WorldComposition, name: string): string | undefined {
  const all = marksOf(c)
  /* Slug the caller's key too. A member types the hyphenated map id they see in MAPVIS, like
   * `atc-1`, but every id compared here is already slugged to `atc_1`, so the raw key wouldn't
   * match. */
  const asBerth = (raw: string): string | undefined => {
    if (!raw) return undefined
    const key = slug(raw)
    /* Try the name exactly as typed first, then slugged. A mark is keyed by whatever its author
     * wrote, so slugging a name that was already right must not lose it. */
    const m = all.get(raw) ?? all.get(key)
    if (m?.kind === 'berth') return m.name
    const s = c.slots.find((q) => q.berth?.name && (slug(q.map) === key || slug(q.place) === key))
    return s?.berth?.name
  }
  const direct = asBerth(name)
  if (direct) return direct
  const m = /^(.+)_approach$/.exec(name)
  return m ? asBerth(m[1]) : undefined
}

/** Every berth a crossing can be sent to, for the error message that lists them. */
export const approachNames = (c: WorldComposition): string[] =>
  [...marksOf(c).values()]
    .filter((m) => m.kind === 'berth')
    .map((m) => m.name)
    .filter((n, i, a) => a.indexOf(n) === i)
    .sort()

/* Pure helper questions the scene asks about the world, so the scene never redoes the math itself. */

export const slotOfMap = (c: WorldComposition, map: string | undefined): WorldSlot | undefined =>
  map ? c.slots.find((s) => s.map === map) : undefined

export const slotOfPlace = (c: WorldComposition, place: string | undefined): WorldSlot | undefined =>
  place ? c.slots.find((s) => s.place === place && !!s.berth) ?? c.slots.find((s) => s.place === place) : undefined

/** Every slot that gets drawn on the water. That's one per place, and rooms don't count. */
export const seaSlots = (c: WorldComposition): WorldSlot[] => {
  const seen = new Set<string>()
  return c.slots.filter((s) => {
    /* A slot with no berth whose place is already on the water is a room inside that place. Don't
     * draw a second dot for it. */
    const key = s.place ?? s.map ?? s.title
    if (!s.berth && seen.has(key)) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Half the diagonal of the painted area. This is the radius a footprint really covers. */
export const slotRadius = (s: WorldSlot): number =>
  Math.hypot(s.footprint.w, s.footprint.h) / 2

/* The center of the painting inside its own canvas, in canvas pixels. */
export const paintedCentre = (s: WorldSlot, canvasW: number, canvasH: number): WorldPt =>
  s.origin
    ? { x: s.origin.x + s.footprint.w / 2, y: s.origin.y + s.footprint.h / 2 }
    : { x: canvasW / 2, y: canvasH / 2 }

/** The distance from the ship to a slot's painted edge. It's negative inside the footprint. */
export function distanceTo(s: WorldSlot, p: WorldPt): number {
  /* Use a box test, not a circle. A circle big enough for the widest island would discover it from
   * open water along its short side. */
  const dx = Math.max(Math.abs(p.x - s.at.x) - s.footprint.w / 2, 0)
  const dy = Math.max(Math.abs(p.y - s.at.y) - s.footprint.h / 2, 0)
  const out = Math.hypot(dx, dy)
  if (out > 0) return out
  return -Math.min(s.footprint.w / 2 - Math.abs(p.x - s.at.x), s.footprint.h / 2 - Math.abs(p.y - s.at.y))
}

/**
 * Which slots are close enough to keep in memory. Maps already loaded get a little extra range
 * (hysteresis) so they don't flicker in and out, and the list is trimmed to the budget.
 */
export function residentSlots(
  c: WorldComposition, p: WorldPt, held: ReadonlySet<string> = new Set(),
): WorldSlot[] {
  const HYST = 0.25
  const near = c.slots.filter((s) => {
    if (!s.map) return false
    const d = distanceTo(s, p)
    return held.has(s.map) ? d <= s.release * (1 + HYST) : d <= s.release
  })
  return trimToBudget(near, p)
}

/** The slots whose discovery radius the ship is inside right now. */
export function discoveredSlots(c: WorldComposition, p: WorldPt): WorldSlot[] {
  return c.slots.filter((s) => distanceTo(s, p) <= (s.discover ?? s.release / 2))
}

/** The named sea region a point is in, or undefined over unnamed water. */
export const regionAt = (c: WorldComposition, p: WorldPt): SeaRegion | undefined =>
  (c.regions ?? []).find((r) =>
    p.x >= r.rect.x && p.x <= r.rect.x + r.rect.w && p.y >= r.rect.y && p.y <= r.rect.y + r.rect.h)

/* What a loaded map costs in memory, worked out from the layers it decodes. */
export const PAINTING_PX_CEILING = 265_000
export const BYTES_PER_PX = 4
/**
 * Scene and levels are always there, plus occluders when a map has any. So a map has at least two
 * layers, and this counts three.
 */
export const MASK_LAYERS = 3
/** Measured from the hub: 1,391,768 asset pixels across its 94 placements. */
export const PX_PER_PLACEMENT = 14_806
/** The hub's own placement count, used for any slot that doesn't give one. */
export const DEFAULT_PLACEMENTS = 94

/* What one slot costs in bytes: its canvas layers plus what its placements weigh. */
export const slotBytes = (s: WorldSlot): number => {
  const canvas = s.canvas ? s.canvas.w * s.canvas.h : s.footprint.w * s.footprint.h
  const assets = (s.placements ?? DEFAULT_PLACEMENTS) * PX_PER_PLACEMENT
  return (canvas * MASK_LAYERS + assets) * BYTES_PER_PX
}

/** What a set of loaded maps costs, so a budget number can be worked out exactly. */
export const residencyBytes = (slots: WorldSlot[]): number =>
  slots.reduce((n, s) => n + slotBytes(s), 0)

/* How much texture memory the game lets itself use on a school Chromebook. */
export const TEXTURE_BUDGET_BYTES = 256 * 1024 * 1024

export const overBudget = (slots: WorldSlot[]): boolean =>
  residencyBytes(slots) > TEXTURE_BUDGET_BYTES

/** How many maps like this one fit inside the texture budget at once. */
export const maxResident = (s: WorldSlot): number =>
  Math.floor(TEXTURE_BUDGET_BYTES / slotBytes(s))

/* Keeps the nearest maps and drops the rest once the loaded set is over budget. */
export function trimToBudget(slots: WorldSlot[], p: WorldPt): WorldSlot[] {
  if (!overBudget(slots)) return slots
  const byNear = [...slots].sort((a, b) => distanceTo(a, p) - distanceTo(b, p))
  const kept: WorldSlot[] = []
  let bytes = 0
  for (const s of byNear) {
    const n = slotBytes(s)
    if (bytes + n > TEXTURE_BUDGET_BYTES) continue
    kept.push(s); bytes += n
  }
  /* The nearest map always stays loaded, even if it's over budget by itself. A student standing on
   * a painting the engine refused to load gets a black screen, and a slow game is better than that. */
  if (!kept.length && byNear.length) kept.push(byNear[0])
  return slots.filter((s) => kept.includes(s))
}

/* What's wrong with a world's data, checked before the game trusts it. */
/* `slot` is the index of the faulty slot. If it's missing, the fault is about the whole world. */
export type WorldFault = { key: string; why: string; slot?: number }

export function compositionFaults(c: WorldComposition, knownPlaces?: ReadonlySet<string>): WorldFault[] {
  const out: WorldFault[] = []
  const seenMap = new Set<string>()
  c.slots.forEach((s, slot) => {
    const key = s.map ?? s.title
    if (s.map) {
      if (seenMap.has(s.map)) out.push({ key, slot, why: `map "${s.map}" is placed twice` })
      seenMap.add(s.map)
    }
    if (!s.map && s.state !== 'rumour')
      out.push({ key, slot, why: `holds no map, so its only honest state is "rumour" and it says "${s.state}"` })
    if (s.map && s.state === 'rumour')
      out.push({ key, slot, why: `holds map "${s.map}" and still reads as a rumour` })
    if (!s.footprint || s.footprint.w <= 0 || s.footprint.h <= 0)
      out.push({ key, slot, why: 'has no painted extent, so discovery cannot be measured off it' })
    else if (s.footprint.w * s.footprint.h > PAINTING_PX_CEILING * 1.02)
      out.push({ key, slot, why: `claims ${s.footprint.w}x${s.footprint.h}, past the ${PAINTING_PX_CEILING} pixel ceiling one generation can hold` })
    if (s.discover !== undefined && s.discover > s.release)
      out.push({ key, slot, why: 'is discovered further out than it is resident, so it is discovered as a blank' })
    if (knownPlaces && s.place && !knownPlaces.has(s.place))
      out.push({ key, slot, why: `names place "${s.place}", which is not on the roster` })
  })
  /* This isn't a slot fault, so it has no index and nothing gets dropped. */
  if (c.home && !c.slots.some((s) => (s.place ?? s.map) === c.home!.slot))
    out.push({ key: 'home', why: `names "${c.home.slot}", which is not a slot` })
  return out
}
