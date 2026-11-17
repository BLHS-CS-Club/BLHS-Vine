// Tests for the year loop: working out the year's status, the nudge line, the class beat generator
// and closing a year. The generator test runs over the whole real catalog, because every generated
// question must have exactly one correct answer.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { classBeat } from '../beats/classes'
import { CLASSES, classById } from '../planner/catalog'
import { checksOf } from '../beats/frames'
import { programmeById } from '../roster/roster'

async function freshSave() {
  vi.resetModules()
  return await import('../save')
}
async function freshYear() {
  const save = await import('../save')
  const year = await import('./year')
  return { save, year }
}
beforeEach(() => { localStorage.clear() })

describe('classBeat generation (real catalog, zero invented content)', () => {
  it('every class in the catalog generates a valid beat: one correct option per check', () => {
    for (const c of CLASSES) {
      const b = classBeat(c, 1)
      expect(b.id).toBe(`class:${c.id}`)
      expect(b.kind).toBe('class')
      expect(b.tags).toEqual(c.tags)
      const checks = checksOf(b)
      expect(checks.length).toBeGreaterThanOrEqual(1)
      for (const ch of checks) {
        if (ch.kind !== 'choice') throw new Error('class checks are choices')
        expect(ch.options.filter((o) => o.correct).length, `${c.id}:${ch.id}`).toBe(1)
      }
    }
  })
  it('the cord answer matches the class truth', () => {
    const correctText = (id: string) => {
      const b = classBeat(classById(id)!, 1)
      const ch = checksOf(b)[0]
      if (ch.kind !== 'choice') throw new Error()
      return ch.options.find((o) => o.correct)!.text
    }
    expect(correctText('ap-human-geo')).toContain('AP Honors')
    expect(correctText('culinary-1')).toContain('Career Readiness')
    expect(correctText('spanish-4')).toContain('Seal')
    expect(correctText('ap-cs-java')).toContain('Two at once')
    expect(correctText('band')).toContain('No cord')
  })
  it('chained classes get the ladder check; open ones do not', () => {
    expect(checksOf(classBeat(classById('spanish-2')!, 2))).toHaveLength(2)
    expect(checksOf(classBeat(classById('ap-human-geo')!, 1))).toHaveLength(1)
  })
})

describe('yearStatus (§7.5 derived, resumable anywhere)', () => {
  it('walks a whole Year 1 to the yearbook and closes it', async () => {
    const save = await freshSave()
    const { yearStatus, nudgeLine } = await import('./year')
    save.beginAdventure()
    save.writeSave({ introDone: true })

    let st = yearStatus(save.loadSave()!)
    expect(st.planStamped).toBe(false)
    expect(st.readyForYearbook).toBe(false)

    // Plan the year: football in Fall, atc in Winter, two classes, then stamp it.
    save.assignSlot(1, 'Fall', 'football')
    save.assignSlot(1, 'Winter', 'atc')
    save.pickClass(1, 'ap-human-geo'); save.pickClass(1, 'spanish-1')
    save.stampPlan(1, ['football', 'atc'])

    st = yearStatus(save.loadSave()!)
    expect(st.planStamped).toBe(true)
    expect(st.readyForYearbook).toBe(false)            // Advisory and both classes are still to do.
    /* Each voyage is named after the programme it points at, in season order. */
    expect(st.voyages.map((v) => v.name))
      .toEqual([programmeById('football')!.name, programmeById('atc')!.name])
    /* This checks the exact pair instead of using `every`, so it fails and gets looked at when the
     * next island is built. Football has no island yet, while ATC has a painting, a berth and an
     * island. */
    expect(st.voyages.map((v) => v.playable)).toEqual([false, true])

    // Finish Advisory and both classes.
    save.recordGrade({ id: 'core:y1', title: 't', kind: 'core', credit: 0.5, grade: 4, year: 1, season: 'Fall' })
    save.recordGrade({ id: 'class:ap-human-geo', title: 't', kind: 'class', credit: 0.5, grade: 4, year: 1, season: 'Fall', tags: ['ap'] })
    st = yearStatus(save.loadSave()!)
    expect(st.classesPending).toEqual(['spanish-1'])
    save.recordGrade({ id: 'class:spanish-1', title: 't', kind: 'class', credit: 0.5, grade: 3.43, year: 1, season: 'Winter', tags: ['lang'] })

    /* Every pick keeps the year open, clubs included. Each pick has one button that always finishes
     * it. */
    st = yearStatus(save.loadSave()!)
    expect(st.readyForYearbook).toBe(false)            // The two clubs are still to do.
    expect(nudgeLine(st)).toContain('not open yet')

    /* Pressing each club's button counts it (`run/pick.ts`, `countAsDone`). */
    save.recordCompletion('football', 3)
    save.recordCompletion('atc', 3)
    st = yearStatus(save.loadSave()!)
    expect(st.readyForYearbook).toBe(true)

    // Turn the yearbook page.
    save.setFlag('yearbook:y1')
    save.endYear()
    const s2 = save.loadSave()!
    expect(s2.year).toBe(2)
    expect(s2.tokens).toEqual(['Fall', 'Winter', 'Spring'])
    const st2 = yearStatus(s2)
    expect(st2.planStamped).toBe(false)                // Year 2 starts with a fresh sheet.
    expect(st2.vignetteSeen).toBe(false)               // The year 2 vignette hasn't played yet.
  })

  /* The yearbook never nudges a student about a season they left empty. */
  it('never nudges about a season, because no student was ever shown one', async () => {
    const { save, year } = await freshYear()
    vi.resetModules()
    const s = await import('../save')
    const y = await import('./year')
    s.beginAdventure()
    s.assignSlot(1, 'Fall', 'atc')
    s.pickClass(1, 'ap-human-geo'); s.pickClass(1, 'band')
    s.stampPlan(1, ['atc'])
    s.setIslandState('atc', 'completed')
    const st = y.yearStatus(s.loadSave()!)
    const line = y.nudgeLine(st).toLowerCase()
    expect(line).not.toMatch(/fall|winter|spring|season token/)
    /* It still says something true: two classes on the sheet, neither one tried. */
    expect(line).toContain('classes')
    void save; void year
  })

  it('flags are one-shot and idempotent', async () => {
    const save = await freshSave()
    save.beginAdventure()
    save.setFlag('vignette:y1'); save.setFlag('vignette:y1')
    expect(save.loadSave()!.flags).toEqual(['vignette:y1'])
    expect(save.hasFlag('vignette:y1')).toBe(true)
    expect(save.hasFlag('vignette:y2')).toBe(false)
  })
})
