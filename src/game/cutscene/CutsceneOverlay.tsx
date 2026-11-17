import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CutsceneRuntime } from './runtime'
import { isCaptain } from '../captain'
import { BUILD_TAG } from '../buildTag'
import { DialogueBox } from '../hud/DialogueBox'
import { Glyph } from '../ui/controls'
import './ui-kit.css'

// Everything a running cutscene draws on top of the screen: the black bars, the dark edges, the
// fades, the dialogue box and the small signs.

const SKIP_HOLD_MS = 600

/* The layer a cutscene draws on. It sits above the world but below any panel a student opens. */
const CUTSCENE_LAYER = 72

export function CutsceneOverlay({ rt, children }: { rt: CutsceneRuntime; children?: ReactNode }) {
  const [, bump] = useState(0)
  useEffect(() => rt.subscribe(() => bump((v) => v + 1)), [rt])

  // Space or Enter moves the cutscene forward.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      /* Skip this when a button or other control has focus. Space and Enter already press a focused
       * button, so advancing here too would make one key press skip two lines. */
      const on = document.activeElement
      if (on && on !== document.body && on.closest('button, a, input, select, textarea')) return
      rt.advance()
      e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [rt])

  // Hold to skip means holding Escape. A click on the skip sign skips right away, so the fill bar
  // below only shows how long the held key has left.
  const [holdAt, setHoldAt] = useState<number | null>(null)
  const holdTimer = useRef<number | null>(null)
  const beginHold = () => {
    if (!rt.ui.skippable) return
    setHoldAt(performance.now())
    holdTimer.current = window.setTimeout(() => { rt.skip(); setHoldAt(null) }, SKIP_HOLD_MS)
  }
  const endHold = () => {
    if (holdTimer.current !== null) { clearTimeout(holdTimer.current); holdTimer.current = null }
    setHoldAt(null)
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.repeat && rt.ui.active) beginHold() }
    const up = (e: KeyboardEvent) => { if (e.key === 'Escape') endHold() }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt])

  /* Mark the page while the bars are showing, so a control that's allowed to stay on screen can
   * move up above them. */
  useEffect(() => {
    const on = rt.ui.active && rt.ui.letterbox > 0.02
    if (on) document.documentElement.dataset.letterbox = '1'
    else delete document.documentElement.dataset.letterbox
    return () => { delete document.documentElement.dataset.letterbox }
  }, [rt.ui.active, rt.ui.letterbox])

  const ui = rt.ui
  if (!ui.active) return <>{children}</>

  const barH = `${(ui.letterbox * 10).toFixed(2)}vh`

  return (
    <>
      {children}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: CUTSCENE_LAYER }} onClick={(e) => {
        /* Ignore clicks that land on a button or other control. This div covers the whole screen,
         * so without this check a click on a button would run the button and then advance the
         * cutscene too, skipping a page the player hasn't read. */
        const hit = e.target as HTMLElement | null
        if (hit && hit.closest('button, a, input, select, textarea')) return
        rt.advance()
      }}>
        {/* The dark edges that make it look like the player's eyes are opening. It's a radial
          * gradient so the middle of the screen stays visible. */}
        {ui.vignette > 0.003 && (
          <div style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(ellipse ${100 - ui.vignette * 78}% ${100 - ui.vignette * 80}% at 50% 46%, transparent 38%, rgba(4,6,9,${0.55 + ui.vignette * 0.45}) 100%)`,
          }} />
        )}
        {/* The black bars. The height is animated, so it's set inline. */}
        <div className="cs-letterbox" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: barH, background: '#04060a' }} />
        <div className="cs-letterbox" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: barH, background: '#04060a' }} />
        {/* A fade that covers the whole screen. */}
        {ui.fade > 0.003 && <div style={{ position: 'absolute', inset: 0, background: ui.fadeColor, opacity: ui.fade }} />}

        {/* A caption: one floating line of text with no box around it. */}
        {ui.caption && (
          <div className="cs-caption" style={{ opacity: ui.caption.alpha }}>{ui.caption.text}</div>
        )}

        {/* A small sign telling the player what to do, like "walk to it". */}
        {ui.prompt && <div className="cs-prompt">{ui.prompt.text}</div>}

        {/* The same dialogue box the world uses. It only shows once at least one character is
          * typed, so it's never empty. */}
        {ui.dialogue && (ui.dialogue.shown > 0 || ui.dialogue.done) && (
          <div style={{ pointerEvents: 'auto' }}>
            <DialogueBox
              line={ui.dialogue}
              onAdvance={() => rt.advance()}
              /* This overlay already listens for Space and Enter itself. Those keys also answer its
               * confirm and walk-to steps when no line is showing. */
              bindKeys={false}
            />
          </div>
        )}

        {/* The build stamp. It only shows in captain mode, not in every student's corner. */}
        {isCaptain() && (
          <div className="cs-debug">
            {BUILD_TAG}{ui.dialogue ? ` · say ${ui.dialogue.shown}/${ui.dialogue.text.length}${ui.dialogue.done ? ' done' : ''}` : ''}
          </div>
        )}
        {/* The skip sign. One click skips to the next beat that can't be skipped. In captain mode
          * it ends the whole cutscene, which is handy for testing. */}
        {/* It's a real button, so Tab can reach it and Enter or Space can press it. */}
        {ui.skippable && (
          <button
            type="button" className="cs-skip" style={{ pointerEvents: 'auto' }}
            aria-label={isCaptain() ? 'Skip the whole scene' : 'Skip this part of the scene'}
            /* There's no hold-to-skip for the mouse on purpose. A click already skips, so a hold
             * would skip once from the timer and again from the click. */
            onClick={(e) => { e.stopPropagation(); if (isCaptain()) rt.godSkip(); else rt.skip() }}
          >
            {/* The fill bar takes exactly as long as the real hold. Don't shorten it for reduced
              * motion, or the bar fills before letting go actually skips. */}
            <span className="cs-skip-fill" style={{ width: holdAt ? '100%' : '0%', transition: holdAt ? `width ${SKIP_HOLD_MS}ms linear` : 'none' }} />
            {/* A word and a drawn arrow, not an emoji icon. */}
            <span className="cs-skip-words">{isCaptain() ? 'skip all' : 'skip'}</span>
            <Glyph piece="icon_set" face="arrow" size={12} className="cs-skip-mark" />
          </button>
        )}
      </div>
    </>
  )
}
