/* The short tutorial that runs right after the room is handed over. It takes about fifteen seconds
 * and it's the whole tutorial. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { announce } from '../ui/a11y'
import { track } from '../telemetry'
import './tour.css'

/* It shows one control at a time, with everything else dimmed and a pointer bobbing next to it, so
 * the student always knows which sign is being talked about. Every frame it finds `[data-tour]` in
 * the live page, so if the window resizes mid-tour the ring moves with the sign, and there's no
 * second copy of the HUD layout to keep in sync. */

export type Step = { tour: string; line: string }

/* The corner controls, shown once at the handover. */
export const HANDOVER_STEPS: Step[] = [
  { tour: 'my-year', line: 'This is your year. Everything you picked is in here, and this is where you go and do it.' },
  { tour: 'map', line: 'This is the sea. Every island somebody has built is on it, and this is how you sail there.' },
  { tour: 'guide', line: 'This is the school. Every club, sport and class at Bonney Lake, and what you have earned.' },
  /* The chart is how a student gets to an island, and the camera switch is the only control over
   * how the game looks, so both get a step. */
  { tour: 'chart', line: 'The chart on its own. Where you are, where your boat is, and every island you can sail to.' },
  { tour: 'camera-view', line: 'And this changes how close the camera sits. Wide to see the island, close to see yourself.' },
  { tour: 'help', line: 'And this stays here the whole time. Press it whenever you are not sure what to do.' },
]

/* It waits for a press instead of moving on by a timer, because a card that flips by itself loses a
 * freshman mid-sentence. Four presses still takes under fifteen seconds for anyone following along. */

/* Year one skips this, because the founding film walks the student to the table and someone stands
 * over them while they fill in the sheet. Year two is the first time the sheet opens with nobody
 * explaining it. */
export const SHEET_STEPS: Step[] = [
  { tour: 'pick-class', line: 'Start here. Two classes, and they are what you study all year.' },
  { tour: 'stamp', line: 'Then stamp the sheet. That locks the year in and the year starts.' },
]

