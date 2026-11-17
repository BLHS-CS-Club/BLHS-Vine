/* The card that shows a place's name when the player arrives. It fades away by itself and never
 * takes input. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { dialogueState, onDialogue } from '../dialogue'
import { nextObjective, objectiveLine } from '../run/objective'
import { loadSave } from '../save'
import { onPlaceCard, sceneDrawn, setPlaceCardUp, type PlaceCardRequest } from './stage-bus'
import { transitionBusy } from '../../app/transitions'
import { announce, panelDepth } from '../ui/a11y'
import { Glyph, useKitReady } from '../ui/controls'
import { bandFromRects, setUiBandStacked } from '../ui/frame'
import { prefersReducedMotion } from '../ui/motion'
import { cinemaOn } from './cinema'
import './placecard.css'

const DWELL_MS = 3200
/* The longest a card waits behind something else on screen before it stops waiting. */
/* A card that was asked for always gets its turn. It waits for a clear screen first. */
const WAIT_CEILING_MS = 45000

/** held: asked for, waiting for the screen to be free. in: on screen. out: leaving. */
type CardPhase = 'held' | 'in' | 'out'

export function PlaceCard() {
  const [card, setCard] = useState<PlaceCardRequest | null>(null)
  const [phase, setPhase] = useState<CardPhase>('held')
  /* Re-renders when the drawn UI kit finishes loading, so a page drawn before that still gets the
   * real pin picture. */
  useKitReady()
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => onPlaceCard((c) => { setCard(c); setPhase('held') }), [])

  /* Whether anyone is talking, so the card and a line of dialogue are never on screen together. */
  const [speaking, setSpeaking] = useState(() => dialogueState() !== null)
  useEffect(() => onDialogue((s) => setSpeaking(s !== null)), [])

  /* The card waits for a clear screen, so its timer only starts once the player can actually see
   * it. */
  useEffect(() => {
    if (!card || phase !== 'held') return
    /* The three checks read the live values, not React state, so the wait limit is measured
     * correctly. */
    /* It doesn't wait for a cutscene to end, because a title card is supposed to show inside the
     * black bars. */
    const clear = () => !transitionBusy() && dialogueState() === null && panelDepth() === 0
    if (clear()) { setPhase('in'); return }
    const t0 = performance.now()
    const held = window.setInterval(() => {
      if (clear()) { window.clearInterval(held); setPhase('in'); return }
      /* At the limit it shows anyway. A screen that's been busy for 45 seconds isn't going to clear
       * up, and three seconds of the place name is better than no card. */
      if (performance.now() - t0 > WAIT_CEILING_MS) { window.clearInterval(held); setPhase('in') }
    }, 100)
    return () => window.clearInterval(held)
  }, [card, phase])

  /* Reduced motion makes the card stay up for less time, but still shows it. */
  /* A place the player has already seen gets an even shorter time. */
  const dwell = (prefersReducedMotion() ? DWELL_MS * 0.6 : DWELL_MS) * (card?.brief ? 0.55 : 1)

  /* A click or key press anywhere puts the card away. The listener is on the window and doesn't
   * stop the event on purpose. The card has `pointer-events: none`, so it never blocks a click
   * meant for the room underneath, and that click still reaches what it was aimed at. */
  useEffect(() => {
    if (!card || phase !== 'in') return
    const away = () => setPhase('out')
    window.addEventListener('pointerdown', away, { capture: true })
    window.addEventListener('keydown', away)
    return () => {
      window.removeEventListener('pointerdown', away, { capture: true })
      window.removeEventListener('keydown', away)
    }
  }, [card, phase])

  useEffect(() => {
    if (!card || phase !== 'in') return
    const a = window.setTimeout(() => setPhase('out'), dwell)
    /* If a panel opens while the card is up, the card gets out of the way. */
    const watch = window.setInterval(() => { if (panelDepth() > 0) setCard(null) }, 200)
    return () => { window.clearTimeout(a); window.clearInterval(watch) }
  }, [card, phase, dwell])

  /* Leaving is its own step, because a card can be put away early as well as time out. */
  useEffect(() => {
    if (phase !== 'out') return
    const t = window.setTimeout(() => setCard(null), 700)
    return () => window.clearTimeout(t)
  }, [phase])

  /* If someone starts talking while the card is up, the card leaves instead of sharing the bottom
   * of the screen with the dialogue box. It comes back once afterward, because arriving to a line
   * of dialogue is normal, and dropping the card would leave the student not knowing where they
   * are. */
  const requeued = useRef(false)
  useEffect(() => {
    if (phase !== 'in' || !speaking) return
    if (requeued.current) { setPhase('out'); return }
    requeued.current = true
    setPhase('held')
  }, [phase, speaking])

  /* A new card is a new arrival, so it gets its own second chance. */
  useEffect(() => { requeued.current = false }, [card])

  const visible = !!card && phase !== 'held' && panelDepth() === 0

  useLayoutEffect(() => {
    if (!visible) { setUiBandStacked('placecard', 0); return }
    const measure = () => setUiBandStacked('placecard', bandFromRects([el.current]))
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure); setUiBandStacked('placecard', 0) }
  }, [visible, card, phase])

  useEffect(() => {
    setPlaceCardUp(visible)
    return () => setPlaceCardUp(false)
  }, [visible])

  /* The one thing the year wants the player to do next, worked out at the moment they arrive. It's
   * a plain function call with no fetch, and it's the same function the heading and the world
   * marker use. */
  /* It's worked out for the map the player is standing on now, not the one they came from. */
  /* It isn't worked out during a cutscene, and it's only ever read out to a screen reader. */
  const heading = card && !cinemaOn() ? objectiveLine(nextObjective(loadSave()), sceneDrawn()) : ''

  /* Tell a screen reader about the arrival once, politely, as soon as the card shows. */
  const said = useRef('')
  useEffect(() => {
    if (!visible || !card) return
    const line = [card.title, card.line, heading].filter(Boolean).join('. ')
    if (line === said.current) return
    said.current = line
    announce(line)
  }, [visible, card, heading])

  /* A card never draws over a panel. If one is open, the card is dropped, not saved for later. */
  if (!visible || !card) return null

  return (
    /* aria-hidden and pointer-events none, because it isn't a control. `announce` above already
     * reads the words to a screen reader, so without aria-hidden the place name would be read
     * twice. */
    <div
      ref={el}
      className={`pc-root ${phase === 'out' ? 'pc-out' : 'pc-in'}`}
      data-brief={card.brief ? '1' : undefined}
      style={{ ['--pc-dwell' as string]: `${Math.round(dwell)}ms` }}
      aria-hidden="true"
    >
      {/* The card uses the kit's drawn band, which tokens.css can style three different ways. */}
      <div className="pc-card kit-surface-band">
        <p className="pc-where">
          {/* A pin, because a name on a map gets a pin. There's no fallback shape, on purpose. */}
          <Glyph piece="pointer" face="pin_tail" size={30} className="pc-pin" />
          <span className="pc-name">{card.title}</span>
        </p>
        {card.line ? <p className="pc-line">{card.line}</p> : null}
        {/* Where the player is and what they're here to do go together, but only the place is drawn
          * on this card. */}
        {/* The task shows in the objective panel at the top of the screen all the time. See
          * `heading` above for why it's worked out here but not drawn. */}
        {/* A line that shrinks while the card is up, so the player can tell the card will leave by
          * itself. */}
        <span className="pc-dwell" aria-hidden="true" />
      </div>
    </div>
  )
}
