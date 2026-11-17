// Tests for the save logic: the single save, the functions that write to it, moving old saves over,
// and staying correct with more than one tab open.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const KEY = 'blhs_save_v2'

// save.ts keeps its data in module variables, so every test loads a fresh copy of the modules.
async function freshModule() {
  vi.resetModules()
  return await import('./save')
}

beforeEach(() => {
  localStorage.clear()
})

describe('the single run', () => {
  it('has no save until Begin Adventure', async () => {
    const save = await freshModule()
    expect(save.loadSave()).toBeNull()
    expect(save.hasSave()).toBe(false)
  })

  it('beginAdventure starts a fresh Year-1 run with all three tokens', async () => {
    const save = await freshModule()
    const s = save.beginAdventure()
    expect(s.year).toBe(1)
    expect(s.season).toBe('Fall')
    expect(s.tokens).toEqual(['Fall', 'Winter', 'Spring'])
    expect(s.beat).toBe('intro:i1')
    expect(s.introDone).toBe(false)
    expect(save.loadSave()?.id).toBe(s.id)
  })

  it('writeSave patches and stamps savedAt', async () => {
    const save = await freshModule()
    save.beginAdventure()
    const s = save.writeSave({ handle: 'BraveTide' })
    expect(s.handle).toBe('BraveTide')
    expect(s.savedAt).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem(KEY)!).handle).toBe('BraveTide')
  })

  it('writeSave merges from RAW storage, not this tab cache (stale-tab honesty)', async () => {
    const save = await freshModule()
    save.beginAdventure()
    save.loadSave() // Load the save into the cache.
    // Another tab finishes the intro without this tab knowing.
    const other = { ...JSON.parse(localStorage.getItem(KEY)!), introDone: true, beat: 'island:arrive' }
    localStorage.setItem(KEY, JSON.stringify(other))
    // An out-of-date tab saving a settings change must not undo the other tab's progress.
    const s = save.writeSave({ handle: 'LateTab' })
    expect(s.introDone).toBe(true)
    expect(s.beat).toBe('island:arrive')
    expect(s.handle).toBe('LateTab')
  })

  it('a storage event from another tab invalidates the cache', async () => {
    const save = await freshModule()
    save.beginAdventure()
    expect(save.loadSave()?.handle).toBe('')
    const other = { ...JSON.parse(localStorage.getItem(KEY)!), handle: 'OtherTab' }
    localStorage.setItem(KEY, JSON.stringify(other))
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(save.loadSave()?.handle).toBe('OtherTab')
  })

  it('clearSave wipes everything including legacy keys', async () => {
    const save = await freshModule()
    save.beginAdventure()
    localStorage.setItem('blhs_save_v1', '{}')
    save.clearSave()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem('blhs_save_v1')).toBeNull()
    expect(save.loadSave()).toBeNull()
  })
})

describe('migration', () => {
  it('migrates a v1 save into v2 with defaults filled', async () => {
    localStorage.setItem('blhs_save_v1', JSON.stringify({ handle: 'OldSalt', introDone: true }))
    const save = await freshModule()
    const s = save.loadSave()
    expect(s?.v).toBe(2)
    expect(s?.handle).toBe('OldSalt')
    expect(s?.introDone).toBe(true)
    expect(s?.tokens).toEqual(['Fall', 'Winter', 'Spring'])
    expect(localStorage.getItem('blhs_save_v1')).toBeNull()
  })

  it('roster migration honors the active pointer over recency', async () => {
    const a = { v: 2, id: 'ra', handle: 'ActiveRun', year: 2, season: 'Fall', beat: 'x', introDone: true, tokens: [], ledger: [], ranks: {}, islands: {}, stickers: [], facts: [], badges: [], savedAt: 100, pronouns: '', boatName: '' }
    const b = { ...a, id: 'rb', handle: 'NewerRun', savedAt: 200 }
    localStorage.setItem('blhs_saves', JSON.stringify([a, b]))
    localStorage.setItem('blhs_active', 'ra')
    const save = await freshModule()
    expect(save.loadSave()?.handle).toBe('ActiveRun')
    expect(localStorage.getItem('blhs_saves')).toBeNull()
  })

  it('roster migration falls back to the newest run without a pointer', async () => {
    const a = { v: 2, id: 'ra', handle: 'OldRun', year: 1, season: 'Fall', beat: 'x', introDone: false, tokens: [], ledger: [], ranks: {}, islands: {}, stickers: [], facts: [], badges: [], savedAt: 100, pronouns: '', boatName: '' }
    const b = { ...a, id: 'rb', handle: 'NewRun', savedAt: 200 }
    localStorage.setItem('blhs_saves', JSON.stringify([a, b]))
    const save = await freshModule()
    expect(save.loadSave()?.handle).toBe('NewRun')
  })
})

