/* The small cards that pop up to say something happened, like saved, right or wrong. They're drawn
 * into a fixed layer inside the body. */
import { announce } from './a11y'
import { faceStyle } from './kitFaceStyle'
import { play, playUi } from '../audio'

const LAYER_ID = 'kit-feedback'

export type FeedbackKind = 'saved' | 'right' | 'wrong' | 'awarded' | 'note'

/* The sound each kind of card plays. */
const SOUND: Record<FeedbackKind, string> = {
  saved: 'mark',
  right: 'chime',
  wrong: 'page',
  awarded: 'chime',
  note: 'click',
}

/* How long each kind stays on screen, in milliseconds. Wrong stays longest on purpose, because it
 * has the most to read and people read it slowest. */
const HOLD: Record<FeedbackKind, number> = {
  saved: 1500,
  right: 1400,
  wrong: 2600,
  awarded: 2400,
  note: 1900,
}

/* The drawn icon each kind shows, as [sheet, face]. Every one of these exists on the live kit. */
const MARK: Record<FeedbackKind, [string, string] | null> = {
  saved: ['stamp', 'approved'],
  right: ['icon_set', 'tick'],
  wrong: ['pointer', 'hand'],
  awarded: ['stamp', 'awarded'],
  note: null,
}

function layer(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById(LAYER_ID)
  if (el) return el
  el = document.createElement('div')
  el.id = LAYER_ID
  el.className = 'kit-fb-layer'
  /* No `aria-live` here. Everything is read aloud through the kit's one live region in `a11y.ts`,
   * and a second live region would make a screen reader say the same thing twice. */
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  return el
}

/** The drawn icon as an inline style string, or an empty string if there's no drawing for it. */
function markStyle(kind: FeedbackKind): string {
  const m = MARK[kind]
  if (!m) return ''
  const s = faceStyle(m[0], m[1])
  if (!s) return ''
  return [
    `background-image:${s.backgroundImage}`,
    `background-repeat:${s.backgroundRepeat}`,
    `background-size:${s.backgroundSize}`,
    `background-position:${s.backgroundPosition}`,
  ].join(';')
}

/* Only one card shows at a time, and a new one replaces the old one. Stacked cards would turn into
 * a notification tray, and the game doesn't allow floating trays. */
let showing: { el: HTMLElement; timer: number } | null = null

export function feedback(kind: FeedbackKind, message: string, detail?: string): void {
  const host = layer()
  if (!host) return
  if (showing) { window.clearTimeout(showing.timer); showing.el.remove(); showing = null }

  const card = document.createElement('div')
  card.className = `kit-fb kit-fb-${kind}`

  const mark = markStyle(kind)
  if (mark) {
    const m = document.createElement('span')
    m.className = 'kit-fb-mark'
    m.setAttribute('style', mark)
    card.appendChild(m)
  }

  const words = document.createElement('div')
  words.className = 'kit-fb-words'
  const head = document.createElement('div')
  head.className = 'kit-fb-head'
  head.textContent = message
  words.appendChild(head)
  if (detail) {
    const sub = document.createElement('div')
    sub.className = 'kit-fb-detail'
    sub.textContent = detail
    words.appendChild(sub)
  }
  card.appendChild(words)
  host.appendChild(card)

  /* Read it aloud too. A screen reader can't see the card, and hearing that something saved matters
   * most to someone who can't see it. */
  announce(detail ? `${message}. ${detail}` : message)
  /* Only the reward sound plays on the main channel. The other four kinds go through the UI
   * channel. */
  if (kind === 'awarded') play(SOUND[kind], 0.5)
  else playUi(SOUND[kind], kind === 'wrong' ? 0.4 : undefined)

  const hold = HOLD[kind]
  const timer = window.setTimeout(() => {
    card.classList.add('kit-fb-going')
    window.setTimeout(() => { card.remove(); if (showing?.el === card) showing = null }, 240)
  }, hold)
  showing = { el: card, timer }
}

/* ---- the four words the rest of the game says --------------------------- */

/** The run kept something, like a plan, a name or a choice. It shows the stamp icon. */
export const saved = (what = 'Saved'): void => feedback('saved', what)

/** A correct answer. It's short, because there's nothing to fix. */
export const right = (what = 'Right', detail?: string): void => feedback('right', what, detail)

/**
 * A wrong answer, with no buzzer. The message says what to do next, never what was wrong with the
 * person who answered.
 */
export const wrong = (what = 'Not quite', detail?: string): void => feedback('wrong', what, detail)

/**
 * Something earned, like a cord, a badge, a sticker or a fact. Gold is only for honors, so this is
 * the only kind that uses it.
 */
export const awarded = (what: string, detail?: string): void => feedback('awarded', what, detail)

/** Anything else worth a line that isn't judging an answer. */
export const note = (what: string, detail?: string): void => feedback('note', what, detail)

/** Used by tests, and by a scene that shuts down while a card is still showing. */
export function clearFeedback(): void {
  if (showing) { window.clearTimeout(showing.timer); showing.el.remove(); showing = null }
  document.getElementById(LAYER_ID)?.remove()
}
