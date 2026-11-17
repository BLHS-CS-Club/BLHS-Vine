/* The one dialogue box the whole game uses. It draws the portrait, the name plaque, the typed line,
 * the continue cue and the answer choices. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { announce } from '../ui/a11y'
import { bandFromRects, setUiBand } from '../ui/frame'
import { Glyph, PortraitFrame, useFace, useKitReady } from '../ui/controls'
import { kitCached, kitOptedIn, kitPiece, kitSlot } from '../ui/kit'
import './dialogue.css'

export type DialogueSkin = 'paper'

export type BoxLine = {
  who?: string
  text: string
  /** How many characters the caller's typewriter has shown so far. */
  shown: number
  done: boolean
  /**
   * A portrait id. The picture comes from /art/portraits/<id>.png, and nothing is drawn when there
   * isn't one.
   */
  portrait?: string
  emote?: string
}

/* For this long after a line appears, presses are ignored, so a key that's still held down doesn't
 * skip the new line. */
export const ADVANCE_DEAD_MS = 250

/* Which drawn paw frame the continue cue uses. A name that isn't on the sheet draws nothing instead
 * of a blank square. */
const CUE_FACE = 'frame_2'

/* The words under the cue. They name both ways to move on, clicking and the key. */
const DEFAULT_HINT = 'click, or press space'

/* How wide the portrait column is, worked out from the dialogue art when the art marks a portrait
 * region. */
function portraitColumn(): string | undefined {
  const pieces = kitCached()
  if (!pieces?.length) return undefined
  const piece = kitPiece(pieces, 'dialogue')
  const slot = kitSlot(pieces, 'dialogue', 'portrait')
  if (!piece || !slot || !(piece.w > 0) || !(slot.w > 0)) return undefined
  return `${Math.round((slot.w / piece.w) * 1000) / 10}%`
}

/* Whether the art kit has a drawn portrait frame. */
const frameIsDrawn = (): boolean =>
  kitOptedIn() && !!kitPiece(kitCached() ?? [], 'portrait_frame')

