// The year's tasks, shown as a list under the objective bar. The list is worked out from the save
// each time, never stored.
import type { SaveGame } from '../save'
import { sessionOver, yearStatus, yearWord } from './year'
import { picksOf } from './pick'
import { programmeById } from '../roster/roster'
import { shownName } from '../roster/placeholders'

export type Task = {
  /** Stays the same between renders, and is never shown. */
  id: string
  /** The task itself, using the same words the rest of the game uses for it. */
  name: string
  done: boolean
  // One short line under an unfinished task saying where it happens. A finished task has none.
  note?: string
  /* A task nobody can do yet. It's drawn differently from one that's only unfinished, because an
   * island nobody has built isn't something the student is failing at. */
  barred?: boolean
}

/** The heading over the sheet. It's the only place the year is named. */
export const taskHeading = (year: number): string => `Year ${yearWord(year)}`

/* On an island, the heading names the island instead of the year, because the list under it is
 * what's left to do there. It uses the roster name so it matches the card the student arrived on. */
export const islandHeading = (programme: string): string => {
  const p = programmeById(programme)
  return p ? shownName(p.id, p.name) : programme
}

/** The year's tasks in the order they happen, which is the same order the objective arrow follows. */
export function tasksOf(s: SaveGame | null): Task[] {
  if (!s) return []
  const st = yearStatus(s)
  const out: Task[] = []

  out.push({
    id: 'plan',
    name: 'Your schedule',
    done: st.planStamped,
    ...(st.planStamped ? {} : { note: 'Fill both Elective periods and stamp it' }),
  })

  out.push({
    id: 'core',
    name: 'Advisory',
    done: st.coreBeatDone,
    ...(st.coreBeatDone ? {} : { note: 'At the fire, inside the Panther’s Maw' }),
  })

  /* Every pick gets one note, since each pick has one button. */
  for (const p of picksOf(s)) {
    out.push({
      id: `${p.kind === 'class' ? 'class' : 'voyage'}:${p.id}`,
      name: p.name,
      done: p.done,
      ...(p.done ? {} : { note: p.map ? 'Sail there from your year sheet' : 'Open My Year and go' }),
    })
  }

  out.push({
    id: 'end',
    name: 'Finish the year',
    done: st.yearbookSeen || sessionOver(s),
    ...(st.yearbookSeen || sessionOver(s)
      ? {}
      : st.readyForYearbook
        ? { note: 'Find the principal, inside the Panther’s Maw' }
        : { barred: true, note: 'After your schedule and Advisory' }),
  })

  return out
}

/** How much of the year the player has done, for the line in the sheet's heading. */
export function tasksDone(list: Task[]): { done: number; total: number } {
  /* Barred rows aren't counted in the total. Counting an island nobody has built as an unfinished
   * task would make the sheet say a student is two thirds done with a year they've actually
   * finished. */
  const counted = list.filter((t) => !t.barred || t.done)
  return { done: counted.filter((t) => t.done).length, total: counted.length }
}
