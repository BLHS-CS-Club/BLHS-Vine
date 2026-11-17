/* Draws text, like a player's or an island's name, onto a see-through canvas that a scene can place
 * in the world. */

export type WorldTextAlign = 'left' | 'center' | 'right'
export type WorldTextBaseline = 'top' | 'middle' | 'bottom'

export type WorldTextStyle = {
  /** A CSS font family list. The game's fonts are 'Harbormaster' and 'Deckhand'. */
  face: string
  /**
   * The height of a capital letter in art pixels, not screen pixels. The text is drawn at map scale
   * and zoomed by the same camera as the painting under it.
   */
  size: number
  weight?: 'normal' | 'bold'
  /** The color of the text itself. */
  ink: string
  /** A carved-looking edge under the text, because most of these sit on painted wood. */
  shadow?: { color: string; dx: number; dy: number }
  align?: WorldTextAlign
  baseline?: WorldTextBaseline
  /** The width of the space on the art. Text wraps to it, then gets cut off. */
  maxWidth?: number
  /** How many lines fit in the space. */
  maxLines?: number
  /** Line height as a multiple of `size`. */
  lineHeight?: number
  letterSpacing?: number
  /** Empty margin around the text, so tilted text doesn't get its corners cut off. */
  padding?: number
  /** How tilted the space on the art is, in degrees. A boat's stern isn't level. */
  rotate?: number
  upper?: boolean
  ellipsis?: string
  /**
   * How wide one character is when there's no canvas to measure with, like in tests. A real browser
   * measures instead.
   */
  charWidth?: number
}

export type WorldTextLayout = {
  lines: string[]
  /** The smallest box the letters fit in, before padding and tilt. */
  textWidth: number
  textHeight: number
  /** The canvas size needed, including padding and tilt. */
  width: number
  height: number
  lineHeight: number
  truncated: boolean
  /** True when nothing measured the letters, so the numbers are a guess. */
  estimated: boolean
}

export type WorldTextImage = WorldTextLayout & {
  canvas: HTMLCanvasElement
}

const DEFAULTS = {
  weight: 'normal' as const,
  align: 'center' as WorldTextAlign,
  baseline: 'middle' as WorldTextBaseline,
  lineHeight: 1.25,
  letterSpacing: 0,
  padding: 2,
  rotate: 0,
  ellipsis: '…',
}

/** The CSS font string. Measuring and drawing must use exactly the same one. */
export const fontOf = (s: WorldTextStyle): string =>
  `${s.weight ?? DEFAULTS.weight} ${Math.max(1, Math.round(s.size))}px ${s.face}`

/* A rough character width for each font, only used when there's no canvas to measure with. */
export function estimatedCharWidth(style: WorldTextStyle): number {
  if (style.charWidth !== undefined) return style.charWidth
  return /mono|Deckhand|Harbormaster/i.test(style.face) ? 0.6 : 0.52
}

/** A text measurer built from a real 2D canvas, or null when there isn't one. */
export function canvasMeasurer(style: WorldTextStyle): ((s: string) => number) | null {
  if (typeof document === 'undefined') return null
  const g = document.createElement('canvas').getContext('2d')
  if (!g) return null
  g.font = fontOf(style)
  const spacing = style.letterSpacing ?? DEFAULTS.letterSpacing
  return (s: string) => g.measureText(s).width + spacing * Math.max(0, s.length - 1)
}

export function estimateMeasurer(style: WorldTextStyle): (s: string) => number {
  const per = estimatedCharWidth(style) * style.size
  const spacing = style.letterSpacing ?? DEFAULTS.letterSpacing
  return (s: string) => s.length * per + spacing * Math.max(0, s.length - 1)
}

/**
 * The box a tilted rectangle needs. Tilted text takes up more room than flat text, and a canvas cut
 * to the flat size clips the corners.
 */
export function rotatedBounds(w: number, h: number, deg: number): { width: number; height: number } {
  if (!deg) return { width: w, height: h }
  const r = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  /* The tiny 1e-9 matters. cos(90°) is 6.1e-17 instead of 0, and without it a quarter turn of a
   * 10x4 box comes out 5 wide instead of 4, adding a stray empty column. */
  const up = (v: number) => Math.ceil(v - 1e-9)
  return { width: up(w * c + h * s), height: up(w * s + h * c) }
}

/* ---- wrapping ---------------------------------------------------------- */

