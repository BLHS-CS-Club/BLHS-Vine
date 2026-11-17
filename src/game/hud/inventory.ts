/* The list of everything that can show up on the play screen, and what has to be true in the save
 * before each one appears. */
import type { SaveGame } from '../save'
import { cordsOf } from '../progress'

/* Every element that can ever sit in the corner. When you add one here, the test makes you give it
 * a condition too. */
export type HudElement = 'chart' | 'handbook' | 'tokens' | 'cape'

export type HudGrants = Record<HudElement, boolean>

/* The save flags that hand out the chart and the handbook. They're named here once so nobody has to
 * type the string at each place it's used. */
export const CHART_FLAG = 'chart:granted'
export const HANDBOOK_FLAG = 'handbook:granted'

/* One row per element. Each row has its condition written out in words next to the same condition
 * as code. */
export type HudRow = {
  el: HudElement
  /** What the player reads when it shows up. */
  says: string
  /** The condition, written out in words. */
  rule: string
  /** Whether it can ever go away once it's been given. */
  permanent: boolean
  has: (s: SaveGame) => boolean
}

export const HUD_INVENTORY: HudRow[] = [
  {
    el: 'chart',
    says: 'You have the Chart now. It shows every island you have found.',
    rule: 'the first island discovered makes the chart worth opening (§40.2)',
    permanent: true,
    /* The chart flag is the normal way to get the chart, and having found any island is the backup.
     * Don't test `(s.exposure ?? []).length > 0` here. `PmapScene` writes an exposure row for the
     * map the player is standing on, so the chart would appear as soon as the player reached the
     * hub, before it's handed over. */
    has: (s) => s.flags.includes(CHART_FLAG) || Object.keys(s.islands ?? {}).length > 0,
  },
  {
    el: 'handbook',
    says: 'The Handbook is yours. Everything the school has told you is in it.',
    rule: '§4.10 hands the binder over in the Maw',
    permanent: true,
    /* The handbook is something to look things up in, not help for a lost player, so it waits until
     * the binder is handed over. The objective panel is what helps a lost player. */
    has: (s) => s.flags.includes(HANDBOOK_FLAG),
  },
  {
    el: 'tokens',
    says: 'Your year sheet. Pick your classes and what you join.',
    rule: 'the binder and the year\'s three tokens are handed over in one moment (§4.10)',
    /* Not permanent. The token pips leave the HUD once the player graduates, because there's no
     * year left to plan and an empty year sheet would only take up space. */
    permanent: false,
    has: (s) => !s.graduated && s.flags.includes(HANDBOOK_FLAG),
  },
  {
    el: 'cape',
    says: 'You started your first cord. It shows on your cape.',
    rule: 'the first cord in progress puts the cape within reach (§40.2)',
    permanent: true,
    /* Nothing shows the cape yet. The row is here so whoever adds it uses this condition. */
    has: (s) => cordsOf(s).some((c) => c.progress > 0),
  },
]

/* Both places that mount the HUD read this one function. It has no side effects, so it's cheap to
 * call. Because it returns a Record, TypeScript makes you add a row for every member of
 * `HudElement`. */
export function hudGrants(s: SaveGame | null): HudGrants {
  const out = { chart: false, handbook: false, tokens: false, cape: false } as HudGrants
  if (!s) return out
  for (const row of HUD_INVENTORY) out[row.el] = row.has(s)
  return out
}

/* The full list of what is allowed on the play screen. Anything not named here must not be drawn on
 * top of the game. */
export const ALWAYS_ON = [
  /* The corner items, each shown only once it has been given. */
  'chart', 'handbook', 'tokens', 'cape',
  /* Marks drawn in the world itself. They aren't HTML and they aren't in the corner. */
  'prompt', 'objective-mark', 'you-pin',
  /* The two boxes that show text. Each one is only there while it has something to say. */
  'dialogue', 'place-card',
  /* The one instruction the game gives, at the top center. It takes the place of a quest log. */
  'objective',
  /* The question mark button. It shows nothing until it's pressed, and it works from the very first
   * frame. */
  'help',
  /* The two black movie bars. They draw nothing until an island asks for a cutscene. */
  'movie-bars',
  /* The skip button for a voyage, top left, shown only while the ship is sailing. Nothing else on
   * screen lets the player skip the trip. */
  'skip-voyage',
  /* The camera switch, alone in the top right corner. It's the one choice the student gets about
   * how the world is framed, and there's nowhere else to put it. */
  'camera-view',
  /* The "island finished, head back" button, bottom center. It only shows once an island has
   * nothing left to ask for, because nothing in the world can say that. It hides while the dialogue
   * box is up, since they share the same strip. */
  'head-back',
] as const
