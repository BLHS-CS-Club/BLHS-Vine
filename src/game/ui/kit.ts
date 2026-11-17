/* Loads the UI kit art that the platform publishes. This is the only file in the game that reads
 * it. */

/* The kit record as it arrives over the network. Anything the platform might leave out is optional. */

/**
 * The four edge insets in source pixels. That's the unit `border-image-slice` uses when there's no
 * percent sign, and the unit Pixi's NineSliceSprite takes.
 */
export type KitSlice = { top: number; right: number; bottom: number; left: number }

/**
 * The six kinds of region. Call them regions, never slots, because a slot already means an island's
 * berth on the sea in `src/game/world/composition.ts`, in about thirty places.
 */
export type KitRegionKind = 'text' | 'number' | 'picture' | 'fill' | 'face' | 'press'

/**
 * A named rectangle on a piece that the engine fills with something, measured in the piece's own
 * source pixels.
 */
export type KitRegion = {
  name: string
  kind: KitRegionKind
  x: number; y: number; w: number; h: number
  /** How a text region wraps. */
  wrap?: string
  /** What a text region does when the text doesn't fit: grow, clip or ellipsis. */
  overflow?: string
  /** How a picture fits inside its opening. */
  fit?: string
  /* Required on a picture, with no default. The shipped portrait is anchored to the bottom in
   * `ui-kit.css`, and a region that centers its content makes every character float above the
   * bottom of their box. */
  valign?: string
  /** Which way a fill grows. */
  axis?: string
  /** Whether a fill tiles or stretches. A stretched rope looks smeared. */
  mode?: string
}

/**
 * One rectangle cut out of a sheet. Small icons are drawn together in one job, because the art
 * can't be generated under 192 pixels and one job keeps their line weight the same. A face picks
 * one icon back out.
 */
export type KitFace = { name: string; x: number; y: number; w: number; h: number }

export type KitPiece = {
  /** The platform's own name for the piece. This isn't always the same as the game's handle. */
  name: string
  type: string
  title?: string
  description?: string
  /** The image file's real size in pixels, so code can check the slices fit inside it. */
  w: number
  h: number
  status?: string
  core?: boolean
  published?: boolean
  regions?: KitRegion[]
  faces?: KitFace[]
  /* Must be true for every paper panel. `border-image` leaves the middle empty by default, so
   * without it a panel draws as a ring around a hole. `highlight_edge` is the one piece that wants
   * false, because it's meant to be a ring. */
  fill?: boolean
  /** CSS pixels per source pixel, so the drawn thickness is known instead of guessed. */
  scale?: number
  slice?: KitSlice
  /**
   * Horizontal and vertical, each one of stretch, repeat, round or space. Pixel art should use
   * round, never stretch.
   */
  repeat?: { x: string; y: string }
  /** A ready-made CSS block. It uses the game's handle, not the platform's name. */
  css?: string
  /** The image path, relative to the platform host. */
  src?: string
  /** The full content hash. This is what goes in `?v=`. */
  sha?: string
  crop?: unknown
  createdAt?: number
}

/* The kit is fetched once and cached, and loading never throws. A Chromebook on a filtered network
 * still gets a working game. */
let cached: KitPiece[] | null = null
let inflight: Promise<KitPiece[]> | null = null

/**
 * The platform's address, worked out the same way `PmapScene.tsx` does it for maps, so the game
 * only has one answer for where MAPVIS is. An empty string means there's no platform and nothing
 * gets fetched.
 */
export const mapvisHost = (): string =>
  (import.meta.env?.VITE_MAPVIS_URL || '').replace(/\/+$/, '')

export function kitCached(): KitPiece[] | null { return cached }

/* A counter that goes up when the kit arrives, so anything that drew the fallback can redraw. */
let generation = 0
const landed = new Set<() => void>()

/** Goes up each time the kit changes, so a React hook can use it as its state. */
export const kitGeneration = (): number => generation

/** Calls cb when the kit arrives, or when a test swaps it. Gives back a function that unsubscribes. */
export function onKitLanded(cb: () => void): () => void {
  landed.add(cb)
  return () => { landed.delete(cb) }
}

function announceKit(): void {
  generation++
  for (const cb of [...landed]) { try { cb() } catch { /* A broken listener shouldn't break the kit. */ } }
}

/** Puts a kit in place without fetching, for tests and the proof scripts. */
export function setKit(pieces: KitPiece[]) { cached = pieces; inflight = null; announceKit() }

/* Where the kit in use came from. An empty string means the vendored copy on the game's own site. */
let kitHost = ''
export const kitHostInUse = (): string => kitHost

/* Use the vendored kit first, so a student's browser never contacts the platform. The platform is
 * only used with ?kit=platform in the address. */
const wantPlatformKit = (): boolean =>
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('kit') === 'platform'

