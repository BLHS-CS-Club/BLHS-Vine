// Checks that the help card shows what it should: four controls, the three corner buttons and a way
// out.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import fs from 'node:fs'
import path from 'node:path'
import { HelpCard, HelpButton } from './Help'
import { onUiRequest } from '../ui-bus'

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
  document.documentElement.removeAttribute('data-skin')
})

const openCard = () => act(() => root.render(createElement(HelpCard, { onClose: () => {} })))

describe('what the help card says', () => {
  it('carries the sentence the brief asks for, word for word', () => {
    openCard()
    /* It has to be this exact line, with no rewording. It's the answer for a player who doesn't
     * know what to do. */
    expect(host.textContent).toContain('The line above your head is your task.')
  })

  it('teaches all four keys, and each one has a picture beside it', () => {
    openCard()
    const rows = [...host.querySelectorAll('.hp-key')]
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      /* Every row needs a picture and a sentence. A row without its picture makes the student read,
       * and this card should work at a glance. */
      expect(r.querySelector('.hp-mark'), r.textContent ?? '').toBeTruthy()
      expect(r.querySelector('.hp-says')?.textContent?.trim().length).toBeGreaterThan(0)
    }
    const said = host.textContent ?? ''
    for (const key of ['Arrow keys', 'E opens', 'click', 'Esc closes']) {
      expect(said, key).toContain(key)
    }
  })

  it('names the three things in the corner, whether or not the run has granted them', () => {
    openCard()
    const corner = host.querySelector('.hp-corner')?.textContent ?? ''
    /* Use Map, Guide and My Year. The words Chart, Handbook and Year sheet mean nothing to a
     * freshman looking for the button that shows where they can go. */
    for (const name of ['Map', 'Guide', 'My Year']) expect(corner).toContain(name)
  })

  it('spells no key with a system character, on any row', () => {
    openCard()
    // Every mark on the card is drawn art, never an emoji or a font character.
    const GLYPHS = /[←-⇿■-◿⬀-⯿\u{1F300}-\u{1FAFF}️]/u
    expect(host.textContent ?? '').not.toMatch(GLYPHS)
  })

  it('is a dialog a keyboard can leave', () => {
    openCard()
    const card = host.querySelector('.hp-card')
    expect(card?.getAttribute('role')).toBe('dialog')
    expect(card?.getAttribute('aria-modal')).toBe('true')
    /* There has to be a real button to leave, not only the Escape key. A student using a trackpad
     * may not know about Escape. */
    expect(host.querySelector('.hp-door')).toBeTruthy()
  })

  // The card has the same buttons as the pause sheet, so Escape isn't the only way out.
  it('carries every door the pause sheet has, so Escape is not the only way out', () => {
    // The panel buttons only show when something is listening, so subscribing here stands in for a
    // mounted Hud.
    const off = onUiRequest(() => {})
    try {
      openCard()
      const said = [...host.querySelectorAll('.hp-door')].map((b) => b.textContent ?? '')
      for (const word of ['Back', 'My Year', 'Guide', 'Settings']) {
        expect(said.some((t) => t.includes(word)), word).toBe(true)
      }
      /* "Save and leave" needs a navigator, and a bare render doesn't have one. Outside a
       * SceneManager there's no title screen to go back to. In the real app it's always there. */
      expect(said.length).toBeGreaterThanOrEqual(4)
    } finally { off() }
  })

  it('offers only the doors that can actually open, with no Hud mounted', () => {
    /* The other side of the rule. On the title screen and during the intro there's no Hud, so those
     * buttons can't open anything. */
    openCard()
    const said = [...host.querySelectorAll('.hp-door')].map((b) => b.textContent ?? '')
    expect(said.some((t) => t.includes('Back'))).toBe(true)
    for (const word of ['My Year', 'Guide', 'Settings']) {
      expect(said.some((t) => t.includes(word)), word).toBe(false)
    }
  })
})

describe('the button in the corner', () => {
  it('is there with nothing granted, which is the whole reason it exists', () => {
    // The help button is the one HUD control that shows before the run has unlocked anything.
    localStorage.removeItem('blhs_save_v2')
    act(() => root.render(createElement(HelpButton)))
    const btn = host.querySelector('.hp-btn')
    expect(btn).toBeTruthy()
    expect(btn?.getAttribute('aria-label')).toBe('How to play')
  })

  it('is anchored to a corner rather than to the stack it used to sit under', () => {
    // It sits in a fixed corner, so nothing works out its position from what else is on screen.
    act(() => root.render(createElement(HelpButton)))
    const btn = host.querySelector('.hp-btn') as HTMLElement
    expect(btn.style.getPropertyValue('--hp-above')).toBe('')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/game/hud/help.css'), 'utf8')
    const rule = css.slice(css.indexOf('.hp-btn {'), css.indexOf('}', css.indexOf('.hp-btn {')))
    expect(rule).toContain('bottom:')
    expect(rule).toContain('right:')
    expect(rule).not.toContain('--hp-slot')
  })
})