describe('domain verbs', () => {
  it('refuse to conjure a phantom run (no save, no write)', async () => {
    const save = await freshModule()
    expect(save.collectFact('f1')).toBeNull()
    expect(save.collectSticker('s1')).toBeNull()
    expect(save.grantBadge('b1')).toBeNull()
    expect(save.spendToken('Fall')).toBeNull()
    expect(save.endYear()).toBeNull()
    expect(save.recordGrade({ id: 'g', title: 't', kind: 'island', credit: 1, grade: 4, year: 1, season: 'Fall' })).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('collectFact / collectSticker / grantBadge are idempotent', async () => {
    const save = await freshModule()
    save.beginAdventure()
    save.collectFact('f1'); save.collectFact('f1')
    save.collectSticker('s1'); save.collectSticker('s1')
    save.grantBadge('b1'); save.grantBadge('b1')
    const s = save.loadSave()!
    expect(s.facts).toEqual(['f1'])
    expect(s.stickers).toEqual(['s1'])
    expect(s.badges).toEqual(['b1'])
  })

  it('recordGrade keeps the best attempt and marks the retake', async () => {
    const save = await freshModule()
    save.beginAdventure()
    const base = { id: 'isl:atc', title: 'ATC', kind: 'island' as const, credit: 1, year: 1, season: 'Fall' as const }
    save.recordGrade({ ...base, grade: 2.0 })
    save.recordGrade({ ...base, grade: 1.0, retaken: true })   // Worse retake: the grade is dropped.
    expect(save.loadSave()!.ledger[0].grade).toBe(2.0)
    /* The retake is still used up. Taking a passed grade again uses it, whether or not it goes
     * well. */
    expect(save.loadSave()!.ledger[0].retaken).toBe(true)
    save.recordGrade({ ...base, grade: 3.5, retaken: true })   // Better: the grade is kept.
    expect(save.loadSave()!.ledger[0].grade).toBe(3.5)
    expect(save.loadSave()!.ledger[0].retaken).toBe(true)
    expect(save.loadSave()!.ledger).toHaveLength(1)
  })

  /* `retaken` is the school's one-time grade improvement, and climbing back from a fail must not
   * use it up. Otherwise a fail, a second try and a barely passed C would leave no way to improve
   * the C. `beats/state.ts` reads this flag to decide whether to offer the retake. */
  it('does not spend the retake on a sitting that was climbing out of a fail', async () => {
    const save = await freshModule()
    save.beginAdventure()
    const base = { id: 'core:y1', title: 'Advisory', kind: 'core' as const, credit: 0.5, year: 1, season: 'Fall' as const }
    save.recordGrade({ ...base, grade: 0.4 })
    save.recordGrade({ ...base, grade: 0.8, retaken: true })
    expect(save.loadSave()!.ledger[0].retaken, 'still failing, nothing spent').toBeUndefined()
    save.recordGrade({ ...base, grade: 2.0, retaken: true })
    expect(save.loadSave()!.ledger[0].grade).toBe(2.0)
    expect(save.loadSave()!.ledger[0].retaken, 'the sitting that PASSED did not spend it either').toBeUndefined()
    /* Now the retake really gets used, because the row being taken again had already passed. */
    save.recordGrade({ ...base, grade: 2.2, retaken: true })
    expect(save.loadSave()!.ledger[0].retaken).toBe(true)
  })

  /* The passing grade is typed out in `save.ts` because importing it would make a circular import.
   * This test makes sure both places use the same number. */
  it('uses the same passing grade the rest of the game does', async () => {
    const { PASSING_GRADE } = await import('./progress')
    const src = (await import('node:fs')).readFileSync('src/game/save.ts', 'utf8')
    expect(src, 'save.ts no longer spells the passing grade as a literal')
      .toContain(`was.grade >= ${PASSING_GRADE.toFixed(1)}`)
  })

  it('counts every attempt and keeps the FIRST grade as well as the best', async () => {
    const save = await freshModule()
    save.beginAdventure()
    const base = { id: 'core:y1', title: 'Advisory', kind: 'core' as const, credit: 0.5, year: 1, season: 'Fall' as const }
    save.recordGrade({ ...base, grade: 2.0 })
    expect(save.loadSave()!.ledger[0].attempts).toBe(1)
    expect(save.loadSave()!.ledger[0].firstGrade).toBe(2.0)
    save.recordGrade({ ...base, grade: 1.0 })          // Played it again and did worse.
    expect(save.loadSave()!.ledger[0].attempts).toBe(2)  // It still counts as a try.
    expect(save.loadSave()!.ledger[0].grade).toBe(2.0)
    save.recordGrade({ ...base, grade: 3.5 })
    const row = save.loadSave()!.ledger[0]
    expect(row.attempts).toBe(3)
    expect(row.grade).toBe(3.5)                        // The best grade.
    expect(row.firstGrade).toBe(2.0)                   // And the first grade is still there.
  })

  it('exposure is per place per year and remembers whether they ever docked', async () => {
    const save = await freshModule()
    save.beginAdventure()
    save.recordExposure('stadium')                      // Sailed past.
    save.recordExposure('stadium')                      // Sailed past again, same year.
    expect(save.loadSave()!.exposure).toEqual([{ place: 'stadium', year: 1, docked: false }])
    save.recordExposure('stadium', true)                // Got off the boat.
    expect(save.loadSave()!.exposure![0].docked).toBe(true)
    save.recordExposure('stadium')                      // Sailing past later can't undo the docking.
    expect(save.loadSave()!.exposure![0].docked).toBe(true)
    save.endYear()
    save.recordExposure('stadium')
    expect(save.loadSave()!.exposure).toHaveLength(2)    // A second year is a second row.
  })

  it('completion is per programme per year, and a stamp never erases it', async () => {
    const save = await freshModule()
    save.beginAdventure()
    save.recordCompletion('football', 3.4, 'football')
    expect(save.completedIn(save.loadSave()!, 'football', 1)).toBe(true)
    expect(save.completedIn(save.loadSave()!, 'girls-flag-football', 1)).toBe(false)

    // Year two: the same programme goes in a slot again, and the stamp leaves the completed row
    // alone.
    save.setIslandState('football', 'completed')
    save.endYear()
    save.assignSlot(2, 'Fall', 'football')
    save.stampPlan(2, ['football'])
    expect(save.loadSave()!.islands.football).toBe('completed')   // Year one's completion is still there.
    expect(save.completedIn(save.loadSave()!, 'football', 1)).toBe(true)
    expect(save.completedIn(save.loadSave()!, 'football', 2)).toBe(false)  // Year two isn't done yet.

    save.recordCompletion('football', 3.8, 'football')
    expect(save.yearsCompleted(save.loadSave()!, 'football')).toEqual([1, 2])
  })

  it('a place shown three times and a programme finished three times are different numbers', async () => {
    const save = await freshModule()
    save.beginAdventure()
    for (const y of [1, 2, 3]) {
      save.recordExposure('stadium', true)
      save.recordCompletion('football', 3, 'football')
      if (y < 3) save.endYear()
    }
    const s = save.loadSave()!
    expect(s.exposure).toHaveLength(3)          // One place, seen in three years.
    expect(s.completions).toHaveLength(3)       // One programme, finished in three years.
    expect(new Set(s.exposure!.map((e) => e.place)).size).toBe(1)
    expect(new Set(s.completions!.map((c) => c.programme)).size).toBe(1)
  })

  it('spendToken spends each season exactly once', async () => {
    const save = await freshModule()
    save.beginAdventure()
    expect(save.spendToken('Fall')).not.toBeNull()
    expect(save.spendToken('Fall')).toBeNull()          // Already spent.
    expect(save.loadSave()!.tokens).toEqual(['Winter', 'Spring'])
  })

  it('endYear advances, refills tokens, and is TERMINAL at year 4', async () => {
    const save = await freshModule()
    save.beginAdventure()
    save.spendToken('Fall'); save.spendToken('Winter'); save.spendToken('Spring')
    save.endYear()   // Now year 2.
    expect(save.loadSave()!.year).toBe(2)
    expect(save.loadSave()!.tokens).toEqual(['Fall', 'Winter', 'Spring'])
    save.endYear(); save.endYear()   // Now year 4.
    expect(save.loadSave()!.year).toBe(4)
    save.spendToken('Fall'); save.spendToken('Winter'); save.spendToken('Spring')
    const s = save.endYear()   // The fourth one graduates. Senior year doesn't repeat.
    expect(s?.graduated).toBe(true)
    expect(s?.year).toBe(4)
    expect(s?.tokens).toEqual([])   // Not refilled.
  })
})
