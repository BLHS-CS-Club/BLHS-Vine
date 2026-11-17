/* Tests that the stylesheets and the renderer read one shared reduced motion value. */
import { describe, it, expect, beforeEach } from 'vitest'
import { motionAmp, motionMs, onReducedMotion, prefersReducedMotion, setReducedMotion } from './motion'

beforeEach(() => { setReducedMotion(false) })

describe('the setting is a value and an attribute at the same time', () => {
  it('writes what it reads, so CSS and the renderer cannot drift', () => {
    setReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(document.documentElement.dataset.rm).toBe('1')

    setReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(document.documentElement.dataset.rm).toBe('')
  })

  it('tells a renderer that is mid-animation, so a swing can shorten rather than finish', () => {
    const seen: boolean[] = []
    const off = onReducedMotion((on) => seen.push(on))
    setReducedMotion(true)
    setReducedMotion(false)
    off()
    setReducedMotion(true)
    expect(seen).toEqual([true, false])
  })
})

describe('what reduced means to something that draws', () => {
  it('shortens a camera travel instead of cutting it, which is what §11.3 asks for', () => {
    expect(motionMs(900)).toBe(900)
    setReducedMotion(true)
    expect(motionMs(900)).toBe(120)
    // A move that was already short stays short instead of getting longer.
    expect(motionMs(60)).toBe(60)
    // It's never 0, because a move that takes no time is a jump cut.
    expect(motionMs(900)).toBeGreaterThan(0)
  })

  it('stops a decorative swing outright', () => {
    expect(motionAmp(8)).toBe(8)
    setReducedMotion(true)
    expect(motionAmp(8)).toBe(0)
  })
})
