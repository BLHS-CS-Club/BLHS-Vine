// Picks the loading cover the player sees between one place and the next, based on where they're
// going.
import type { CoverVoice, TransitionSpec } from '../../app/transitions'
import { compositionCache, slotOfMap } from '../world/composition'
import { placeOfMap } from '../roster/roster'

// The maps the player has already arrived at in this sitting. They're kept in session storage with
// a timestamp.
const SEEN_KEY = 'blhs_seen_v1'
export const SESSION_MS = 45 * 60 * 1000   // A bit longer than one advisory period.

type SeenRow = { at: number }

const readSeen = (): Record<string, SeenRow> => {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as Record<string, SeenRow>
    const now = Date.now()
    const live: Record<string, SeenRow> = {}
    for (const [k, v] of Object.entries(j)) if (now - v.at < SESSION_MS) live[k] = v
    return live
  } catch { return {} }
}

const writeSeen = (rows: Record<string, SeenRow>) => {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(rows)) } catch { /* Private browsing can block storage. */ }
}

/** True if the player arrived at this map within the current session window. */
export function seenThisSession(mapId: string): boolean {
  return !!readSeen()[mapId]
}

export function markSeen(mapId: string) {
  const rows = readSeen()
  rows[mapId] = { at: Date.now() }
  writeSeen(rows)
}

/** The proof scripts and the tests need to start fresh. */
export function clearSeen() { try { sessionStorage.removeItem(SEEN_KEY) } catch { } }

// What kind of arrival a destination is, worked out from the world layout and the roster.
export type CoverClass = 'arrival' | 'inside' | 'crossing'

export function coverClassOf(mapId: string): CoverClass {
  const c = compositionCache()
  if (c && slotOfMap(c, mapId)) return 'arrival'
  const place = placeOfMap(mapId)
  if (place) return place.arrival === mapId ? 'arrival' : 'inside'
  return 'crossing'
}

// The four cover pictures a destination can use.
const ART_PORT = '/art/ui/loading-port.png'
const ART_MAW = '/art/ui/loading-maw.png'
const ART_ISLANDS = '/art/ui/loading-islands.png'
const ART_VOYAGE = '/art/ui/loading-voyage.png'

/** Covers picked by hand for specific destinations. These win over the cover the code would pick. */
const COVER_ART: Record<string, string> = {
  /* The player reaches the Central Island by boat at a dock, so its cover is the harbor, not the
   * islands seen from the sky. */
  hub: ART_PORT,
  'hub-a2': ART_PORT,
  /* The Maw's cover is the room's own painting, since that's where the player is going. */
  'panther-maw': '/maps-painted/panther-maw/scene.png',
}

// The name shown on a map's cover, for maps the world doesn't give a name.
const MAP_TITLE: Record<string, string> = {
  'panther-maw': "The Panther's Maw",
}

const CLASS_ART: Record<CoverClass, string> = {
  arrival: ART_ISLANDS,
  inside: ART_MAW,
  crossing: ART_VOYAGE,
}

// The word every cover shows over its picture, with the spaces typed in by hand.
const ENTERING = 'E N T E R I N G'

/* Each map can have its own cover. The paths are guessed from the two bundle folders `PmapScene`
 * loads from, without checking first. The second folder is the art committed in this repo, so a map
 * with no cover yet only costs one failed image request. A destination picks a named cover with
 * `enter(map, cover=<name>)`. */
const BUNDLE_ROOTS = ['/maps-vendored', '/maps-painted']

export function bundleCovers(mapId: string, named?: string): string[] {
  if (!mapId) return []
  const leaf = named ? `covers/${named}.png` : 'cover.png'
  return BUNDLE_ROOTS.map((root) => `${root}/${mapId}/${leaf}`)
}

// The cover for a destination, plus whether this is the player's first time there this sitting.
export type CoverChoice = { spec: TransitionSpec; first: boolean; title: string }

export function coverFor(mapId: string, bundleTitle?: string, named?: string): CoverChoice {
  const first = !seenThisSession(mapId)
  const title = titleOfMap(mapId, bundleTitle)
  // Every door shows the painted cover every time. `first` still says if it's a real first arrival.
  const voice: CoverVoice = coverClassOf(mapId)
  // There's no `holdMs` here, so the cover uses the shared minimum time in `transitions.tsx`.
  return {
    spec: {
      kind: 'scene',
      title: title.toUpperCase(),
      /* Try the destination's own picture first, then the hand-picked table, then the art for its
       * kind of arrival. That last one always exists. */
      images: bundleCovers(mapId, named),
      image: COVER_ART[mapId] ?? CLASS_ART[voice],
      kicker: ENTERING,
      voice,
    },
    first,
    title,
  }
}

/* Passing through a map isn't arriving there. The first leg of a voyage passes through the dock's
 * map, and a full arrival card there would look like a second trip. So this is a short fade with no
 * title, kicker, fact or picture. */
export function passingCover(): CoverChoice {
  return {
    spec: { kind: 'fade', holdMs: 240, fact: false },
    first: false,
    title: '',
  }
}

export function ceremonyCover(title: string): CoverChoice {
  return {
    spec: {
      kind: 'scene',
      title: title.toUpperCase(),
      holdMs: 2400,
      image: ART_ISLANDS,
      kicker: ENTERING,
      voice: 'ceremony',
      fact: false,
    },
    first: true,
    title,
  }
}

/** The name a player sees for a map. Never show the map's id. */
export function titleOfMap(mapId: string, bundleTitle?: string): string {
  const c = compositionCache()
  const slot = c ? slotOfMap(c, mapId) : undefined
  if (slot?.title) return slot.title
  /* A title set in the world layout always wins. Next comes this table, so a map the game knows the
   * name of uses that name instead of the name of the place it's inside. After that comes the
   * bundle's own title. */
  if (MAP_TITLE[mapId]) return MAP_TITLE[mapId]
  if (bundleTitle) return bundleTitle
  const place = placeOfMap(mapId)
  if (place?.name) return place.name
  /* If nothing else has a name, turn the id into words: `panther-maw` becomes "Panther Maw". The
   * raw id never shows on screen. */
  return mapId.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}