export function Tour({ steps = HANDOVER_STEPS, onDone }: { steps?: Step[]; onDone: () => void }) {
  const [at, setAt] = useState(0)
  const [box, setBox] = useState<DOMRect | null>(null)
  const done = useRef(false)

  const finish = (why: 'watched' | 'skipped') => {
    if (done.current) return
    done.current = true
    track('tour_finished', { why, at })
    onDone()
  }

  /* Each step is read out loud when it shows up, and then the tour waits. */
  useEffect(() => {
    if (at >= steps.length) { finish('watched'); return }
    announce(steps[at].line)
  }, [at])

  /** Go on to the next control, or get out of the way after the last one. */
  const next = () => setAt((v) => v + 1)

  /* Find where the pointed-at thing is, measured again every frame of the step. */
  useEffect(() => {
    if (at >= steps.length) return
    let live = true
    const read = () => {
      if (!live) return
      const el = document.querySelector(`[data-tour="${steps[at].tour}"]`)
      setBox(el ? el.getBoundingClientRect() : null)
      requestAnimationFrame(read)
    }
    read()
    return () => { live = false }
  }, [at])

  /* Enter and space go to the next step, and escape skips the tour. */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.key === 'Escape') { e.preventDefault(); finish('skipped'); return }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  if (at >= steps.length) return null
  const step = steps[at]

  /* The space on each side picks which side the panel goes on, not where the target sits. The
   * panel's width is also capped at the space that's really there, so a wide target near the center
   * doesn't squeeze it to one word a line. */
  const SAY_W = 260
  const roomLeft = box ? box.left : 0
  const roomRight = box ? window.innerWidth - box.right : 0
  const onLeft = !!box && roomLeft > roomRight
  /* When neither side has enough space, the panel goes under the target instead. That happens with
   * a control that stretches across most of the window. */
  const room = Math.max(roomLeft, roomRight) - 24
  const beside = !!box && room >= 190
  const style = !box
    ? { left: '50%', top: '42%', transform: 'translate(-50%, -50%)' }
    : beside
      ? {
        width: `${Math.round(Math.min(SAY_W, room))}px`,
        left: onLeft ? undefined : `${Math.round(box.right + 18)}px`,
        right: onLeft ? `${Math.round(window.innerWidth - box.left + 18)}px` : undefined,
        top: `${Math.round(Math.max(12, box.top + box.height / 2 - 40))}px`,
      }
      : {
        width: `${Math.round(Math.min(SAY_W * 1.6, window.innerWidth - 40))}px`,
        left: `${Math.round(Math.max(20, Math.min(
          window.innerWidth - 20 - Math.min(SAY_W * 1.6, window.innerWidth - 40),
          box.left + box.width / 2 - Math.min(SAY_W * 1.6, window.innerWidth - 40) / 2,
        )))}px`,
        /* Below the target when there's room below, above it when there isn't. */
        top: window.innerHeight - box.bottom > 150
          ? `${Math.round(box.bottom + 18)}px`
          : `${Math.round(Math.max(12, box.top - 150))}px`,
      }

  const last = at === steps.length - 1

  /* `position: fixed` only sticks to the viewport when no parent element has a transform, a filter
   * or a backdrop-filter. Inside the year sheet that pushed the ring out of place, so the tour
   * renders straight into the body instead of every panel being checked for one. */
  return createPortal((
    <div className="tr-tour" role="dialog" aria-label="How this screen works">
      {/* The whole veil is one button, so a student can click anywhere to go on without looking for
        * a control, and the ring stays the thing being talked about. */}
      <button
        type="button"
        className="tr-veil"
        aria-label={last ? 'Finish' : 'Next'}
        onClick={next}
      />
      {/* The dim is four rectangles around the target instead of one sheet with a hole cut in it.
        * That keeps the pointed-at thing at full brightness with no mask or clip-path. With no
        * target, it's one dim over the whole screen. */}
      {box ? (
        <>
          <div className="tr-dim" aria-hidden="true" style={{ inset: `0 0 auto 0`, height: `${Math.max(0, box.top - 6)}px` }} />
          <div className="tr-dim" aria-hidden="true" style={{ inset: `${box.bottom + 6}px 0 0 0` }} />
          <div className="tr-dim" aria-hidden="true" style={{ top: `${Math.max(0, box.top - 6)}px`, height: `${box.height + 12}px`, left: 0, width: `${Math.max(0, box.left - 6)}px` }} />
          <div className="tr-dim" aria-hidden="true" style={{ top: `${Math.max(0, box.top - 6)}px`, height: `${box.height + 12}px`, left: `${box.right + 6}px`, right: 0 }} />
        </>
      ) : (
        <div className="tr-dim" aria-hidden="true" />
      )}
      {box && (
        <div
          className="tr-ring"
          aria-hidden="true"
          style={{
            left: `${Math.round(box.left - 8)}px`,
            top: `${Math.round(box.top - 8)}px`,
            width: `${Math.round(box.width + 16)}px`,
            height: `${Math.round(box.height + 16)}px`,
          }}
        />
      )}
      {box && (
        <span
          className={`tr-hand${onLeft && beside ? ' tr-hand-left' : ''}`}
          aria-hidden="true"
          style={beside ? {
            left: onLeft ? undefined : `${Math.round(box.right + 4)}px`,
            right: onLeft ? `${Math.round(window.innerWidth - box.left + 4)}px` : undefined,
            top: `${Math.round(box.top + box.height / 2 - 11)}px`,
          } : {
            /* The panel is under the target, so the pointer goes under it too and points up. */
            left: `${Math.round(box.left + box.width / 2 - 9)}px`,
            top: `${Math.round(box.bottom + 2)}px`,
          }}
        >
          {beside ? (onLeft ? '▶' : '◀') : '▲'}
        </span>
      )}
      <div className="tr-say" style={style}>
        <p className="tr-line">{step.line}</p>
        <span className="tr-foot">
          <span className="tr-count">{at + 1} of {steps.length}</span>
          <button type="button" className="tr-next" onClick={next}>
            {last ? 'Got it' : 'Next'}
          </button>
        </span>
      </div>
      <button type="button" className="tr-skip" onClick={() => finish('skipped')}>Skip</button>
    </div>
  ), document.body)
}
