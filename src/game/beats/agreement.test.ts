/* Every screen that reports a scored thing has to say the same thing about it. */
import { describe, it, expect, beforeEach, vi } from 'vitest'

/* These tests check all three states (untried, failed and passed) on every screen at once. If any
 * new check disagrees with the others, it fails here. */

async function fresh() {
  vi.resetModules()
  const save = await import('../save')
  const state = await import('./state')
  const beats = await import('./beats')
  const classes = await import('./classes')
  const score = await import('./score')
  const year = await import('../run/year')
  const wall = await import('../run/wall')
  const tasks = await import('../run/tasks')
  const objective = await import('../run/objective')
  const { engine } = await import('../intent-engine')
  return { save, state, beats, classes, score, year, wall, tasks, objective, engine }
}

/** Sets up year one with Advisory owed, one class picked and the plan stamped. */
function started(save: Awaited<ReturnType<typeof fresh>>['save']) {
  save.beginAdventure()
  save.writeSave({ introDone: true })
  save.setFlag('maw:founding')
  save.setFlag('vignette:y1')
  save.pickClass(1, 'ap-human-geo')
  save.stampPlan(1)
}

const CORE = {
  id: 'core:y1', title: 'Advisory', kind: 'core' as const,
  credit: 0.5, year: 1, season: 'Fall' as const,
}

describe('every surface agrees about Advisory', () => {
  beforeEach(() => localStorage.clear())

  it('untried: owed by the year, offered by the fire, empty on the wall', async () => {
    const m = await fresh()
    started(m.save)
    const s = m.save.loadSave()!

    expect(m.state.beatState(s, 'core:y1')).toBe('untried')
    expect(m.year.yearStatus(s).coreBeatDone).toBe(false)
    expect(m.year.yearStatus(s).readyForYearbook).toBe(false)
    expect(m.engine.read('advisory'), 'the fire must offer it').toBe('core:y1')
    expect(m.wall.wallOf(s).find((w) => w.id === 'advisory')!.earned).toBe(false)
    expect(m.tasks.tasksOf(s).find((t) => t.id === 'core')!.done).toBe(false)
    expect(m.objective.nextObjective(s)!.phase).toBe('core')
    expect(m.score.retakeAvailable(s, 'core:y1'), 'nothing to retake yet').toBe(false)
  })

  /* A failed beat isn't done, on every screen that reports it. */
  it('failed: still owed, still offered, still empty, and retakeable for ever', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 0.4 })
    const s = m.save.loadSave()!

    expect(m.state.beatState(s, 'core:y1')).toBe('failed')
    expect(m.year.yearStatus(s).coreBeatDone, 'a fail does not close the year').toBe(false)
    expect(m.year.yearStatus(s).coreBeatTried, 'but it is on the record').toBe(true)
    expect(m.year.yearStatus(s).readyForYearbook).toBe(false)
    expect(m.engine.read('advisory'), 'the fire must offer it again').toBe('core:y1')
    expect(m.wall.wallOf(s).find((w) => w.id === 'advisory')!.earned).toBe(false)
    expect(m.wall.wallOf(s).find((w) => w.id === 'advisory')!.wants).toMatch(/again/i)
    expect(m.tasks.tasksOf(s).find((t) => t.id === 'core')!.done).toBe(false)
    expect(m.objective.nextObjective(s)!.phase).toBe('core')
    expect(m.state.retakeKind(s, 'core:y1')).toBe('required')
    expect(m.score.retakeAvailable(s, 'core:y1')).toBe(true)

    /* A second fail doesn't use anything up. The retake stays open. */
    m.save.recordGrade({ ...CORE, grade: 0.8 })
    const s2 = m.save.loadSave()!
    expect(m.state.retakeKind(s2, 'core:y1')).toBe('required')
    expect(m.engine.read('advisory')).toBe('core:y1')
  })

  it('passed: closed everywhere, filled on the wall, and the fire goes quiet', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 3.6 })
    const s = m.save.loadSave()!

    expect(m.state.beatState(s, 'core:y1')).toBe('passed')
    expect(m.year.yearStatus(s).coreBeatDone).toBe(true)
    expect(m.engine.read('advisory'), 'the fire is banked').toBeNull()
    expect(m.wall.wallOf(s).find((w) => w.id === 'advisory')!.earned).toBe(true)
    expect(m.tasks.tasksOf(s).find((t) => t.id === 'core')!.done).toBe(true)
    expect(m.objective.nextObjective(s)!.phase).not.toBe('core')
    /* A comfortable pass isn't offered a retake, and nothing waits on one. */
    expect(m.state.retakeKind(s, 'core:y1')).toBe('none')
  })

  /* This is the school's own Universal Retake, which is a different kind of offer. */
  it('passed but under a B-: offered once, never required', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 2.0 })
    const s = m.save.loadSave()!

    expect(m.state.beatState(s, 'core:y1')).toBe('passed')
    expect(m.year.yearStatus(s).coreBeatDone, 'a pass closes the year whatever the letter').toBe(true)
    expect(m.state.retakeKind(s, 'core:y1')).toBe('offered')
    expect(m.engine.read('advisory'), 'the fire does not chase him for it').toBeNull()

    /* Taking the retake uses it up, and it's never offered again. */
    m.save.recordGrade({ ...CORE, grade: 2.1, retaken: true })
    expect(m.state.retakeKind(m.save.loadSave()!, 'core:y1')).toBe('none')
  })
})

