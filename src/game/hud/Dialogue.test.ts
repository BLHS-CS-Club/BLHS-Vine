/* Tests that the dialogue box stays steady: the same element across lines, and no typing glitches. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Dialogue } from './Dialogue'
import { say, choose, clearDialogue } from '../dialogue'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

/* happy-dom has no animation-frame clock that moves on its own. So this file controls
 * `performance.now` and runs each frame by hand, which is the only way to check how many characters
 * have typed. */
let now = 0
let frames: FrameRequestCallback[] = []

beforeEach(() => {
  now = 1000
  frames = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Dialogue)) })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  clearDialogue()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Move the clock forward by `ms`, then run the waiting animation frames. */
const tick = (ms: number) => {
  now += ms
  act(() => {
    const due = frames
    frames = []
    for (const fn of due) fn(now)
  })
}

const box = () => host.querySelector('.dlg-box')
/* Type the whole line out before pressing. `advance` only moves on from a finished line, and the
 * box ignores presses in its first quarter second, so a test that only clicks would check neither. */
const readAndPress = () => { tick(2000); act(() => { (box() as HTMLElement).click() }) }
const words = () => host.querySelector('.cs-dialogue-text')?.textContent ?? ''
const plate = () => host.querySelector('.cs-nameplaque')?.textContent?.trim() ?? null
const face = () => host.querySelector('.dlg-portrait img')?.getAttribute('src') ?? null

describe('the box does not blink between lines', () => {
  it('KEEPS THE SAME ELEMENT across two consecutive lines from one speaker', async () => {
    /* The box should stay put between two lines instead of disappearing and playing its entrance
     * again. */
    const first = say({ who: 'Principal Panther', text: 'One.', portrait: 'principal' })
    await act(async () => {})
    const before = box()
    expect(before).toBeTruthy()

    // The student reads it and clicks through, then the island says the next line.
    readAndPress()
    await act(async () => { await first })
    const second = say({ who: 'Principal Panther', text: 'Two.', portrait: 'principal' })
    await act(async () => {})

    expect(box()).toBe(before)          // same DOM node, never removed
    tick(1000)
    expect(words()).toContain('Two.')
    act(() => { (box() as HTMLElement).click() })
    await act(async () => { await second })
  })

  it('lets the box go when nothing follows', async () => {
    const only = say({ who: 'Principal Panther', text: 'One.' })
    await act(async () => {})
    expect(box()).toBeTruthy()
    readAndPress()
    await act(async () => { await only })
    // Still up during the short handover pause, gone after it.
    expect(box()).toBeTruthy()
    await act(async () => { await new Promise((r) => setTimeout(r, 320)) })
    expect(box()).toBeNull()
  })
})

describe('one speaker, one box', () => {
  it('a QUESTION keeps the name plate and the face of whoever was speaking', async () => {
    /* A question has no speaker of its own, so it keeps the last speaker's name plate and face. */
    const said = say({ who: 'Principal Panther', text: 'Ready?', portrait: 'principal' })
    await act(async () => {})
    expect(plate()).toBe('Principal Panther')
    expect(face()).toBe('/art/portraits/principal.png')

    readAndPress()
    await act(async () => { await said })
    const asked = choose({ prompt: 'Which one?', options: ['A', 'B'] })
    await act(async () => {})
    tick(1000)

    expect(host.querySelector('.dlg-choice')).toBeTruthy()
    expect(plate()).toBe('Principal Panther')
    expect(face()).toBe('/art/portraits/principal.png')

    act(() => { (host.querySelector('.dlg-choice') as HTMLElement).click() })
    expect(await asked).toBe(0)
  })

  it('a NEW speaker does not inherit the last one’s face', async () => {
    const first = say({ who: 'Principal Panther', text: 'Hello.', portrait: 'principal' })
    await act(async () => {})
    readAndPress()
    await act(async () => { await first })
    const second = say({ who: 'Counselor Wren', text: 'Over here.' })
    await act(async () => {})
    expect(plate()).toBe('Counselor Wren')
    expect(face()).toBeNull()
    readAndPress()
    await act(async () => { await second })
  })
})

describe('the typewriter', () => {
  it('STARTS OVER when the same sentence is said twice in a row', async () => {
    /* A repeated line has to type out again instead of appearing all at once. "Try again." after a
     * wrong answer is the most common repeat in the game. */
    const first = say({ text: 'Try again.' })
    await act(async () => {})
    tick(1000)
    expect(words()).toBe('Try again.')
    act(() => { (box() as HTMLElement).click() })
    await act(async () => { await first })
    const second = say({ text: 'Try again.' })
    await act(async () => {})
    tick(40)
    expect(words().length).toBeLessThan('Try again.'.length)
    tick(1000)
    expect(words()).toBe('Try again.')
    act(() => { (box() as HTMLElement).click() })
    await act(async () => { await second })
  })

  it('NEVER RUNS BACKWARDS when a student clicks a half-typed line', async () => {
    /* Filling in a line stops the typing loop, so the sentence doesn't shrink back. */
    const said = say({ text: 'A reasonably long sentence to type out.' })
    await act(async () => {})
    /* This is past the box's quarter-second window where presses are ignored, and well before the
     * end of a 38 character line typing at 45 a second. */
    tick(300)
    const part = words().length
    expect(part).toBeGreaterThan(0)
    expect(part).toBeLessThan('A reasonably long sentence to type out.'.length)

    act(() => { (box() as HTMLElement).click() })   // fills in the rest of the line
    expect(words()).toBe('A reasonably long sentence to type out.')
    tick(16)                                        // the next frame must not undo it
    expect(words()).toBe('A reasonably long sentence to type out.')
    tick(16)
    expect(words()).toBe('A reasonably long sentence to type out.')

    act(() => { (box() as HTMLElement).click() })
    await act(async () => { await said })
  })
})
