/* Checks that a member's roster row goes live without any code change in src. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** One fake row, in the same shape `member-islands.ts` gives the roster. */
const fakeRow = {
  programme: 'example-island',
  name: 'The Example Island',
  place: 'home-island',
  kind: 'club' as const,
  season: 'Fall' as const,
  tags: ['stem'],
  rankTrack: undefined,
  playable: true,
  blurb: 'A member built this one.',
  host: undefined,
  source: 'a test',
}

beforeEach(() => {
  vi.resetModules()
  vi.doUnmock('./member-islands')
})

describe('what is real and what is a placeholder', () => {
  it('calls every club and sport on the shipped roster a placeholder', async () => {
    const { PROGRAMMES } = await import('./roster')
    const { exampleNameOf } = await import('./placeholders')
    /* A playable programme keeps its real name. The placeholder name is only for things nobody has
     * built. */
    for (const p of PROGRAMMES) {
      if (p.playable) {
        expect(exampleNameOf(p.id), `${p.id} is playable and should keep its name`).toBeNull()
        continue
      }
      expect(exampleNameOf(p.id), `${p.id} should be an Example`).toMatch(/^Example [A-Z]+$/)
    }
  })

  it('numbers them from A with no holes and no repeats', async () => {
    const { PROGRAMMES } = await import('./roster')
    const { exampleNameOf } = await import('./placeholders')
    const names = PROGRAMMES.map((p) => exampleNameOf(p.id))
    expect(names[0]).toBe('Example A')
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps every elective its real name and calls none of them real yet', async () => {
    const { CLASSES } = await import('../planner/catalog')
    const { classIsReal, exampleNameOf } = await import('./placeholders')
    for (const c of CLASSES) {
      expect(classIsReal(c.id), `${c.id} claims an island`).toBe(false)
      /* This is the rule that separates the two lists: a class keeps its real name. */
      expect(exampleNameOf(c.id)).toBeNull()
    }
  })

  /* ---- AND THE ROW GOES LIVE, WHICH IS THE WHOLE POINT ------------------- */

  it('makes a member island real, pickable and named, with no code change', async () => {
    vi.doMock('./member-islands', () => ({ MEMBER_ISLANDS: [fakeRow] }))
    const { PROGRAMMES, isPlayable } = await import('./roster')
    const { exampleNameOf, programmeIsReal, shownName } = await import('./placeholders')

    const row = PROGRAMMES.find((p) => p.id === 'example-island')
    expect(row, 'the roster did not read the row at all').toBeTruthy()
    expect(programmeIsReal('example-island')).toBe(true)
    expect(isPlayable('example-island')).toBe(true)
    /* It isn't an Example. It has a real name, and that name is the one the member gave it. */
    expect(exampleNameOf('example-island')).toBeNull()
    expect(shownName('example-island', row!.name)).toBe('The Example Island')

    /* The five programmes nobody has built are still placeholders next to it. */
    expect(programmeIsReal('football')).toBe(false)
    expect(exampleNameOf('football')).toMatch(/^Example [A-Z]+$/)
  })

  it('makes an ELECTIVE real the same way, by a row that names the class id', async () => {
    /* A programme becomes pickable as soon as a member-islands row uses its id, with no code
     * change. */
    vi.doMock('./member-islands', () => ({
      MEMBER_ISLANDS: [{ ...fakeRow, programme: 'spanish-1', name: 'Spanish I', kind: 'class' as const }],
    }))
    const { classIsReal } = await import('./placeholders')
    expect(classIsReal('spanish-1')).toBe(true)
    expect(classIsReal('french-1')).toBe(false)
  })
})
