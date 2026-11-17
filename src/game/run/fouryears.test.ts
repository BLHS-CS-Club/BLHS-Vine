/* Tests that play all four years through and check what the student ends up with. */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/* These tests play four whole years instead of unit testing `cordsOf` on its own. The bugs they
 * catch, like a capped GPA, a diploma that says "Islands completed: 0", or ranks that never go up,
 * happen where two working pieces meet. */

async function fresh() {
  vi.resetModules()
  const save = await import('../save')
  const progress = await import('../progress')
  const year = await import('./year')
  const pick = await import('./pick')
  const beats = await import('../beats/beats')
  const diploma = await import('./diploma')
  return { save, progress, year, pick, beats, diploma }
}

type M = Awaited<ReturnType<typeof fresh>>

/**
 * Plays one year: pick classes, stamp the plan, get a perfect grade in Advisory, finish every pick,
 * and close the yearbook.
 */
function playYear(m: M, y: number, classes: string[], club: string | null) {
  const { save } = m
  save.setFlag(`vignette:y${y}`)
  for (const c of classes) save.pickClass(y, c)
  if (club) save.assignSlot(y, 'Fall', club)
  save.stampPlan(y, club ? [club] : [])
  save.recordGrade({
    id: m.beats.coreBeatId(y), title: 'Advisory', kind: 'core',
    credit: 0.5, grade: 4, year: y, season: 'Fall',
  })
  /* Finish every pick using the same button the year sheet gives the player. */
  for (const p of m.pick.picksOf(save.loadSave(), y)) {
    if (!p.done) m.pick.countAsDone(p)
  }
  save.setFlag(`yearbook:y${y}`)
}

describe('four years, played', () => {
  beforeEach(() => localStorage.clear())

  it('reaches a GPA the honours cords can actually be earned at', async () => {
    const m = await fresh()
    m.save.beginAdventure()
    m.save.writeSave({ introDone: true })
    m.save.setFlag('maw:founding')

    playYear(m, 1, ['ap-human-geo', 'spanish-1'], 'football')
    m.save.endYear()
    playYear(m, 2, ['ap-seminar', 'spanish-2'], 'football')
    m.save.endYear()
    playYear(m, 3, ['ap-research', 'spanish-3'], 'football')
    m.save.endYear()
    playYear(m, 4, ['ap-lang', 'spanish-4'], 'football')

    const s = m.save.loadSave()!
    const gpa = m.progress.gpaOf(s)
    /* A placeholder pick has no credit, so it can't drag the GPA down. */
    expect(gpa, 'a perfect Advisory every year is a perfect GPA').toBe(4)
    expect(gpa!).toBeGreaterThanOrEqual(3.76)
  })

  it('advances a rank ladder across the years it was picked in', async () => {
    const m = await fresh()
    m.save.beginAdventure()
    m.save.writeSave({ introDone: true })

    playYear(m, 1, ['ap-human-geo'], 'football')
    expect(m.progress.rankName(m.progress.ranksOf(m.save.loadSave()!).football ?? 0)).toBe('JV')
    m.save.endYear()

    playYear(m, 2, ['spanish-1'], 'football')
    expect(m.progress.rankName(m.progress.ranksOf(m.save.loadSave()!).football ?? 0)).toBe('Varsity')
    m.save.endYear()

    playYear(m, 3, ['spanish-2'], 'football')
    expect(m.progress.rankName(m.progress.ranksOf(m.save.loadSave()!).football ?? 0)).toBe('Captain')
  })

  /* One finish counts as one attempt, because setIslandState writes a single completion. */
  it('counts one finish as one attempt', async () => {
    const m = await fresh()
    m.save.beginAdventure()
    m.save.writeSave({ introDone: true })
    playYear(m, 1, ['ap-human-geo'], 'football')
    const row = m.save.loadSave()!.completions!.find((c) => c.programme === 'football')!
    expect(row.attempts).toBe(1)
  })

  it('tells the diploma how many islands were finished', async () => {
    const m = await fresh()
    m.save.beginAdventure()
    m.save.writeSave({ introDone: true })
    playYear(m, 1, ['ap-human-geo'], 'football')

    const s = m.save.loadSave()!
    /* The world and the diploma both read what `setIslandState` writes. Finishing a pick from the
     * year sheet has to call it too, or the diploma says "Islands completed: 0". */
    expect(s.islands.football).toBe('completed')
  })

  /* An island that finishes without a score should say "finished" instead of showing an F. */
  it('does not print an F for a programme that finished without a grade', async () => {
    const m = await fresh()
    m.save.beginAdventure()
    m.save.writeSave({ introDone: true })
    m.save.pickClass(1, 'ap-human-geo')
    m.save.assignSlot(1, 'Fall', 'football')
    m.save.stampPlan(1, ['football'])
    m.save.recordCompletion('football', null)

    const { wallOf } = await import('./wall')
    const seat = wallOf(m.save.loadSave())!.find((w) => w.id === 'programme:football')!
    expect(seat.earned).toBe(true)
    expect(seat.says).toBe('finished')
    expect(seat.says).not.toContain('F')
  })
})