export async function loadKit(host = mapvisHost()): Promise<KitPiece[]> {
  if (cached) return cached
  if (inflight) return inflight
  inflight = (async () => {
    if (!wantPlatformKit()) {
      try {
        const r = await fetch('/ui-vendored/kit.json')
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          const j = (await r.json()) as { ui?: unknown }
          if (Array.isArray(j?.ui)) {
            cached = j.ui as KitPiece[]
            kitHost = ''
            warmPieces(cached, '')
            return cached
          }
        }
      } catch { /* Not vendored. The platform is only tried with ?kit=platform. */ }
      cached = []
      return cached
    }
    /* No host isn't an error. It's a build with no platform set up, so skip the fetch with no
     * warning and no wait. */
    if (!host) { cached = []; return cached }
    kitHost = host
    try {
      const r = await fetch(`${host}/api/v1/ui`)
      /* Check the content type too, the same as `PmapScene` does. A dev server answers a missing
       * file with index.html and status 200, so `r.ok` alone would let HTML through as JSON. */
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        const j = (await r.json()) as { ui?: unknown }
        if (Array.isArray(j?.ui)) {
          cached = j.ui as KitPiece[]
          warmPieces(cached, host)
          return cached
        }
      }
    } catch { /* The shipped art is the fallback. */ }
    cached = []
    return cached
  })()
  return inflight
}

/* Loads every piece's image at start-up, so it's already cached before CSS needs it. */
function warmPieces(pieces: KitPiece[], at: string): void {
  if (typeof Image === 'undefined') return
  for (const p of pieces) {
    const url = kitArtUrl(p, at)
    if (!url) continue
    const img = new Image()
    /* A failed preload isn't an error. The piece might be unpublished or the network filtered, and
     * both cases are handled above. */
    img.onerror = () => {}
    img.src = url
  }
}

/* A problem with one piece. Each bad piece is dropped by name on its own, and the rest still load. */
export type KitFault = { key: string; why: string }

/* A piece is either a stretchable surface or a sheet of art, or it gets refused. */
type KitKind = 'surface' | 'art'
type Verdict = { ok: true; handle: string; kind: KitKind } | { ok: false; why: string }

/** The handle the game uses for a piece, read out of the CSS that MAPVIS wrote for it. */
export const kitHandle = (p: KitPiece): string =>
  p.css?.match(/\.kit-surface-([A-Za-z0-9_-]+)/)?.[1] ?? p.name

const sliceFits = (s: KitSlice, w: number, h: number): boolean =>
  [s.top, s.right, s.bottom, s.left].every((n) => Number.isFinite(n) && n >= 0)
  && s.top + s.bottom < h && s.left + s.right < w

function classify(p: KitPiece): Verdict {
  const handle = kitHandle(p)
  if (p.slice) {
    if (!(p.w > 0 && p.h > 0))
      return { ok: false, why: `carries a slice and no size, so nothing can check it fits` }
    if (!sliceFits(p.slice, p.w, p.h)) {
      const s = p.slice
      return {
        ok: false,
        why: `slice ${s.top}/${s.right}/${s.bottom}/${s.left} does not fit inside ${p.w}x${p.h}`
          + ` (${s.top}+${s.bottom} must be under ${p.h}, ${s.left}+${s.right} under ${p.w}),`
          + ` so CSS would drop the border image with no error`,
      }
    }
    return { ok: true, handle, kind: 'surface' }
  }
  /* No slice and no CSS is fine for a sheet or a painting, but not for a piece with nothing at all.
   * `src` tells them apart, because a piece with no image was never generated. */
  if (p.css) return { ok: true, handle, kind: 'surface' }
  if (p.src && ((p.faces?.length ?? 0) > 0 || (p.regions?.length ?? 0) > 0))
    return { ok: true, handle, kind: 'art' }
  return { ok: false, why: 'has no css, no slice and no cut faces, so there is nothing to mount' }
}

/**
 * Lists every piece the kit can't use, with a reason a person can act on. It's a pure function, so
 * it can be tested without a page.
 */
export const kitFaults = (pieces: KitPiece[]): KitFault[] =>
  pieces.map((p) => ({ p, v: classify(p) }))
    .filter((x): x is { p: KitPiece; v: { ok: false; why: string } } => !x.v.ok)
    .map(({ p, v }) => ({ key: p.name, why: v.why }))

/* Turning the kit record into one stylesheet of art variables and border-image blocks. */

/** The full image URL on the platform, with the whole content hash on the end. */
export const kitArtUrl = (p: KitPiece, host: string): string | null => {
  if (!p.src) return null
  const path = p.src.split('?')[0]
  const v = p.sha ? `?v=${encodeURIComponent(p.sha)}` : ''
  return `${host}${path}${v}`
}

