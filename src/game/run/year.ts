// Works out what a year still needs from the student, using only the save.

import type { SaveGame, Season } from '../save'
import { SEASONS, completedIn } from '../save'
import { hasCoreBeat, beatDone, beatPassedIn } from '../beats/beats'
import { classDone, classPassed } from '../beats/classes'
import { programmeById, placeOfProgramme } from '../roster/roster'

/* The last year the run gives out. Play ends once that year's yearbook page turns. */
export const SESSION_ENDS_AFTER_YEAR = 1

/* The session is over once the current year's yearbook page has turned. It checks the year the run
 * is in, so starting the next year opens play back up. It doesn't use `SESSION_ENDS_AFTER_YEAR`,
 * which stays separate because the yearbook is where the ending happens. */
export const sessionOver = (s: SaveGame | null): boolean =>
  !!s && !s.graduated && s.flags.includes(`yearbook:y${s.year}`)

/** The next year that has content written for it, or null when there's nothing after this one. */
export const nextYear = (s: SaveGame | null): number | null =>
  s && !s.graduated && sessionOver(s) && s.year < 4 ? s.year + 1 : null

/* The year in words, kept in one place so every screen asks here instead of typing "year one"
 * itself. They're words instead of digits because the game is speaking. Four is the highest,
 * because `endYear` graduates the player at four. */
const YEAR_WORDS = ['zero', 'one', 'two', 'three', 'four'] as const

/** "year two" in the middle of a sentence, `Year two` at the start of one. */
export const yearWord = (n: number): string => YEAR_WORDS[n] ?? String(n)

/* Where the run is, in one line the student reads. It never names a season. */
export function runLine(s: SaveGame | null): string {
  if (!s) return ''
  if (sessionOver(s)) return `Year ${yearWord(s.year)} is done`
  if (!s.introDone) return 'Just started'
  return `Year ${yearWord(s.year)}`
}

export type VoyageStatus = {
  season: Season
  /** What the token was spent on. A slot points at a PROGRAMME, never at a map. */
  programmeId: string
  name: string
  /* The place the programme happens at. The world draws this place, and it's what an exposure
   * record counts. */
  placeId?: string
  /** Whether the programme's island can actually be played right now, according to the roster. */
  playable: boolean
  done: boolean
}

export type YearStatus = {
  year: number
  vignetteSeen: boolean
  planStamped: boolean
  /** true when the year's core beat is on the ledger WITH A PASSING GRADE. */
  coreBeatDone: boolean
  /** true when it's been tried at all, no matter the result. */
  coreBeatTried: boolean
  /** The classes tried at least once, passed or not. */
  classesTried: string[]
  classesDone: string[]
  classesPending: string[]
  voyages: VoyageStatus[]
  /** The plan is stamped, Advisory is passed and every pick is done, so the year can close. */
  readyForYearbook: boolean
  yearbookSeen: boolean
}

/* Whether a programme can be played right now is a field on it in the roster, not a list kept here. */

/* The state of one year. The year is passed in so an older yearbook page can be built too. */
export function yearStatus(s: SaveGame, forYear = s.year): YearStatus {
  const year = forYear
  const plan = s.plans[year] ?? { slots: {}, classes: [], stamped: false }
  const voyages: VoyageStatus[] = SEASONS.flatMap((season) => {
    const id = plan.slots[season]
    if (!id) return []
    const g = programmeById(id)
    /* Completion is keyed by the programme, never by the place it happens at. */
    return [{
      season, programmeId: id, name: g?.name ?? id, placeId: placeOfProgramme(id)?.id,
      playable: !!g?.playable,
      /* Checked per programme and per year from the record, which is only ever added to. A student
       * can pick the same programme three years in a row, so "done" has to mean done this year. */
      done: completedIn(s, id, year),
    }]
  })
  /* Tried and passed are different. The year waits for passed, while `classesTried` counts anyone
   * who tried it. Otherwise an F would close the class, close the year and print a credit. */
  const classesDone = plan.classes.filter((c) => classPassed(s, c))
  const classesTried = plan.classes.filter((c) => classDone(s.ledger, c))
  const classesPending = plan.classes.filter((c) => !classPassed(s, c))
  const coreBeatDone = !hasCoreBeat(year) || beatPassedIn(s, year)
  const coreBeatTried = !hasCoreBeat(year) || beatDone(s.ledger, year)
  return {
    year,
    vignetteSeen: s.flags.includes(`vignette:y${year}`),
    planStamped: plan.stamped,
    coreBeatDone,
    coreBeatTried,
    classesDone,
    classesTried,
    classesPending,
    voyages,
    /* The year waits on every pick, not only the classes. Each pick has one button that finishes
     * it: a voyage if it has an island, or a card that counts it if not. So nothing on the sheet
     * can get stuck unfinished. */
    readyForYearbook: plan.stamped && coreBeatDone
      && classesPending.length === 0 && voyages.every((v) => v.done),
    yearbookSeen: s.flags.includes(`yearbook:y${year}`),
  }
}

/** The yearbook's one gentle nudge. It points something out and never scolds. */
export function nudgeLine(st: YearStatus, s?: SaveGame | null): string {
  /* A year of F grades isn't a year well spent, so failed grades are checked first. Otherwise the
   * year would end on "Not a season wasted". `s` is optional so callers that don't pass it still
   * work. */
  const failed = s ? s.ledger.filter((e) => e.year === st.year && e.grade < 1.0) : []
  if (failed.length === 1) return `${failed[0].title} came back an F. You can sit it again.`
  if (failed.length > 1) return `${failed.length} things came back an F. You can sit them again.`

  const rising = st.voyages.find((v) => !v.playable && !v.done)
  if (rising) return `The ${rising.name} island is not open yet, so nobody could sail there.`
  /* There's no nudge about an empty season, since the year sheet never shows the student one. */
  const unplayed = st.voyages.find((v) => v.playable && !v.done)
  if (unplayed) return `You signed up for ${unplayed.name} and never went.`
  /* A class on the sheet that was never tried. It's checked last because it's the smaller miss. */
  if (st.classesPending.length) {
    return st.classesPending.length === 1
      ? 'You picked a class this year and never sat it. It is still on your sheet.'
      : `You picked ${st.classesPending.length} classes this year and sat neither of them.`
  }
  return 'Not a season wasted.'
}
