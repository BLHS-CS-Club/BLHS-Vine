/* Tests for the dialogue box. They also check the game has only one dialogue box, so islands can't
 * end up drawing two. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import fs from 'node:fs'
import path from 'node:path'
import { DialogueBox, ADVANCE_DEAD_MS } from './DialogueBox'
import { setKit, type KitPiece } from '../ui/kit'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (props: Parameters<typeof DialogueBox>[0]) => {
  act(() => { root.render(createElement(DialogueBox, props)) })
}

const line = (over: Partial<Parameters<typeof DialogueBox>[0]['line']> = {}) => ({
  text: 'The circle is drawn.', shown: 20, done: true, ...over,
})

/* The portrait frame the way the platform actually sends it, so a test can load a real kit instead
 * of guessing at one. */
const FRAME: KitPiece = {
  name: 'portrait_frame', type: 'portrait_frame', w: 200, h: 185,
  slice: { top: 34, right: 38, bottom: 37, left: 29 },
  fill: true, scale: 1, repeat: { x: 'round', y: 'round' },
  src: '/api/v1/ui/portrait_frame/image', sha: 'pf',
  css: '.kit-surface-portrait_frame { border-image: var(--kit-art-portrait_frame) 34 38 37 29 fill / 1 / 0 round; }',
}

describe('what the box draws', () => {
  it('shows only the characters the caller has revealed', () => {
    render({ line: line({ shown: 4, done: false }) })
    expect(host.querySelector('.cs-dialogue-text')?.textContent).toContain('The ')
    expect(host.querySelector('.cs-dialogue-text')?.textContent).not.toContain('circle')
    // There should be a blinking caret while the line is still typing.
    expect(host.querySelector('.dlg-caret')).toBeTruthy()
  })

  it('drops the caret and offers the hint once the line is done', () => {
    render({ line: line() })
    expect(host.querySelector('.dlg-caret')).toBeNull()
    expect(host.querySelector('.cs-continue-hint')).toBeTruthy()
  })

  it('draws the name plaque and the emote beside it', () => {
    render({ line: line({ who: 'counselor', emote: '?' }) })
    expect(host.querySelector('.cs-nameplaque')?.textContent).toContain('counselor')
    expect(host.querySelector('.cs-emote')?.textContent).toContain('?')
  })

  /* The portrait is drawn inside the kit's own frame piece. */
  it('DRAWS THE PORTRAIT, in the drawn frame the kit publishes for it', () => {
    /* The drawn frame is only used when the platform actually sent that piece. */
    setKit([FRAME])
    render({ line: line({ portrait: 'pinzon' }) })
    const img = host.querySelector('.dlg-portrait img.kit-portrait-pic') as HTMLImageElement | null
    expect(img).toBeTruthy()
    expect(img!.getAttribute('src')).toBe('/art/portraits/pinzon.png')
    expect(host.querySelector('.dlg-portrait .kit-surface-portrait_frame')).toBeTruthy()
    expect(host.querySelector('.cs-dialogue')?.className).toContain('has-portrait')
    setKit([])
  })

  /* When there's no drawn background art, the class name says so, so fallback styles can take over. */
  it('says so in its class when the platform published no frame, so a fallback can dress it', () => {
    setKit([])
    render({ line: line({ portrait: 'pinzon' }) })
    const frame = host.querySelector('.dlg-portrait .kit-portrait')
    expect(frame).toBeTruthy()
    expect(frame!.className).toContain('kit-bare')
    expect(frame!.className).not.toContain('kit-surface-')
    /* The portrait picture still shows. Only the frame art is missing. */
    expect(host.querySelector('.dlg-portrait img.kit-portrait-pic')).toBeTruthy()
  })

  it('leaves no portrait frame at all when the line has none', () => {
    render({ line: line() })
    expect(host.querySelector('.dlg-portrait')).toBeNull()
    expect(host.querySelector('.cs-dialogue')?.className).not.toContain('has-portrait')
  })

  /* The box puts its state on the element, so both the stylesheet and a screenshot tool can read
   * it. */
  it('says which of its four states it is in, on the element', () => {
    render({ line: line({ shown: 4, done: false }) })
    expect(host.querySelector('.cs-dialogue')?.getAttribute('data-state')).toBe('typing')
    render({ line: line() })
    expect(host.querySelector('.cs-dialogue')?.getAttribute('data-state')).toBe('complete')
    render({ line: line(), options: ['a', 'b'] })
    expect(host.querySelector('.cs-dialogue')?.getAttribute('data-state')).toBe('asking')
  })

  /* The box and its choices sit in one column, so the choice planks can't land on top of the box. */
  it('holds the box and its choices in one bottom-anchored stack', () => {
    render({ line: line(), options: ['a', 'b'] })
    const stack = host.querySelector('.dlg-stack')
    expect(stack).toBeTruthy()
    expect(stack!.querySelector('.dlg-choices')).toBeTruthy()
    expect(stack!.querySelector('.dlg-box')).toBeTruthy()
    // The choices come first in the column, so they show above the box.
    expect([...stack!.children].map((c) => c.className.split(' ')[0]))
      .toEqual(['dlg-choices', 'cs-dialogue'])
  })

  /* The hint names both ways to move on. It's one sentence kept here instead of a string each
   * caller passes, so no caller can add a font symbol to the end of it. */
  it('names the pointer path and the key path in the same sentence', () => {
    render({ line: line() })
    const hint = host.querySelector('.cs-continue-hint')?.textContent ?? ''
    expect(hint.toLowerCase()).toContain('click')
    expect(hint.toLowerCase()).toContain('space')
  })

  it('carries the skin as one string a stylesheet can key off', () => {
    render({ line: line(), skin: 'paper' })
    expect(host.querySelector('.cs-dialogue')?.getAttribute('data-skin')).toBe('paper')
  })
})