describe('every surface agrees about a class', () => {
  beforeEach(() => localStorage.clear())

  const CLASS = {
    id: 'class:ap-human-geo', title: 'AP Human Geography', kind: 'class' as const,
    credit: 0.5, year: 1, season: 'Fall' as const,
  }

  it('a failed class holds the year open and keeps its button', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 4 })
    m.save.recordGrade({ ...CLASS, grade: 0.5 })
    const s = m.save.loadSave()!

    expect(m.state.beatState(s, 'class:ap-human-geo')).toBe('failed')
    expect(m.year.yearStatus(s).classesPending, 'still owed').toEqual(['ap-human-geo'])
    expect(m.year.yearStatus(s).classesTried, 'and on the record').toEqual(['ap-human-geo'])
    expect(m.year.yearStatus(s).readyForYearbook).toBe(false)
    expect(m.wall.wallOf(s).find((w) => w.id === 'class:ap-human-geo')!.earned).toBe(false)
    expect(m.objective.nextObjective(s)!.say).toContain('AP Human Geography')
  })

  it('and a pass closes it everywhere at once', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 4 })
    m.save.recordGrade({ ...CLASS, grade: 3 })
    const s = m.save.loadSave()!

    expect(m.state.beatState(s, 'class:ap-human-geo')).toBe('passed')
    expect(m.year.yearStatus(s).classesPending).toEqual([])
    expect(m.year.yearStatus(s).readyForYearbook).toBe(true)
    expect(m.wall.wallOf(s).find((w) => w.id === 'class:ap-human-geo')!.earned).toBe(true)
    expect(m.objective.nextObjective(s)!.phase).toBe('yearbook')
  })
})

/* The same rules in year two. The year is part of the id (core:y2), so this catches any code that
 * filters on e.year instead. */
describe('it all works the same in year two', () => {
  beforeEach(() => localStorage.clear())

  it('year one being passed says nothing about year two', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 4 })
    m.save.recordGrade({
      id: 'class:ap-human-geo', title: 'x', kind: 'class', credit: 0.5,
      grade: 4, year: 1, season: 'Fall',
    })
    m.save.setFlag('yearbook:y1')
    m.save.endYear()

    const s = m.save.loadSave()!
    expect(s.year).toBe(2)
    expect(m.state.beatState(s, 'core:y2')).toBe('untried')
    expect(m.year.yearStatus(s).coreBeatDone, 'year two owes its own Advisory').toBe(false)
    expect(m.engine.read('advisory'), 'and the fire offers year two, not year one').toBe('core:y2')
  })

  it('failing year two keeps year two open and leaves year one alone', async () => {
    const m = await fresh()
    started(m.save)
    m.save.recordGrade({ ...CORE, grade: 4 })
    m.save.setFlag('yearbook:y1')
    m.save.endYear()
    m.save.recordGrade({
      id: 'core:y2', title: 'Advisory', kind: 'core', credit: 0.5,
      grade: 0.3, year: 2, season: 'Fall',
    })

    const s = m.save.loadSave()!
    expect(m.state.beatState(s, 'core:y2')).toBe('failed')
    expect(m.state.beatState(s, 'core:y1'), 'year one is still passed').toBe('passed')
    expect(m.engine.read('advisory')).toBe('core:y2')
    expect(m.year.yearStatus(s).coreBeatDone).toBe(false)
    expect(m.year.yearStatus(s, 1).coreBeatDone, 'and last year still reads finished').toBe(true)
  })
})
