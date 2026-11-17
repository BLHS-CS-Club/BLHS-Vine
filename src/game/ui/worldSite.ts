// Works out where a card or panel drawn in the world should go, and what it must not cover.

export type Rect = { x: number; y: number; w: number; h: number }
export type Size = { w: number; h: number }

/** Which side of the keep-clear area the content moves to. */
export type SiteSide = 'above' | 'below' | 'left' | 'right' | 'over'

export type WorldUiSite = {
  /** The name the map maker gave it. It follows the same naming rules as an anchor. */
  name: string
  /** Where a panel is allowed to draw, in the map's own pixels. */
  rect: Rect
  /** What the panel must not cover, like a face, a sign, or the thing the panel is about. */
  keepClear?: Rect
  /**
   * The order of sides to try. The first one that fits wins, so a map maker can say "above the
   * head, and beside it if there's no room".
   */
  prefer?: SiteSide[]
  /** Space between the content and the edge of the keep-clear area. */
  gap?: number
}

export type SitePlacement = {
  x: number
  y: number
  w: number
  h: number
  side: SiteSide
  /** True if the content had to be pushed to stay inside the view. */
  clamped: boolean
  /** True when the site isn't on screen, so this spot is the best available, not a good one. */
  fallback: boolean
}

const DEFAULT_ORDER: SiteSide[] = ['above', 'below', 'right', 'left', 'over']

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const inside = (a: Rect, b: Rect): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h

/**
 * Centers something of size `over` inside a span on one axis, so a card sits centered on what it's
 * about.
 */
const centre = (pos: number, span: number, over: number) => Math.round(pos + (span - over) / 2)

function candidate(site: WorldUiSite, content: Size, side: SiteSide): Rect {
  const clear = site.keepClear
  const gap = site.gap ?? 4
  if (!clear || side === 'over') {
    return {
      x: centre(site.rect.x, site.rect.w, content.w),
      y: centre(site.rect.y, site.rect.h, content.h),
      w: content.w, h: content.h,
    }
  }
  switch (side) {
    case 'above': return { x: centre(clear.x, clear.w, content.w), y: clear.y - gap - content.h, w: content.w, h: content.h }
    case 'below': return { x: centre(clear.x, clear.w, content.w), y: clear.y + clear.h + gap, w: content.w, h: content.h }
    case 'left': return { x: clear.x - gap - content.w, y: centre(clear.y, clear.h, content.h), w: content.w, h: content.h }
    default: return { x: clear.x + clear.w + gap, y: centre(clear.y, clear.h, content.h), w: content.w, h: content.h }
  }
}

const clampInto = (r: Rect, view: Rect): Rect => ({
  w: r.w, h: r.h,
  x: Math.round(Math.min(Math.max(r.x, view.x), Math.max(view.x, view.x + view.w - r.w))),
  y: Math.round(Math.min(Math.max(r.y, view.y), Math.max(view.y, view.y + view.h - r.h))),
})

/** Where to draw content at a site, given what the camera can see right now. */
export function placeAtSite(site: WorldUiSite, content: Size, view: Rect): SitePlacement {
  const order = site.prefer?.length ? site.prefer : DEFAULT_ORDER
  const clear = site.keepClear
  const siteVisible = overlaps(site.rect, view)

  const clean: { r: Rect; side: SiteSide }[] = []
  for (const side of order) {
    const r = candidate(site, content, side)
    // `over` ignores the keep-clear area, so it's only used when the map maker asks for it.
    if (clear && (side === 'over' || overlaps(r, clear))) continue
    clean.push({ r, side })
    if (inside(r, view) && inside(r, site.rect)) {
      return { ...r, side, clamped: false, fallback: !siteVisible }
    }
  }

  // Nothing fit completely, so slide each side into view and take the first one that still doesn't
  // cover the face.
  for (const c of clean) {
    const at = clampInto(c.r, view)
    if (clear && overlaps(at, clear)) continue
    return { ...at, side: c.side, clamped: at.x !== c.r.x || at.y !== c.r.y, fallback: !siteVisible }
  }

  const pick = clean[0] ?? { r: candidate(site, content, 'over'), side: 'over' as SiteSide }
  const at = clampInto(pick.r, view)
  return {
    ...at,
    side: pick.side,
    clamped: at.x !== pick.r.x || at.y !== pick.r.y,
    fallback: !siteVisible,
  }
}

/**
 * Cleans up a site's rectangles: whole numbers, and never zero-sized. That way a site typed as a
 * single point still has a size the math can use.
 */
export const normaliseSite = (s: WorldUiSite): WorldUiSite => ({
  ...s,
  rect: { x: Math.round(s.rect.x), y: Math.round(s.rect.y), w: Math.max(1, Math.round(s.rect.w)), h: Math.max(1, Math.round(s.rect.h)) },
  keepClear: s.keepClear
    ? { x: Math.round(s.keepClear.x), y: Math.round(s.keepClear.y), w: Math.max(1, Math.round(s.keepClear.w)), h: Math.max(1, Math.round(s.keepClear.h)) }
    : undefined,
})
