/* Checks that the wall shows exactly what the run did, with one seat per thing the student chose. */
import { describe, it, expect, beforeEach } from 'vitest'
import { beginAdventure, loadSave, type SaveGame } from '../save'
import { wallOf, onTheWall } from './wall'

const withPlan = (over: Partial<SaveGame> = {}): SaveGame => ({
  ...loadSave()!,
  year: 1,
  plans: { 1: { slots: { Fall: 'football', Winter: 'atc' }, classes: ['ap-human-geo', 'spanish-1'], stamped: true } },
  ...over,
})

beforeEach(() => { beginAdventure() })

describe('the seats', () => {
  it('is one seat per thing chosen, plus Advisory, which everybody is in', () => {
    const seats = wallOf(withPlan())
    expect(seats.map((w) => w.name)).toEqual([
      /* A club somebody built keeps its real name, and everything nobody has built yet still shows
       * as an example name. */
      'Advisory', 'Example A', 'CS Club', 'AP Human Geography', 'Spanish I',
    ])
    /* Advisory comes first, then the seasons, then the classes. That's the order the student meets
     * them in the session. */
    expect(seats.map((w) => w.kind)).toEqual(['advisory', 'activity', 'activity', 'class', 'class'])
  })

  it('starts as five outlines, each saying what would fill it', () => {
    const seats = wallOf(withPlan())
    expect(seats.every((w) => !w.earned)).toBe(true)
    expect(seats.every((w) => w.says === null)).toBe(true)
    /* Every empty frame has to say what goes in it, so the next thing to do is always visible. */
    expect(seats.every((w) => w.wants.trim().length > 0)).toBe(true)
    expect(onTheWall(withPlan())).toBe(0)
  })

  it('a wall with no plan on it is Advisory alone, not an error', () => {
    /* The state right after the principal has spoken, when nothing is picked yet. */
    const seats = wallOf({ ...loadSave()!, year: 1, plans: {} })
    expect(seats.map((w) => w.name)).toEqual(['Advisory'])
  })
})

describe('what fills a seat', () => {
  it('finishing Advisory fills its frame and says the grade', () => {
    const s = withPlan({
      ledger: [{ id: 'core:y1', kind: 'core', title: 'Advisory', credit: 0.5, grade: 3.6, year: 1, season: 'Fall' }],
    })
    const advisory = wallOf(s)[0]
    expect(advisory.earned).toBe(true)
    expect(advisory.says).toContain('A-')
    expect(onTheWall(s)).toBe(1)
  })

  it('finishing a sport fills its frame with the grade AND the rank', () => {
    const s = withPlan({ completions: [{ programme: 'football', year: 1, grade: 3.2, rank: 'JV', at: 1 }] })
    /* Find it by id, not by the example letter. The letter comes from the programme's place in the
     * list of unbuilt things, so it changes when somebody builds one. */
    const football = wallOf(s).find((w) => w.id === 'programme:football')!
    expect(football.earned).toBe(true)
    expect(football.says).toBe('B+, JV')
  })

  it('a completion from another year does not fill this year\'s frame', () => {
    /* `completions` is keyed by programme and year. If the wall ignored the year, a student who
     * played the same sport twice would see year two's football on year one's wall. */
    const s = withPlan({ completions: [{ programme: 'football', year: 2, grade: 4, rank: 'Varsity', at: 1 }] })
    expect(wallOf(s).find((w) => w.id === 'programme:football')!.earned).toBe(false)
  })

  it('reads the letter from progress.ts rather than rounding on its own', () => {
    /* 3.5 is the line between A- and B+, which is exactly where two different tables would
     * disagree. The yearbook and the wall have to show the same letter for the same grade. */
    const s = withPlan({
      ledger: [{ id: 'core:y1', kind: 'core', title: 'Advisory', credit: 0.5, grade: 3.5, year: 1, season: 'Fall' }],
    })
    expect(wallOf(s)[0].says).toContain('A-')
  })
})
