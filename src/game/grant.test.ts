/* Tests for grant. Whatever a student earns has to show up on screen and get announced to the
 * world. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SaveGame } from './save'
import { GRANT_EVENT, grant } from './grant'
import { bookwormThreshold } from './badges'

const run = (over: Partial<SaveGame> = {}): SaveGame => ({
  v: 2, id: 'r_t', handle: 'BraveTide', pronouns: 'they/them', boatName: 'Kestrel',
  year: 1, season: 'Fall', beat: 'maw:arrive', introDone: true,
  plans: {}, flags: [], tokens: ['Fall', 'Winter', 'Spring'],
  ledger: [], ranks: {}, islands: {}, exposure: [], completions: [],
  stickers: [], facts: [], badges: [], savedAt: 0,
  ...over,
} as unknown as SaveGame)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

/** Every card on the feedback layer right now, in the order it was shown. */
const cards = () => [...document.querySelectorAll('#kit-feedback *')]
  .map((el) => el.textContent ?? '')
  .filter(Boolean)

describe('a grant says so', () => {
  it('puts what was earned on the screen', () => {
    const s = run()
    grant(s, s, { what: 'Football is done.', detail: 'It goes on your transcript.' })
    expect(cards().join(' ')).toContain('Football is done.')
  })

  it('tells the world, so a wall can dress itself at the moment it fills', () => {
    /* An island redraws its own placements when the player arrives and when they press something. */
    const heard = vi.fn()
    window.addEventListener(GRANT_EVENT, heard)
    const s = run()
    grant(s, s, { what: 'That counted.' })
    window.removeEventListener(GRANT_EVENT, heard)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('says a badge the run has just crossed the line for, which nothing writes down', () => {
    /* Bookworm comes from counting facts against the whole list, so it never gets saved anywhere. */
    const facts = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`)
    const before = run({ facts: facts(bookwormThreshold - 1) })
    const after = run({ facts: facts(bookwormThreshold) })
    grant(before, after, { what: 'That went in the Handbook.' })

    // The thing the player did shows first, on its own. The badge comes after it.
    expect(cards().join(' ')).toContain('That went in the Handbook.')
    expect(cards().join(' ')).not.toContain('Bookworm')
    vi.advanceTimersByTime(2700)
    expect(cards().join(' ')).toContain('Bookworm')
  })

  it('says nothing extra when nothing extra was crossed', () => {
    const before = run({ facts: ['a'] })
    const after = run({ facts: ['a', 'b'] })
    grant(before, after, { what: 'That went in the Handbook.' })
    expect(cards().join(' ')).toContain('That went in the Handbook.')
    /* Once the first card's time is up and the queue is done, the corner is empty. */
    vi.advanceTimersByTime(2700)
    expect(cards()).toEqual([])
  })

  it('is a no-op with no run rather than a crash inside a member’s own line', () => {
    expect(() => grant(null, null, { what: 'nothing' })).not.toThrow()
    expect(cards()).toEqual([])
  })

  it('never throws into the caller, because the grant itself already happened', () => {
    /* award saves first and shows the card second. So if something throws, only the card is lost
     * and the grade is still saved. */
    const broken = { get facts(): string[] { throw new Error('bad row') } } as unknown as SaveGame
    expect(() => grant(broken, run(), { what: 'Track is done.' })).not.toThrow()
  })
})
