import { describe, expect, it } from 'vitest'
import { performIntent } from '../../vine/intents'
import { UI_PANELS } from '../ui-bus'

/* A typo in open has to give a clear sentence, never a frozen game. Without the name check, an
 * unknown panel name opens nothing, and wait=True then holds the world until the UI bus gives up
 * after ten minutes. */
/* The smallest host that open can be called through. It only needs an engine. */
const host = (openUi: (ui: string, wait: boolean) => void) => ({
  /* The world field on a host is the world itself, not a getter. performIntent wraps it in its own
   * w(), which throws NoWorld when it's missing. */
  world: {} as never,
  engine: { openUi } as never,
}) as never

describe('open, with a name nobody has', () => {
  it('refuses by name and lists the panels that exist', async () => {
    const r = await performIntent({ kind: 'open', ui: 'guide' } as never,
      host(() => { throw new Error('the engine must never be reached with a bad name') }))
    expect(r.ok).toBe(false)
    const why = r.ok ? '' : r.why
    expect(why).toMatch(/"guide" is not a panel/)
    /* The list of panels goes in the refusal, so a member reading it can fix their own line without
     * reading the engine. */
    for (const p of UI_PANELS) expect(why).toContain(p)
  })

  it('and every real panel is still let through', async () => {
    for (const p of UI_PANELS) {
      let reached = ''
      const r = await performIntent({ kind: 'open', ui: p } as never,
        host((ui) => { reached = ui }))
      expect(r.ok, p).toBe(true)
      expect(reached).toBe(p)
    }
  })
})

/* Three more mistakes beginners make. Without a refusal, each one fails silently: a blank game, a
 * wrong grade on a transcript, or a twelve second loading screen that leads nowhere. So every
 * refusal names the member's own line. */
describe('the words a hand types wrong', () => {
  it('takes the arguments to choose the wrong way round and says so', async () => {
    const r = await performIntent(
      { kind: 'choose', prompt: undefined, options: 'Want a go?' } as never,
      host(() => {}))
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.why).toMatch(/LIST of options first/)
  })

  it('marks out of a hundred and is told the scale', async () => {
    const r = await performIntent({ kind: 'award', grade: 87 } as never, host(() => {}))
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.why).toMatch(/out of FOUR/)
  })

  it('still takes a grade of none, which means finished and not graded', async () => {
    let given: unknown = 'nothing'
    const h = { world: {} as never, engine: { award: (a: unknown) => { given = a } } } as never
    const r = await performIntent({ kind: 'award', grade: null } as never, h)
    expect(r.ok).toBe(true)
    expect(given).toBeTruthy()
  })

  it('mistypes a map name and is given the list of maps that exist', async () => {
    const scene = { knownMaps: () => ['hub', 'panther-maw', 'atc-1'] }
    const r = await performIntent({ kind: 'enter', map: 'hbu' } as never,
      { world: scene, engine: {} } as never)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.why).toMatch(/no map called "hbu"/)
    expect(r.ok ? '' : r.why).toContain('panther-maw')
  })
})