export function DialogueBox({
  line, options, onAdvance, onPick, skin = 'paper', bindKeys = true, hint = DEFAULT_HINT,
}: {
  line: BoxLine
  /**
   * When this is set, the box is asking a question instead of saying a line, and clicking it
   * doesn't move on.
   */
  options?: string[]
  onAdvance?: () => void
  onPick?: (i: number) => void
  skin?: DialogueSkin
  /* The cutscene overlay already listens for space and enter itself, so it passes false here.
   * Otherwise one press would move on twice. */
  bindKeys?: boolean
  hint?: string
}) {
  const shownAt = useRef(performance.now())
  const firstChoice = useRef<HTMLButtonElement>(null)
  const stackEl = useRef<HTMLDivElement>(null)
  const asking = !!options?.length

  /* Which choice the player pressed, kept long enough for them to see it. */
  const [picked, setPicked] = useState<number | null>(null)

  /* The art kit loads after the first render. A face asked for before it loads stays `undefined`
   * unless something re-renders, and this hook does that re-render. */
  useKitReady()
  const pawDrawn = !!useFace('cue', CUE_FACE)
  const keyPlate = useFace('chip', 'plate')

  // A new line resets the ignore-presses timer and the picked answer, so both start fresh for every
  // line.
  useEffect(() => { shownAt.current = performance.now(); setPicked(null) }, [line.text])

  /* Report how tall the conversation is, so the scene can move the picture up above it. */
  useLayoutEffect(() => {
    const measure = () => setUiBand('dialogue', bandFromRects([stackEl.current]))
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure); setUiBand('dialogue', 0) }
  }, [asking, line.done, options?.length, line.portrait])

  /* Only move focus to the first choice once the question has finished typing. Moving it earlier
   * lets a fast keyboard player answer before they've read the question. */
  useEffect(() => {
    if (asking && line.done) firstChoice.current?.focus()
  }, [asking, line.done])

  /* Read the finished line out once, for a student using a screen reader. */
  useEffect(() => {
    if (!line.done) return
    announce(line.who ? `${line.who}: ${line.text}` : line.text)
  }, [line.done, line.text, line.who])

  const live = () => performance.now() - shownAt.current > ADVANCE_DEAD_MS

  const advance = () => { if (!asking && live()) onAdvance?.() }

  /* Clicks and number keys both go through this one function, so the picked state and the
   * no-double-answer check always behave the same. */
  const pick = (i: number) => {
    if (picked !== null) return
    setPicked(i)
    /* Announce the pick out loud. The box usually closes right after, and without this a screen
     * reader user would hear the question and then nothing. */
    announce(`Chose ${options?.[i] ?? i + 1}`)
    onPick?.(i)
  }

  useEffect(() => {
    if (!bindKeys) return
    const key = (e: KeyboardEvent) => {
      if (asking) {
        // Keys 1 to 9 pick a choice, the same as clicking it.
        const n = Number(e.key)
        if (line.done && n >= 1 && n <= (options?.length ?? 0)) { pick(n - 1); e.preventDefault() }
        /* The arrow keys, Home and End move focus between the choices. */
        const n2 = options?.length ?? 0
        if (line.done && n2 > 1 && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
          const btns = [...(stackEl.current?.querySelectorAll<HTMLButtonElement>('.dlg-choice') ?? [])]
          if (btns.length) {
            const at = btns.findIndex((b) => b === document.activeElement)
            const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1
            const to = e.key === 'Home' ? 0
              : e.key === 'End' ? btns.length - 1
              : at < 0 ? 0
              : (at + step + btns.length) % btns.length
            btns[to]?.focus()
            e.preventDefault()
          }
        }
        return
      }
      if (e.key === ' ' || e.key === 'Enter') { advance(); e.preventDefault() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
    /* These deps are only the values the handler checks, so the listener isn't rebuilt every frame. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindKeys, asking, line.done, options, onPick, onAdvance, picked])

  /* The box is always in one of four states: typing, complete, asking or answered. The stylesheet
   * styles exactly these four. */
  const state = asking
    ? (picked === null ? 'asking' : 'answered')
    : line.done ? 'complete' : 'typing'

  return (
    <div ref={stackEl} className="dlg-stack" data-state={state}>
      {/* The choices sit above the box and slide in like dealt cards. */}
      {asking && line.done && (
        <div className="dlg-choices" role="group" aria-label="Choices" onClick={(e) => e.stopPropagation()}>
          {options!.map((o, i) => (
            <button
              key={o + i}
              ref={i === 0 ? firstChoice : undefined}
              className={`dlg-choice kit-surface-plank${picked === i ? ' dlg-choice-chosen' : ''}`}
              /* Once a choice is picked, the others sink back by shape and position, not only by
               * color. A school Chromebook screen washes out color and brightness. */
              disabled={picked !== null && picked !== i}
              /* The name a screen reader hears is the option, then the key that picks it. */
              aria-label={`${o}. Press ${i + 1}`}
              onClick={() => pick(i)}
            >
              {/* The plain outline around the number is only a fallback, so it's only added when
                * there's no plate art. Otherwise a square outline shows around the round drawn
                * plate. */}
              <span className={`dlg-choice-key${keyPlate ? '' : ' kit-bare'}`} style={keyPlate} aria-hidden="true">{i + 1}</span>
              <span className="dlg-choice-label">{o}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`cs-dialogue dlg-box kit-surface-dialogue${line.portrait ? ' has-portrait' : ''}`}
        data-skin={skin}
        data-state={state}
        role={asking ? 'group' : 'button'}
        tabIndex={asking ? -1 : 0}
        /* This isn't a live region. The finished line is announced once instead, by the effect
         * above. */
        aria-label={asking ? undefined : 'Continue'}
        onClick={(e) => { e.stopPropagation(); advance() }}
      >
        {line.portrait && (
          <span
            className={`dlg-portrait${frameIsDrawn() ? '' : ' dlg-portrait-bare'}`}
            style={{ width: portraitColumn() }}
          >
            {/* The kit's own portrait frame. If the portrait picture is missing, it names the
              * missing file in the console. */}
            <PortraitFrame id={line.portrait} />
          </span>
        )}
        {/* The name plaque hangs off the top edge of the box. */}
        {line.who && (
          <div className="cs-nameplaque">
            {line.who}
            {line.emote && <span className="cs-emote"> {line.emote}</span>}
          </div>
        )}
        <div className="cs-dialogue-body">
          <div className="cs-dialogue-text">
            {line.text.slice(0, line.shown)}
            {!line.done && <span className="dlg-caret" />}
          </div>
        </div>
        {line.done && !asking && (
          <div className="cs-continue-hint">
            {/* Use the platform's drawn paw if it loaded, and the local one if it didn't. */}
            <span className="dlg-paw" aria-hidden="true">
              {pawDrawn
                ? <Glyph piece="cue" face={CUE_FACE} size={16} className="dlg-paw-f" />
                : <span className="dlg-paw-f kit-mark kit-mark-paw" />}
            </span>
            <span className="dlg-hint-words">{hint}</span>
          </div>
        )}
      </div>
    </div>
  )
}
