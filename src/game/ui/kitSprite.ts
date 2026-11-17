/* Turns kit art from the platform into Pixi sprites, for things drawn in the game world instead of
 * in the HTML UI. */
import { Assets, NineSliceSprite, Rectangle, Sprite, Texture } from 'pixi.js'
import { kitCached, kitFace, kitPiece, kitHostInUse, kitArtUrl, loadKit } from './kit'

/* Each sheet is loaded once per session and shared by every face cut from it. `pointer` is 384x256
 * with six icons on it, so loading it per icon would fetch the same file six times on a slow
 * network. */
const sheets = new Map<string, Promise<Texture | null>>()

async function sheetOf(piece: string): Promise<Texture | null> {
  const had = sheets.get(piece)
  if (had) return had
  const job = (async (): Promise<Texture | null> => {
    try {
      /* The kit might not be here yet. `loadKit` starts at boot without anyone waiting for it, and
       * the world builds as soon as the map loads. Calling it here gives back the same cached
       * promise, not a second fetch. */
      const pieces = kitCached() ?? await loadKit()
      const p = kitPiece(pieces, piece)
      if (!p) return null
      const url = kitArtUrl(p, kitHostInUse())
      if (!url) return null
      /* The loader is named because the kit's image URL has no file extension. */
      const t: Texture = await Assets.load({ src: url, parser: 'loadTextures' })
      /* Always nearest. This is pixel art drawn over a painting, and linear filtering would turn
       * crisp edges into a smear. */
      t.source.scaleMode = 'nearest'
      return t
    } catch { return null }
  })()
  sheets.set(piece, job)
  return job
}

/** The texture for one named face, or null if it isn't drawn or can't be loaded. */
export async function kitTexture(piece: string, face: string): Promise<Texture | null> {
  const sheet = await sheetOf(piece)
  if (!sheet) return null
  const cut = kitFace(kitCached() ?? [], piece, face)
  if (!cut) return null
  /* The rectangle is in the sheet's own pixels, the same unit the kit publishes and a texture frame
   * takes. A face that runs off its sheet gives back null instead of drawing the wrong thing. */
  const { width: w, height: h } = sheet.source
  if (cut.x < 0 || cut.y < 0 || cut.x + cut.w > w || cut.y + cut.h > h) {
    console.warn(`[kit] face "${piece}/${face}" is ${cut.x},${cut.y} ${cut.w}x${cut.h}, off a ${w}x${h} sheet`)
    return null
  }
  return new Texture({ source: sheet.source, frame: new Rectangle(cut.x, cut.y, cut.w, cut.h) })
}

/** A sprite of one named face, or null. The caller owns the sprite and sets its scale. */
export async function kitSprite(piece: string, face: string): Promise<Sprite | null> {
  const t = await kitTexture(piece, face)
  return t ? new Sprite(t) : null
}

/* A stretchable nine-slice background, built at the art's own height so the corners can't flip
 * inside out. */
export async function kitNineSlice(piece: string, width: number): Promise<NineSliceSprite | null> {
  const sheet = await sheetOf(piece)
  if (!sheet) return null
  const p = kitPiece(kitCached() ?? [], piece)
  const s = p?.slice
  if (!p || !s) return null
  /* The slice has to fit inside its image, or the nine-slice breaks without any error, so check it
   * here the same way `kit.ts` does. The width is also kept wide enough to hold both ends. */
  if (!(p.w > 0 && p.h > 0) || s.left + s.right >= p.w || s.top + s.bottom >= p.h) return null
  const w = Math.max(s.left + s.right + 1, Math.round(width))
  return new NineSliceSprite({
    texture: sheet,
    leftWidth: s.left,
    topHeight: s.top,
    rightWidth: s.right,
    bottomHeight: s.bottom,
    width: w,
    height: p.h,
  })
}

/**
 * The drawn height of a stretchable piece, so a caller can work out the scale it needs before the
 * art has loaded.
 */
export function kitPieceHeight(piece: string): number | null {
  const p = kitPiece(kitCached() ?? [], piece)
  return p?.h && p.h > 0 ? p.h : null
}
