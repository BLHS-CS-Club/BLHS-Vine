/* Tests for the bus between an island and the screens it asks for. Every case checks that the
 * promise settles. The station that called the handler holds the controls the whole time, so a
 * promise that never settles leaves the player stuck with no way out but a reload. */
import { describe, expect, it } from 'vitest'
import { onBeatRequest, requestBeat } from './ui-bus'

describe('asking for a beat', () => {
  it('refuses when nothing is mounted to play it', async () => {
    await expect(requestBeat('core:y1')).rejects.toThrow(/no HUD mounted/)
  })

  it('comes back with the grade the listener reports', async () => {
    const off = onBeatRequest((r) => r.done(3.5))
    await expect(requestBeat('core:y1')).resolves.toBe(3.5)
    off()
  })

  it('comes back null for a screen the student closed without finishing', async () => {
    const off = onBeatRequest((r) => r.done(null))
    await expect(requestBeat('core:y1')).resolves.toBeNull()
    off()
  })

  /* Building a beat from what an island declared can throw. `dispatchEvent` hides an error from a
   * listener, and `preventDefault` has already told `requestBeat` someone has it, so without a
   * catch the island would wait forever. */
  it('turns a listener that throws into a refusal rather than a silence', async () => {
    const off = onBeatRequest(() => { throw new Error('that item has no options') })
    await expect(requestBeat('atc:the_program')).rejects.toThrow(/that item has no options/)
    off()
  })

  it('and a throw that is not an Error still answers', async () => {
    /* A member's own code can reach this through the worker. It might throw something that isn't an
     * Error, and the island still needs an answer. */
    const off = onBeatRequest(() => { throw 'just a string' })
    await expect(requestBeat('atc:the_program')).rejects.toThrow(/just a string/)
    off()
  })

  it('a listener that answers AND then throws keeps the answer it gave', async () => {
    /* The first answer wins. That stops a late error from turning a finished beat into a refusal,
     * which the island would report as a failure. */
    const off = onBeatRequest((r) => { r.done(4); throw new Error('too late') })
    await expect(requestBeat('core:y1')).resolves.toBe(4)
    off()
  })
})
