/* Framings are named camera shots saved on the map. Each one is attached to an anchor. */

export type Framing = {
  /** How far the camera zooms in, as a multiple of the scale the map loaded at. */
  zoom?: number
  /* How far the shot is moved from the anchor, in painting pixels. */
  dx?: number
  dy?: number
  /**
   * The name somebody gave the shot. It's used in log messages and when the map goes back to
   * MAPVIS.
   */
  name?: string
}

/* An anchor's meta bag can hold one unnamed framing for the normal case, and a named set when the
 * same anchor gets shot more than one way. */
type MetaBag = Record<string, unknown> | undefined

const numOr = (v: unknown, fallback?: number): number | undefined => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const readOne = (raw: unknown, name?: string): Framing | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const f: Framing = {
    zoom: numOr(o.zoom),
    dx: numOr(o.dx, 0),
    dy: numOr(o.dy, 0),
    ...(name ? { name } : typeof o.name === 'string' ? { name: o.name } : {}),
  }
  /* A framing with no zoom and no offset counts as no framing. Otherwise its empty zoom would
   * replace a script's own zoom and pull the shot back to the map's load scale. */
  if (f.zoom === undefined && !f.dx && !f.dy) return null
  return f
}

/** The framing an anchor carries. If a name is given, it looks for that named one first. */
export function framingOf(meta: MetaBag, name?: string): Framing | null {
  if (!meta) return null
  if (name) {
    const set = meta.framings
    if (set && typeof set === 'object') {
      const hit = (set as Record<string, unknown>)[name]
      const f = readOne(hit, name)
      if (f) return f
    }
    /* If the anchor doesn't have the named framing, use its default one instead of nothing. Half a
     * shot looks worse than the map maker's own wide shot. */
  }
  return readOne(meta.framing)
}

/** Every framing an anchor carries, so an error message can list them. */
export function framingNames(meta: MetaBag): string[] {
  if (!meta) return []
  const out: string[] = []
  if (readOne(meta.framing)) out.push('(default)')
  const set = meta.framings
  if (set && typeof set === 'object') out.push(...Object.keys(set as object))
  return out
}

/* Turns a shot into the x, y and zoom the camera uses. */
export function shotOf(
  at: { x: number; y: number },
  f: Framing | null,
  fallbackZoom = 1,
): { x: number; y: number; zoom: number } {
  return {
    x: at.x + (f?.dx ?? 0),
    y: at.y + (f?.dy ?? 0),
    zoom: f?.zoom ?? fallbackZoom,
  }
}

/* Older maps keep their shots in a list at the top level. This moves them into each anchor's meta
 * bag when the map loads. */
type HasMeta = { name: string; meta?: Record<string, unknown> }

export function projectFramings(anchors: HasMeta[], raw: unknown, mapId = ''): number {
  if (!Array.isArray(raw) || !raw.length) return 0
  const by = new Map(anchors.map((a) => [a.name, a]))
  let folded = 0
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue
    const name = typeof r.name === 'string' ? r.name : ''
    const on = typeof r.anchor === 'string' ? r.anchor : ''
    const f = readOne(r, name || undefined)
    if (!name) continue
    /* A named shot with no zoom and no offset gets dropped with a warning. */
    if (!f) {
      console.warn(`[framings] ${mapId}: shot "${name}" carries no zoom and no offset, so there is nothing to frame`)
      continue
    }
    const a = by.get(on)
    /* A shot attached to an anchor this map doesn't have gets a warning when the map loads. */
    if (!a) {
      console.warn(`[framings] ${mapId}: shot "${name}" hangs off anchor "${on || '(none)'}", which is not on this map`)
      continue
    }
    const meta = (a.meta ??= {})
    const set = (meta.framings && typeof meta.framings === 'object'
      ? meta.framings
      : (meta.framings = {})) as Record<string, unknown>
    /* If the meta bag already has this shot, keep it. That's the newer format MAPVIS writes, so a
     * bundle that has both is halfway through converting and the good half must not be overwritten. */
    const had = set[name] === undefined ? null : readOne(set[name], name)
    if (!had) { set[name] = f; folded++ }
    /* A shot marked entry is the one the map opens on. It uses whichever copy was kept above. */
    if (r.entry === true && meta.framing === undefined) meta.framing = had ?? f
  }
  return folded
}

/**
 * A named shot and the anchor it belongs to. It's generic in the anchor type, so the caller gets
 * its own full record back without casting it everywhere.
 */
export type NamedShot<T extends HasMeta = HasMeta> = { name: string; anchor: T; framing: Framing }

/* Every named shot on this map, looked up by the name somebody typed. */
export function shotsOf<T extends HasMeta>(anchors: readonly T[]): Map<string, NamedShot<T>> {
  const out = new Map<string, NamedShot<T>>()
  for (const a of anchors) {
    const set = a.meta?.framings
    if (!set || typeof set !== 'object') continue
    for (const [name, raw] of Object.entries(set as Record<string, unknown>)) {
      const f = readOne(raw, name)
      if (!f) continue
      const had = out.get(name)
      if (had) {
        console.warn(`[framings] two anchors carry a shot called "${name}" (${had.anchor.name} and ${a.name}), keeping the first`)
        continue
      }
      out.set(name, { name, anchor: a, framing: f })
    }
  }
  return out
}