describe('a pointer path for every key path, and the reverse', () => {
  it('advances on a click and on space, and the box is focusable', () => {
    const onAdvance = vi.fn()
    // The ignore-presses window is measured with performance.now, so the test moves that clock.
    let clock = 1000
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      render({ line: line(), onAdvance })
      const box = host.querySelector('.cs-dialogue') as HTMLElement

      // Presses are ignored for the first quarter second, so mashing space can't skip a line nobody
      // has read.
      box.click()
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) })
      expect(onAdvance).not.toHaveBeenCalled()

      clock += ADVANCE_DEAD_MS + 1
      box.click()
      expect(onAdvance).toHaveBeenCalledTimes(1)
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) })
      expect(onAdvance).toHaveBeenCalledTimes(2)
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })
      expect(onAdvance).toHaveBeenCalledTimes(3)

      expect(box.tabIndex).toBe(0)
    } finally { now.mockRestore() }
  })

  it('offers every choice as a real button AND as a number key', () => {
    const onPick = vi.fn()
    render({ line: line(), options: ['Show me the board', 'Not now'], onPick })
    const buttons = [...host.querySelectorAll('button.dlg-choice')] as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    // The key number is printed on the button, so a keyboard player can see it instead of guessing.
    expect(buttons[0].textContent).toContain('1')
    expect(buttons[1].textContent).toContain('2')

    act(() => { buttons[1].click() })
    expect(onPick).toHaveBeenCalledWith(1)

    /* Only one answer per question. Another press after a pick is ignored. */
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })) })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.dlg-choice-chosen')?.textContent).toContain('Not now')
    expect(host.querySelector('.cs-dialogue')?.getAttribute('data-state')).toBe('answered')

    const second = vi.fn()
    render({ line: line({ text: 'And after that?' }), options: ['Aye', 'Later'], onPick: second })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' })) })
    expect(second).toHaveBeenCalledWith(0)
  })

  it('never advances while it is asking, so a click cannot skip a question', () => {
    const onAdvance = vi.fn()
    render({ line: line(), options: ['a', 'b'], onAdvance })
    ;(host.querySelector('.cs-dialogue') as HTMLElement).click()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })
    expect(onAdvance).not.toHaveBeenCalled()
  })

  it('holds the choices back until the question has finished typing', () => {
    render({ line: line({ shown: 3, done: false }), options: ['a', 'b'] })
    expect(host.querySelectorAll('button.dlg-choice')).toHaveLength(0)
  })

  it('does not bind keys when its host already does', () => {
    const onAdvance = vi.fn()
    render({ line: line(), onAdvance, bindKeys: false })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) })
    expect(onAdvance).not.toHaveBeenCalled()
  })
})

describe('there is exactly one of it', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')

  it('is what both the world box and the cutscene overlay render', () => {
    for (const p of ['src/game/hud/Dialogue.tsx', 'src/game/cutscene/CutsceneOverlay.tsx']) {
      const src = read(p)
      expect(src, p).toContain('DialogueBox')
      /* Neither file may draw its own box. These class names belong to DialogueBox, and finding
       * them anywhere else means a second box is being built. */
      expect(src, p).not.toContain('cs-nameplaque')
      expect(src, p).not.toContain('cs-dialogue-text')
    }
  })
})
