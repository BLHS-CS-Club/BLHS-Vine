/* A pick is a class or club the student chose for the year. This file has the one button that plays
 * it. */
import type { SaveGame } from '../save'
import { loadSave, recordGrade, recordCompletion, setIslandState } from '../save'
import { classById } from '../planner/catalog'
import { programmeById, islandForClass, islandForProgramme } from '../roster/roster'
import { shownName } from '../roster/placeholders'
import { classPassed } from '../beats/classes'
import { completedIn } from '../save'

/* Each pick gets one button, and classes in `plan.classes` and clubs in `plan.slots` use the same
 * one. With an island, the button sails there. Without one, it opens a card and counts the pick as
 * done, with no quiz, so a wrong click can't put an F on a finished pick. */

export type Pick = {
  /** The pick's own id: a class id or a programme id. */
  id: string
  kind: 'class' | 'activity'
  /** The school's own name for it, or the placeholder name a stand-in uses. */
  name: string
  /** The map someone has built for it, or null if nobody has yet. */
  map: string | null
  done: boolean
}

/** Everything this student picked this year, classes first, in the same order as the year sheet. */
export function picksOf(s: SaveGame | null, year: number = s?.year ?? 1): Pick[] {
  if (!s) return []
  const plan = s.plans?.[year] ?? { slots: {}, classes: [], stamped: false }
  const out: Pick[] = []
  for (const id of plan.classes) {
    const c = classById(id)
    out.push({
      id, kind: 'class', name: c?.name ?? id,
      map: islandForClass(id)?.map ?? null,
      /* A class only counts as done once it's passed. If the student failed it, the year is still
       * waiting on it and its button has to come back. */
      done: classPassed(s, id),
    })
  }
  for (const id of Object.values(plan.slots)) {
    if (!id) continue
    const p = programmeById(id)
    out.push({
      id, kind: 'activity', name: p ? shownName(p.id, p.name) : id,
      map: islandForProgramme(id)?.map ?? null,
      done: completedIn(s, id, year),
    })
  }
  return out
}

/** The next unfinished pick. This is what the objective bar names. */
export const nextPick = (s: SaveGame | null): Pick | null => picksOf(s).find((p) => !p.done) ?? null

/**
 * What the button says. It's one of two labels, depending on whether the roster has a map for the
 * pick.
 */
export const pickVerb = (p: Pick): string => (p.map ? `Sail to ${p.name}` : 'Go')

/* The short label, for the season column on the year sheet where the card above already shows the
 * club's name. "Sail to Algorithmic Thinking Club" needs 254px and the sign is 171px wide. The long
 * label is used where the button stands alone. */
export const pickVerbHere = (p: Pick): string => (p.map ? 'Sail there' : 'Go')

/** The card that opens for a pick with no island. */
export const noIslandLine = (p: Pick): string => `${p.name}: no island yet. Counted as done.`

/* A pick with no island counts as a B worth zero credit. `gpaOf` weights grades by credit, so zero
 * credit leaves the GPA alone. Any credit here would drag a perfect student below Highest Honors
 * (3.76) and High Honors (3.5). The grade is still saved, because `beatState` reads it. */
export const COUNTED_GRADE = 3.0
/** No credit, so a stand-in pick never changes the transcript. */
export const COUNTED_CREDIT = 0

/** Marks a pick finished without an island. Returns false only when there's no run. */
export function countAsDone(p: Pick): boolean {
  const s = loadSave()
  if (!s) return false
  if (p.kind === 'class') {
    const c = classById(p.id)
    recordGrade({
      id: `class:${p.id}`,
      title: c?.name ?? p.id,
      kind: 'class',
      credit: COUNTED_CREDIT,
      grade: COUNTED_GRADE,
      year: s.year,
      season: s.season,
      ...(c?.tags?.length ? { tags: c.tags } : {}),
    })
  } else {
    const g = programmeById(p.id)
    /* `recordCompletion` writes the transcript row and `setIslandState` is what the diploma reads,
     * so both are needed. Completion has to go first, because `setIslandState` writes its own row
     * and would drop the rank track. */
    recordCompletion(p.id, COUNTED_GRADE, g?.rankTrack ?? undefined)
    setIslandState(p.id, 'completed')
  }
  return true
}
