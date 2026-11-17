/* The data behind the trophy wall. There's a seat for everything the student chose, and it stays
 * empty until they finish it. */
import type { SaveGame } from '../save'
import { shownName } from '../roster/placeholders'
import { classById } from '../planner/catalog'
import { programmeById } from '../roster/roster'
import { coreBeatId } from '../beats/beats'
import { PASSING_GRADE, letterOf as letter, rankName, ranksOf } from '../progress'

export type WallSeat = {
  id: string
  /** The year this seat belongs to, so a wall that covers the whole run can group seats by year. */
  year: number
  /** What the seat is for, using the school's own name for it. */
  name: string
  /** Advisory, a club or sport, or a class. Each kind gets its own frame shape on the wall. */
  kind: 'advisory' | 'activity' | 'class'
  /** Filled, or still just an outline. */
  earned: boolean
  /** What's in the seat once something is: the grade, the rank, the credit. */
  says: string | null
  /** What would fill the seat, while it's empty. */
  wants: string
}

/* Letter grades always come from `progress.ts`, never from a second table here. If the wall rounded
 * a 3.49 differently from the yearbook, the same grade would show two ways. */

/** The wall for one year: Advisory, then each season's choice, then each class. */
export function wallOf(s: SaveGame | null, year: number = s?.year ?? 1): WallSeat[] {
  if (!s) return []
  /* A frame from a closed year says what happened, not what to do. The wall covers the whole run,
   * and an old empty frame would otherwise point at a button that's gone. */
  const closed = year < s.year || s.flags.includes(`yearbook:y${year}`)
  const ask = (live: string) => (closed ? 'That year is closed.' : live)
  const plan = s.plans?.[year] ?? { slots: {}, classes: [], stamped: false }
  const done = (id: string) => s.ledger.find((e) => e.id === id && e.year === year)
  const out: WallSeat[] = []

  /* Advisory always gets a seat, picked or not. Its ledger id is the year's core beat id, the same
   * one the beat runner saves under. */
  /* A frame fills when the thing was done, not when it went well. A pick is complete once it's
   * played, and a retake under a B- is offered but never required, so a single bad answer can't
   * leave a frame stuck with no way to try again. */
  const core = done(coreBeatId(year))
  const corePassed = !!core && core.grade >= PASSING_GRADE
  out.push({
    id: 'advisory',
    year,
    name: 'Advisory',
    kind: 'advisory',
    earned: corePassed,
    says: corePassed ? `${letter(core!.grade)}, credit earned` : null,
    /* A failed row says what happened and where to go. The frame stays empty with a sentence in it,
     * and the sentence names the place to retake it. */
    wants: core
      ? ask(`You got an ${letter(core.grade)}. Take Advisory again at the hearth`)
      : ask('Finish Advisory at the hearth'),
  })

  for (const [, id] of Object.entries(plan.slots)) {
    if (!id) continue
    const p = programmeById(id)
    const c = (s.completions ?? []).find((x) => x.programme === id && x.year === year)
    out.push({
      id: `programme:${id}`,
      year,
      /* A frame for a club nobody has built shows its placeholder name, like Example A, the same as
       * the card it came from. That way the wall and the card always agree about what was picked. */
      name: p ? shownName(p.id, p.name) : id,
      kind: 'activity',
      earned: !!c,
      /* Finishing without a grade isn't an F. `award(...)` with no number means it was done, not
       * scored zero. A row that took more than one try says so, and this is the only place attempts
       * are shown. */
      /* Print the rank, not the track. `Completion.rank` holds a programme id like "football",
       * which would print as "B, football". `rankName` turns the years into how far up the ranks
       * the student got. */
      says: c ? [
        c.grade === null ? 'finished' : letter(c.grade),
        c.rank ? rankName(ranksOf(s)[c.rank] ?? 0) : null,
        c.attempts && c.attempts > 1 && c.firstGrade !== null && c.firstGrade !== undefined
          ? `${c.attempts} tries, first ${letter(c.firstGrade)}`
          : null,
      ].filter(Boolean).join(', ') : null,
      wants: ask('Go to it from your year sheet'),
    })
  }

  for (const id of plan.classes) {
    const cl = classById(id)
    const row = done(`class:${id}`)
    const passed = !!row && row.grade >= PASSING_GRADE
    out.push({
      id: `class:${id}`,
      year,
      /* An elective keeps its real name everywhere, because the course really exists at the school. */
      name: cl?.name ?? id,
      kind: 'class',
      earned: passed,
      says: passed ? `${letter(row!.grade)}${row!.credit ? ', credit earned' : ', counted'}` : null,
      wants: row
        ? ask(`You got an ${letter(row.grade)}. Take it again from your year sheet`)
        : ask('Go to it from your year sheet'),
    })
  }

  return out
}

/* `wallAll` covers every year of the run, while `wallOf` stays about one year. The closing film and
 * the yearbook each only need one year. */
export const wallAll = (s: SaveGame | null): WallSeat[] =>
  s ? Array.from({ length: Math.max(1, s.year) }, (_, i) => i + 1).flatMap((y) => wallOf(s, y)) : []

/** How many seats are filled. This is the count the cord drape shows. */
export const onTheWall = (s: SaveGame | null, year?: number): number =>
  wallOf(s, year).filter((w) => w.earned).length
