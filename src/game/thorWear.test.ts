/* Tests for what Thor wears, and the checks that stop a card from offering an outfit with no art. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BARE, WEAR, canWear, poseFrame, walkFrame, wearById, wornKey } from './thorWear'
import type { SaveGame } from './save'

const DIRS8 = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
const here = (p: string) => path.resolve(process.cwd(), p)

const run = (over: Partial<SaveGame> = {}): SaveGame => ({
  v: 2, id: 'r', handle: 'BraveTide', pronouns: 'they/them', boatName: 'K',
  year: 1, season: 'Fall', beat: 'maw:arrive', introDone: true,
  plans: {}, flags: [], tokens: [], ranks: {}, islands: {}, exposure: [],
  completions: [], stickers: [], facts: [], badges: [], ledger: [], savedAt: 1,
  ...over,
} as SaveGame)

describe('the outfit slot', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('answers the bare panther for a run wearing nothing', () => {
    expect(walkFrame(run(), 'south', 0)).toBe('/art/characters/thor/walk/south/0.png')
    expect(poseFrame(run(), 'sit')).toBe('/art/characters/thor/pose/sit.png')
    expect(wornKey(run())).toBe(`${BARE}:classic`)
  })

  /* The most important check. Every path here is safe even with no art on disk. An outfit whose
   * `drawn` flag is false can never be worn, so `walkFrame` never points at a folder that isn't
   * there. */
  it('never points at an outfit nobody has drawn, even if it is worn in the save', () => {
    /* Every outfit has art right now, so the test switches one off to check the rule. */
    vi.spyOn(WEAR[0], 'drawn', 'get').mockReturnValue(false)
    for (const w of WEAR) {
      if (w.drawn) continue
      const s = run({ thorWear: w.id, graduated: true, islands: { robotics: 'completed' } })
      expect(canWear(s, w.id), `${w.id} is not drawn and must not be wearable`).toBe(false)
      expect(walkFrame(s, 'south', 0)).toBe('/art/characters/thor/walk/south/0.png')
      expect(poseFrame(s, 'lie')).toBe('/art/characters/thor/pose/lie.png')
    }
  })

  /* The other half: an outfit marked drawn must really have its files on disk. Otherwise the game
   * asks for a png that 404s and draws nothing. */
  it('has every frame on disk for every outfit marked drawn', () => {
    for (const w of WEAR) {
      if (!w.drawn) continue
      for (const d of DIRS8) {
        for (let i = 0; i < 6; i++) {
          const f = here(`public/art/characters/thor/wear/${w.id}/walk/${d}/${i}.png`)
          expect(fs.existsSync(f), `${w.id} says it is drawn but ${f} is missing`).toBe(true)
        }
      }
      /* Poses are checked separately. An outfit without pose art sits down as the plain panther
       * instead of asking for a png that doesn't exist. */
      if (!w.posed) continue
      for (const pose of ['sit', 'lie']) {
        const f = here(`public/art/characters/thor/wear/${w.id}/pose/${pose}.png`)
        expect(fs.existsSync(f), `${w.id} says it is posed but ${f} is missing`).toBe(true)
      }
    }
  })

  it('routes to the outfit once it is earned and drawn', () => {
    const w = WEAR[0]
    /* The flag is the only thing that picks between the plain path and the outfit folder, so
     * turning it on here is the same as adding the art. */
    vi.spyOn(w, 'drawn', 'get').mockReturnValue(true)
    const s = run({ thorWear: w.id, completions: [
      { programme: 'football', year: 1, grade: 3, rank: 'football', at: 1 },
      { programme: 'football', year: 2, grade: 3, rank: 'football', at: 2 },
    ] })
    expect(canWear(s, w.id)).toBe(true)
    expect(walkFrame(s, 'east', 3)).toBe(`/art/characters/thor/wear/${w.id}/walk/east/3.png`)
    /* The pose only uses the outfit if it has sitting art. */
    expect(poseFrame(s, 'sit')).toBe(w.posed
      ? `/art/characters/thor/wear/${w.id}/pose/sit.png`
      : '/art/characters/thor/pose/sit.png')
    expect(wornKey(s)).toBe(`${w.id}:classic`)
  })

  it('will not wear something this run has not earned', () => {
    const cap = wearById('cap')!
    expect(cap.has(run()), 'a run that has not graduated has not earned it').toBe(false)
    expect(canWear(run({ thorWear: 'cap' }), 'cap')).toBe(false)
    expect(walkFrame(run({ thorWear: 'cap' }), 'north', 2)).toBe('/art/characters/thor/walk/north/2.png')
  })

  /* The scene compares this key to decide whether to reload forty-eight textures, so changing the
   * coat and changing the outfit must give different keys. */
  it('changes its key for a coat and for an outfit, separately', () => {
    expect(wornKey(run({ thorLook: 'ember' }))).toBe(`${BARE}:ember`)
    expect(wornKey(run({ thorLook: 'ember' }))).not.toBe(wornKey(run({ thorLook: 'gold' })))
  })

  it('gives every outfit a name and a way to earn it', () => {
    for (const w of WEAR) {
      expect(w.name.length, w.id).toBeGreaterThan(2)
      expect(w.earn.length, w.id).toBeGreaterThan(4)
      expect(w.id).not.toBe(BARE)
    }
    expect(new Set(WEAR.map((w) => w.id)).size).toBe(WEAR.length)
  })
})