/* Swaps the platform's relative URL inside a published CSS block for the full one. */
const absolutise = (css: string, url: string): string =>
  css.replace(/url\(\s*(['"]?)(\/[^'")]*)\1\s*\)/g, `url('${url}')`)

/**
 * kitCss below builds the whole stylesheet. It's pure and exported, so a test can read it without a
 * page.
 */
/* Handles whose art is a shape, not a frame. Their picture is used, but not as a nine-slice. */
const SHAPES = new Set(['plank'])

/* Handles whose picture always comes from the art committed in this repo, never from the platform. */
const LOCAL_ART = new Set(['plank'])

export function kitCss(pieces: KitPiece[], host = kitHost): string {
  const tokens: string[] = []
  const blocks: string[] = []
  for (const p of pieces) {
    const v = classify(p)
    if (!v.ok) continue
    const url = kitArtUrl(p, host)
    /* Skip LOCAL_ART handles completely, with no variable and no block, so the `:root` in
     * tokens.css is the only thing that sets them. */
    if (LOCAL_ART.has(v.handle)) continue
    if (url) tokens.push(`  --kit-art-${v.handle}: url('${url}');`)
    if (v.kind !== 'surface') continue
    /* A plank is a shape, not a frame, so its picture is used but its nine-slice isn't. */
    if (SHAPES.has(v.handle)) continue
    if (p.css) { blocks.push(url ? absolutise(p.css, url) : p.css); continue }
    /* This is the one block built here instead of read from the platform, for a piece that has a
     * slice but no CSS. */
    const s = p.slice!
    const sc = p.scale && p.scale > 0 ? p.scale : 1
    const rep = `${p.repeat?.x ?? 'round'} ${p.repeat?.y ?? 'round'}`
    const fill = p.fill === false ? '' : ' fill'
    blocks.push(
      `.kit-surface-${v.handle} {\n`
      + `  border-style: solid;\n`
      + `  border-color: transparent;\n`
      /* The border width is a CSS variable, `--kit-slice-w-<handle>`, so a narrow box can shrink
       * it. A nine-slice sized for a wide panel eats most of a narrow one, since the socket frame
       * is 29px on each side. The art's own size is the default. */
      + `  border-width: var(--kit-slice-w-${v.handle}, ${s.top * sc}px `
      + `${s.right * sc}px ${s.bottom * sc}px ${s.left * sc}px);
`
      + `  border-image: var(--kit-art-${v.handle}${url ? `, url('${url}')` : ''})`
      + ` ${s.top} ${s.right} ${s.bottom} ${s.left}${fill} / 1 / 0 ${rep};\n}`,
    )
  }
  /* Pixel art must never be smoothed. This one rule covers every kit surface. */
  const preamble = `[class*='kit-surface-'] { image-rendering: var(--kit-pixel, pixelated); }`
  const root = tokens.length ? `:root {\n${tokens.join('\n')}\n}` : ''
  return [preamble, root, ...blocks].filter(Boolean).join('\n\n') + '\n'
}

/**
 * The id of the one style element this file owns. It gets replaced, not added to, so calling
 * `applyKit` twice can't stack two kits.
 */
export const KIT_STYLE_ID = 'mapvis-kit'

export function applyKit(pieces: KitPiece[], host = kitHost): void {
  if (typeof document === 'undefined') return
  for (const f of kitFaults(pieces)) console.warn(`[kit] refused "${f.key}": ${f.why}`)
  const css = kitCss(pieces, host)
  let el = document.getElementById(KIT_STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = KIT_STYLE_ID
    document.head.appendChild(el)
  }
  /* Move it to the end of the head so the platform's art variables win over the ones Vite added. */
  el.textContent = css
  document.head.appendChild(el)
  /* Tell everything that draws a cut face. The stylesheet updates the page by itself, but
   * `faceStyle` reads the cached record instead of a CSS variable. */
  announceKit()
}

/* Finding a piece and its named rectangles, so the layout follows the art when the art is redrawn. */
export const kitPiece = (pieces: KitPiece[], piece: string): KitPiece | undefined =>
  pieces.find((p) => p.name === piece || kitHandle(p) === piece)

export function kitSlot(pieces: KitPiece[], piece: string, region: string): KitRegion | undefined {
  return kitPiece(pieces, piece)?.regions?.find((r) => r.name === region)
}

/**
 * Finds one cut face on a sheet. A piece can publish faces in `faces`, as regions of kind `face`,
 * or both, so both places are checked.
 */
export function kitFace(pieces: KitPiece[], piece: string, face: string): KitFace | undefined {
  const p = kitPiece(pieces, piece)
  if (!p) return undefined
  const f = p.faces?.find((x) => x.name === face)
  if (f) return f
  const r = p.regions?.find((x) => x.kind === 'face' && x.name === face)
  return r ? { name: r.name, x: r.x, y: r.y, w: r.w, h: r.h } : undefined
}

/* Whether the platform's kit is used. It's on by default, and ?kit=0 or ?kit=off turns it off. */
export const kitOptedIn = (search = typeof location === 'undefined' ? '' : location.search): boolean => {
  const v = new URLSearchParams(search).get('kit')
  return !(v === '0' || v === 'off')
}