function breakLongWord(word: string, max: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of word) {
    if (cur && measure(cur + ch) > max) { out.push(cur); cur = ch }
    else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function wrap(text: string, max: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word
      if (line && measure(tryLine) <= max) { line = tryLine; continue }
      if (line) { out.push(line); line = '' }
      /* A single word wider than the whole space gets broken up, so it can't run off the art. This
       * happens with names that have no spaces. */
      if (measure(word) > max) {
        const parts = breakLongWord(word, max, measure)
        out.push(...parts.slice(0, -1))
        line = parts[parts.length - 1] ?? ''
      } else line = word
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

function clip(line: string, max: number, ellipsis: string, measure: (s: string) => number): string {
  if (measure(line) <= max) return line
  let cut = line
  while (cut.length > 0 && measure(cut + ellipsis) > max) cut = cut.slice(0, -1)
  return cut.replace(/\s+$/, '') + ellipsis
}

/** Works out all the layout math without needing a canvas. */
export function layoutWorldText(
  text: string,
  style: WorldTextStyle,
  measure: (s: string) => number,
  estimated = false,
): WorldTextLayout {
  const src = (style.upper ? text.toUpperCase() : text).trim()
  const maxLines = Math.max(1, style.maxLines ?? 1)
  const ellipsis = style.ellipsis ?? DEFAULTS.ellipsis
  const lineHeight = Math.round(style.size * (style.lineHeight ?? DEFAULTS.lineHeight))
  const padding = style.padding ?? DEFAULTS.padding

  let lines = style.maxWidth ? wrap(src, style.maxWidth, measure) : src.split('\n')
  let truncated = false
  if (lines.length > maxLines) {
    truncated = true
    const kept = lines.slice(0, maxLines)
    const last = kept[maxLines - 1]
    /* Text that didn't fit gets joined back onto the last line, so the ellipsis shows where reading
     * stopped instead of after a line that fit. */
    const rest = lines.slice(maxLines).join(' ')
    kept[maxLines - 1] = style.maxWidth ? clip(`${last} ${rest}`, style.maxWidth, ellipsis, measure) : `${last}${ellipsis}`
    lines = kept
  } else if (style.maxWidth) {
    lines = lines.map((l) => {
      const c = clip(l, style.maxWidth!, ellipsis, measure)
      if (c !== l) truncated = true
      return c
    })
  }

  const textWidth = Math.ceil(Math.max(0, ...lines.map(measure)))
  const textHeight = lineHeight * lines.length
  const box = rotatedBounds(textWidth + padding * 2, textHeight + padding * 2, style.rotate ?? DEFAULTS.rotate)
  return {
    lines,
    textWidth,
    textHeight,
    /* Both sides are made even, the same rule the art generator's canvases follow. An odd side puts
     * a pixel art texture on a half pixel, and nearest-neighbor scaling smears a column of every
     * letter. */
    width: Math.max(2, box.width + (box.width % 2)),
    height: Math.max(2, box.height + (box.height % 2)),
    lineHeight,
    truncated,
    estimated,
  }
}

/**
 * Lays out the text with the best measurer available, a real canvas first and a guess if there
 * isn't one.
 */
export function measureWorldText(text: string, style: WorldTextStyle): WorldTextLayout {
  const real = canvasMeasurer(style)
  return real
    ? layoutWorldText(text, style, real, false)
    : layoutWorldText(text, style, estimateMeasurer(style), true)
}

/* ---- the painted half -------------------------------------------------- */

/* Results are cached by everything that changes the picture. The same text gets asked for every
 * frame, and a name that hasn't changed shouldn't be redrawn. */
const cache = new Map<string, WorldTextImage>()
const keyOf = (text: string, s: WorldTextStyle) => `${text}|${JSON.stringify(s)}`

/** Draws text onto a see-through canvas, or gives back null if there's no 2D context. */
export function composeWorldText(text: string, style: WorldTextStyle): WorldTextImage | null {
  if (typeof document === 'undefined') return null
  const key = keyOf(text, style)
  const hit = cache.get(key)
  if (hit) return hit

  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) {
    console.warn('[worldText] no 2D context, so no world text was composed for', JSON.stringify(text))
    return null
  }
  probe.font = fontOf(style)
  const spacing = style.letterSpacing ?? DEFAULTS.letterSpacing
  const measure = (s: string) => probe.measureText(s).width + spacing * Math.max(0, s.length - 1)
  const layout = layoutWorldText(text, style, measure, false)

  const cv = document.createElement('canvas')
  cv.width = layout.width
  cv.height = layout.height
  const g = cv.getContext('2d')
  if (!g) return null

  g.font = fontOf(style)
  g.textAlign = style.align ?? DEFAULTS.align
  g.textBaseline = 'middle'

  const rot = style.rotate ?? DEFAULTS.rotate
  g.translate(cv.width / 2, cv.height / 2)
  if (rot) g.rotate((rot * Math.PI) / 180)

  const align = style.align ?? DEFAULTS.align
  const x = align === 'left' ? -layout.textWidth / 2 : align === 'right' ? layout.textWidth / 2 : 0
  const top = -layout.textHeight / 2 + layout.lineHeight / 2

  layout.lines.forEach((line, i) => {
    const y = top + i * layout.lineHeight
    if (style.shadow) {
      g.fillStyle = style.shadow.color
      drawLine(g, line, x + style.shadow.dx, y + style.shadow.dy, spacing, align)
    }
    g.fillStyle = style.ink
    drawLine(g, line, x, y, spacing, align)
  })

  const out: WorldTextImage = { ...layout, canvas: cv }
  cache.set(key, out)
  return out
}

/* Letter spacing is done by hand, because `ctx.letterSpacing` only works in Chromium and this has
 * to look the same on every member's computer. */
function drawLine(g: CanvasRenderingContext2D, line: string, x: number, y: number, spacing: number, align: WorldTextAlign) {
  if (!spacing) { g.fillText(line, x, y); return }
  const prev = g.textAlign
  const total = g.measureText(line).width + spacing * Math.max(0, line.length - 1)
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  g.textAlign = 'left'
  for (const ch of line) {
    g.fillText(ch, cx, y)
    cx += g.measureText(ch).width + spacing
  }
  g.textAlign = prev
}

/** For a scene that rebuilt its art and needs all the text drawn again. */
export const clearWorldTextCache = (): void => { cache.clear() }

/* The six named text styles: a stern, a signpost, a crest, a plaque, a room number and a
 * scoreboard. */
export const WORLD_TEXT: Record<
  'sternName' | 'signpost' | 'dockCrest' | 'trophyPlaque' | 'roomNumber' | 'scoreboard',
  WorldTextStyle
> = {
  /* The boat's name on the stern, tilted because the hull isn't level. */
  sternName: {
    face: "'Harbormaster', 'Deckhand', monospace", size: 9, ink: '#f0e4c8',
    shadow: { color: 'rgba(30,16,6,0.75)', dx: 0, dy: 1 },
    align: 'center', maxWidth: 62, maxLines: 1, rotate: -6, padding: 3, letterSpacing: 0.5,
  },
  /* The island's name on a signpost, read from the deck. It uses two short lines instead of one
   * long one, because a sign is taller than it is wide. */
  signpost: {
    face: "'Harbormaster', 'Deckhand', monospace", size: 8, ink: '#3b2a1a',
    shadow: { color: 'rgba(255,250,235,0.35)', dx: 0, dy: -1 },
    align: 'center', maxWidth: 56, maxLines: 2, lineHeight: 1.15, upper: true, padding: 2,
  },
  /* A crest on a dock is a short word carved big. */
  dockCrest: {
    face: "'Harbormaster', monospace", size: 12, ink: '#e8dcc0',
    shadow: { color: 'rgba(26,16,6,0.9)', dx: 0, dy: 1 },
    align: 'center', maxWidth: 70, maxLines: 1, upper: true, letterSpacing: 1, padding: 3,
  },
  /* A trophy plaque holds a name and a year, so it gets two lines and small text. */
  trophyPlaque: {
    face: "'Deckhand', monospace", size: 6, ink: '#2b1a0c',
    align: 'center', maxWidth: 44, maxLines: 2, lineHeight: 1.2, padding: 2,
  },
  /* A room number is three or four characters and must never wrap. */
  roomNumber: {
    face: "'Deckhand', monospace", size: 7, ink: '#f4f1ea',
    shadow: { color: 'rgba(0,0,0,0.6)', dx: 0, dy: 1 },
    align: 'center', maxWidth: 26, maxLines: 1, padding: 1, weight: 'bold',
  },
  /* The stadium scoreboard. The number is what matters, so it's the biggest text in this table and
   * it never wraps or gets cut off. */
  scoreboard: {
    face: "'Harbormaster', monospace", size: 16, ink: '#ffd98a',
    shadow: { color: 'rgba(0,0,0,0.75)', dx: 0, dy: 1 },
    align: 'center', maxWidth: 96, maxLines: 1, letterSpacing: 2, padding: 3, weight: 'bold',
  },
}
