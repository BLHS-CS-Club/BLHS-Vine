/* What Thor wears over the coat, and where the art for each outfit lives. */

import type { SaveGame } from './save'
import { ranksOf } from './progress'

/* There's only one outfit slot. Each outfit's art is a whole Thor wearing it, in all eight
 * directions and matched to the original colors, so outfits can't be stacked on top of each other.
 * A separate overlay would drift in color and bend out of shape across the six walk frames. The
 * coat color change still applies on top. */

export type Wear = {
  id: string
  /** The name the student reads on the card. */
  name: string
  /** The sentence that says how to earn it, written to the player as "you". */
  earn: string
  /** Whether this run has earned it. */
  has: (s: SaveGame | null) => boolean
  /* A flag written here in code, one line per outfit, instead of a file loaded while the game runs.
   * `thorWear.test.ts` fails if an outfit marked drawn has no folder under
   * `public/art/characters/thor/wear/`. */
  drawn: boolean
  /* Kept separate from `drawn` because the `sit` and `lie` poses are extra art for every outfit. An
   * outfit without them sits down as the plain panther, so the player can still sit. */
  posed: boolean
}

/** The plain panther with no outfit. This is what "nothing" means. */
export const BARE = 'none'

export const WEAR: Wear[] = [
  {
    id: 'letterman',
    name: 'Letterman jacket',
    earn: 'reach Varsity in any sport',
    has: (s) => !!s && Object.values(ranksOf(s)).some((y) => Number(y) >= 2),
    drawn: true,
    posed: false,
  },
  {
    id: 'goggles',
    /* Any completed island earns this, so it works with every island on the roster and any added
     * later. Don't tie it to one programme id. */
    name: 'Safety goggles',
    earn: 'complete any island',
    has: (s) => Object.values(s?.islands ?? {}).some((v) => v === 'completed'),
    drawn: true,
    posed: false,
  },
  {
    id: 'cap',
    name: 'Graduation cap',
    earn: 'finish all four years',
    has: (s) => !!s?.graduated,
    drawn: true,
    posed: false,
  },
]

export const wearById = (id: string | undefined | null): Wear | undefined =>
  WEAR.find((w) => w.id === id)

/** Whether this run can put the outfit on: it's earned, and its art exists. */
export const canWear = (s: SaveGame | null, id: string): boolean => {
  const w = wearById(id)
  return !!w && w.drawn && w.has(s)
}

/**
 * The path the walk frames load from. An outfit with no art gives back the plain panther's path, so
 * every caller is safe even before the art exists.
 */
export function walkFrame(s: SaveGame | null, dir: string, frame: number): string {
  const id = s?.thorWear
  return canWear(s, id ?? '') ? walkFrameOf(id, dir, frame) : walkFrameOf(BARE, dir, frame)
}

/**
 * The same path, from an outfit id alone. The mirror shows the outfit being looked at, which isn't
 * always the one in the save yet, so using `walkFrame` there would show the old outfit.
 */
export const walkFrameOf = (id: string | null | undefined, dir: string, frame: number): string =>
  id && id !== BARE && wearById(id)?.drawn
    ? `/art/characters/thor/wear/${id}/walk/${dir}/${frame}.png`
    : `/art/characters/thor/walk/${dir}/${frame}.png`

/** The same thing for a held pose (`sit`, `lie`). */
export function poseFrame(s: SaveGame | null, file: string): string {
  const id = s?.thorWear
  /* The outfit is only used here if it has sitting art. Everything else falls back to the plain
   * panther, whose picture always exists. */
  return canWear(s, id ?? '') && wearById(id ?? '')?.posed
    ? `/art/characters/thor/wear/${id}/pose/${file}.png`
    : `/art/characters/thor/pose/${file}.png`
}

/**
 * What the world is drawing right now, as one string a scene can compare to see if anything
 * changed.
 */
export const wornKey = (s: SaveGame | null): string =>
  `${canWear(s, s?.thorWear ?? '') ? s?.thorWear : BARE}:${s?.thorLook ?? 'classic'}`
