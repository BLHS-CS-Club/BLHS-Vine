/* Keyboard and screen reader rules that every panel in the kit follows. Tab stays inside the panel,
 * Escape closes it, the background can't be touched, and focus goes back where it came from when it
 * closes. */
import { useCallback, useEffect, useId, useRef } from 'react'
import { playUi } from '../audio'

/* ---- the stack --------------------------------------------------------- */

const stack: string[] = []

/* Writes how many panels are open onto the page root, so the corner plaques can hide themselves. */
const syncPanels = () => {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.panels = String(stack.length)
}

/**
 * How many panels are open. Code outside a panel uses this to leave the Escape key alone while one
 * is open.
 */
export const panelDepth = (): number => stack.length

/** True if this panel is the top one, which is the one a key press belongs to. */
export const isInnermostPanel = (token: string): boolean => stack[stack.length - 1] === token

/* ---- hiding the background -------------------------------------------- */

const LIVE_ID = 'kit-live-region'

/* Remembers what each element looked like before it was hidden, and how many panels are hiding it.
 * Two panels can hide the same background. */
type Held = { count: number; hadHidden: string | null; hadInert: boolean }
const held = new Map<Element, Held>()

const hide = (el: Element) => {
  const h = held.get(el)
  if (h) { h.count++; return }
  held.set(el, {
    count: 1,
    hadHidden: el.getAttribute('aria-hidden'),
    hadInert: el.hasAttribute('inert'),
  })
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('inert', '')
}

const unhide = (el: Element) => {
  const h = held.get(el)
  if (!h) return
  if (--h.count > 0) return
  held.delete(el)
  if (h.hadHidden === null) el.removeAttribute('aria-hidden')
  else el.setAttribute('aria-hidden', h.hadHidden)
  if (!h.hadInert) el.removeAttribute('inert')
}

/** Everything on screen that isn't this panel or one of its parents. */
function backgroundOf(panel: Element): Element[] {
  const out: Element[] = []
  let node: Element | null = panel
  while (node && node.parentElement) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib === node) continue
      /* Skip the live region. A hidden one doesn't get read out. */
      if (sib.id === LIVE_ID) continue
      if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') continue
      out.push(sib)
    }
    node = node.parentElement
  }
  return out
}

/**
 * Exported for the test, and for anything that needs to freeze the world without being a React
 * panel.
 */
export function makeBackgroundInert(panel: Element): () => void {
  const marked = backgroundOf(panel)
  for (const el of marked) hide(el)
  let released = false
  return () => {
    if (released) return
    released = true
    for (const el of marked) unhide(el)
  }
}

/* ---- who can be focused ------------------------------------------------ */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusablesIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    /* Also skip anything under an inert or hidden parent, because the browser won't focus those. */
    .filter((el) => !el.closest('[inert], [aria-hidden="true"]'))
}

/* ---- announcements ----------------------------------------------------- */

function liveRegion(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById(LIVE_ID)
  if (el) return el
  el = document.createElement('div')
  el.id = LIVE_ID
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  /* Moved off screen instead of display:none, because a hidden node isn't read aloud. The style is
   * inline so the announcements still work if the app forgets to import a stylesheet. */
  el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0'
  document.body.appendChild(el)
  return el
}

/* Reads a change out loud for screen reader users. A trailing space is added every other time so
 * the same message twice still gets read. */
let flip = false
export function announce(message: string): void {
  const el = liveRegion()
  if (!el) return
  flip = !flip
  el.textContent = flip ? message : `${message} `
}

/** Lets the test check what was last said, and lets the app clean up. */
export const lastAnnouncement = (): string =>
  (typeof document === 'undefined' ? '' : document.getElementById(LIVE_ID)?.textContent ?? '').trim()

/* ---- the hook every panel in the kit uses ------------------------------ */

export type PanelOptions = {
  /** The name a screen reader says for this panel. */
  label: string
  /** Called by Escape, by clicking the dark backdrop, and by the close button. */
  onClose?: () => void
  /** Pass false for a panel the player can't dismiss, like a graded frame in the middle of a run. */
  closeOnEscape?: boolean
}

export type PanelBinding = {
  ref: (el: HTMLDivElement | null) => void
  role: 'dialog'
  'aria-modal': true
  'aria-label': string
  tabIndex: -1
  onKeyDown: (e: React.KeyboardEvent) => void
}

export function usePanel({ label, onClose, closeOnEscape = true }: PanelOptions): PanelBinding {
  const token = useId()
  const node = useRef<HTMLDivElement | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  const ref = useCallback((el: HTMLDivElement | null) => { node.current = el }, [])

  useEffect(() => {
    const el = node.current
    if (!el) return
    stack.push(token)
    syncPanels()
    /* Remember what had focus, so it can go back to the control that opened this panel. */
    const cameFrom = document.activeElement as HTMLElement | null
    const release = makeBackgroundInert(el)

    /* Focus the panel itself instead of its first button, so no focus ring shows yet. */
    el.focus?.()

    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return
      if (!isInnermostPanel(token)) return
      if (!closeOnEscape) return
      e.stopPropagation()
      e.preventDefault()
      close.current?.()
    }
    /* Listen in the capture phase, so the top panel gets Escape before any older window listener
     * closes the wrong thing. */
    window.addEventListener('keydown', key, true)

    /* Play the open sound here for every panel, but only for the top one. */
    if (isInnermostPanel(token)) playUi('open')

    return () => {
      window.removeEventListener('keydown', key, true)
      release()
      playUi('close')
      const at = stack.lastIndexOf(token)
      if (at >= 0) stack.splice(at, 1)
      syncPanels()
      /* Only give focus back if the panel still had it. If the player already clicked something
       * else, leave their focus alone. */
      if (cameFrom && (!document.activeElement || document.activeElement === document.body || el.contains(document.activeElement))) {
        cameFrom.focus?.()
      }
    }
  }, [token, closeOnEscape])

  /* Tab past the last control wraps to the first, and Shift+Tab wraps the other way. Everything
   * behind the panel is inert, so focus has nowhere else to go. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const el = node.current
    if (!el) return
    const items = focusablesIn(el)
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === el || !el.contains(active))) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault(); first.focus()
    }
  }, [])

  return { ref, role: 'dialog', 'aria-modal': true, 'aria-label': label, tabIndex: -1, onKeyDown }
}

/* ---- arrow traversal inside a row of tabs ------------------------------ */

/* Arrow key movement along a row of tabs. Left and Right on tabs is a keyboard habit students
 * already have. */
export function tabRowKeyDown<T>(e: React.KeyboardEvent, items: readonly T[], index: number, pick: (t: T) => void): void {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -index : e.key === 'End' ? items.length - 1 - index : 0
  if (step === 0 && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const next = (index + step + items.length) % items.length
  pick(items[next])
  /* Move focus to the tab the player arrowed to, the way tab rows work everywhere on the web. */
  const row = (e.currentTarget as HTMLElement).parentElement
  const buttons = row ? focusablesIn(row) : []
  buttons[next]?.focus()
}
