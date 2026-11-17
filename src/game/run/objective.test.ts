/* Tests for where the year sends the player, and the phase an island reads from it. */
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function fresh() {
  vi.resetModules()
  const save = await import('../save')
  const objective = await import('./objective')
  return { save, objective }
}

beforeEach(() => { localStorage.clear() })

/** A run standing at the tunnel with nothing done yet. */
const started = (save: Awaited<ReturnType<typeof fresh>>['save']) => {
  save.beginAdventure()
  save.writeSave({ introDone: true })
}

describe('the phase an island reads', () => {
  it('is "founding" before the principal has been met', async () => {
    const { save, objective } = await fresh()
    started(save)
    expect(objective.nextObjective(save.loadSave())!.phase).toBe('founding')
  })

  it('is "plan" once the founding is written and the sheet is not stamped', async () => {
    const { save, objective } = await fresh()
    started(save)
    save.setFlag(objective.FOUNDING_FLAG)
    save.setFlag('vignette:y1')
    expect(objective.nextObjective(save.loadSave())!.phase).toBe('plan')
  })

  it('is "core" with the sheet stamped and Advisory not sat', async () => {
    const { save, objective } = await fresh()
    started(save)
    save.setFlag(objective.FOUNDING_FLAG)
    save.setFlag('vignette:y1')
    save.pickClass(1, 'ap-human-geo')
    save.stampPlan(1)
    expect(objective.nextObjective(save.loadSave())!.phase).toBe('core')
  })

  /* The closing film depends on this one. Everything for the year is done and the yearbook page
   * hasn't been seen, so the ending comes next. `year_is_done` in islands/panther-maw/founding.py
   * checks for this exact string. */
  it('is "yearbook" when the year has nothing left owing', async () => {
    const { save, objective } = await fresh()
    started(save)
    save.setFlag(objective.FOUNDING_FLAG)
    save.setFlag('vignette:y1')
    save.pickClass(1, 'ap-human-geo')
    save.stampPlan(1)
    save.recordGrade({
      id: 'core:y1', title: 'POWER, Mondays, and joining a club', kind: 'core',
      credit: 0.5, grade: 4, year: 1, season: 'Fall',
    })
    /* Also finish the picked class. The year isn't done until every pick that has gameplay behind
     * it is done, and in year one that's only the class. */
    save.recordGrade({
      id: 'class:ap-human-geo', title: 'AP Human Geography', kind: 'class',
      credit: 0.5, grade: 4, year: 1, season: 'Fall',
    })
    const o = objective.nextObjective(save.loadSave())!
    expect(o.phase).toBe('yearbook')
    /* It points at the principal, because the ending is the principal's film. A student who left
     * the film presses this desk to get back to it. */
    expect(o.role).toBe('principal')
  })

  /* The line shown out on the quay is the one that starts the ending. */
  it('and it sends him back in through the tunnel, not out to sea', async () => {
    const { save, objective } = await fresh()
    started(save)
    save.setFlag(objective.FOUNDING_FLAG)
    save.setFlag('vignette:y1')
    save.pickClass(1, 'ap-human-geo')
    save.stampPlan(1)
    save.recordGrade({
      id: 'core:y1', title: 'POWER, Mondays, and joining a club', kind: 'core',
      credit: 0.5, grade: 4, year: 1, season: 'Fall',
    })
    save.recordGrade({
      id: 'class:ap-human-geo', title: 'AP Human Geography', kind: 'class',
      credit: 0.5, grade: 4, year: 1, season: 'Fall',
    })
    const o = objective.nextObjective(save.loadSave())
    expect(objective.objectiveLine(o, 'hub')).toBe('Go back to the Maw. The principal is waiting.')
    /* Inside the Maw it says the other half instead. Telling a student who's already in the Maw to
     * go back there asks for something already done, and the year closes at the chart table right
     * next to the principal. */
    expect(objective.objectiveLine(o, 'panther-maw')).toBe('Find the principal. Year one is done.')
  })
})

describe('a closed year asks for nothing', () => {
  /* A finished year has no objective, because the only thing left after the page turns is the
   * ending. */
  it('says nothing at all once the page has turned', async () => {
    const { save, objective } = await fresh()
    started(save)
    save.setFlag(objective.FOUNDING_FLAG)
    save.setFlag('vignette:y1')
    save.pickClass(1, 'ap-human-geo')
    save.stampPlan(1)
    save.recordGrade({
      id: 'core:y1', title: 'POWER, Mondays, and joining a club', kind: 'core',
      credit: 0.5, grade: 4, year: 1, season: 'Fall',
    })
    save.setFlag('yearbook:y1')
    expect(objective.nextObjective(save.loadSave())).toBeNull()
    /* An empty objective draws no bar at all, because `hud/Objective.tsx` returns null for an empty
     * sentence. */
    expect(objective.objectiveLine(null, 'panther-maw')).toBe('')
  })

  /* The next year brings objectives back. That's what the title screen's 'Start year 2' does:
   * `endYear` moves to the next year, so it isn't finished anymore. */
  it('and asks again the moment the next year starts', async () => {
    const { save, objective } = await fresh()
    started(save)
    save.setFlag(objective.FOUNDING_FLAG)
    save.setFlag('vignette:y1')
    save.setFlag('yearbook:y1')
    expect(objective.nextObjective(save.loadSave())).toBeNull()
    save.endYear()
    const o = objective.nextObjective(save.loadSave())
    expect(o, 'year two opens with nothing lit').not.toBeNull()
    expect(o!.phase).toBe('vignette')
  })
})
