/* Shows one small icon cut out of a sprite sheet. Gives back nothing if that icon was never drawn. */
import type { CSSProperties } from 'react'
import { kitCached, kitFace, kitOptedIn, kitPiece, type KitPiece } from './kit'

/** The CSS that shows one cut face, or undefined if that face isn't drawn. */
export function faceStyle(
  piece: string,
  face: string,
  pieces: KitPiece[] | null = kitCached(),
  /* Whether the platform's kit is in use. The CSS variable for the art only exists when it is. */
  worn = kitOptedIn(),
): CSSProperties | undefined {
  if (!pieces?.length || !worn) return undefined
  const sheet = kitPiece(pieces, piece)
  const cut = kitFace(pieces, piece, face)
  if (!sheet || !cut || !(sheet.w > 0 && sheet.h > 0) || !(cut.w > 0 && cut.h > 0)) return undefined
  /* The face has to fit inside the sheet, or the crop would show pixels from the icon next to it. */
  if (cut.x + cut.w > sheet.w || cut.y + cut.h > sheet.h) return undefined
  const travelX = sheet.w - cut.w
  const travelY = sheet.h - cut.h
  return {
    backgroundImage: `var(--kit-art-${piece})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${(sheet.w / cut.w) * 100}% ${(sheet.h / cut.h) * 100}%`,
    backgroundPosition: `${travelX ? (cut.x / travelX) * 100 : 0}% ${travelY ? (cut.y / travelY) * 100 : 0}%`,
    imageRendering: 'pixelated',
  }
}
