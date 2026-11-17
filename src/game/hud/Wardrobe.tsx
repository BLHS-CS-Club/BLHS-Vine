/* The outfitter. It's a mirror where the player picks a coat color and sees what's still locked. */
import { useEffect, useRef, useState } from 'react'
import { LOOKS, drawRecolored } from '../thorLook'
import { BARE, WEAR, walkFrameOf } from '../thorWear'
import { loadSave, writeSave } from '../save'
import { track } from '../telemetry'
import { announce, usePanel } from '../ui/a11y'
import { Chip, Glyph, Plank } from '../ui/controls'
import { saved } from '../ui/feedback'
import { prefersReducedMotion } from '../ui/motion'
import './wardrobe.css'

/* The eight directions, in the order a figure turns clockwise. */
const RING = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'] as const
type Heading = typeof RING[number]

const headingWord = (h: Heading): string => h.replace('-', ' ')

/* The fixed box the figure is drawn into, so the feet stay on one line while it turns. */
const STAGE_W = 62
const STAGE_H = 80
const FOOT = 2

/* Finds where the drawn pixels are. Walk frames are 144 by 144 with the panther taking up about 56
 * by 67 of that, so centering the whole canvas would center the empty padding instead. It returns
 * the box around every pixel that isn't transparent, or null when the frame is empty, which means
 * the png failed to load. */
function inkBox(g: CanvasRenderingContext2D, w: number, h: number):
{ x: number; y: number; w: number; h: number } | null {
  const d = g.getImageData(0, 0, w, h).data
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] < 24) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}


export function Wardrobe({ onClose }: { onClose: () => void }) {
  const s = loadSave()
  const [look, setLook] = useState(s?.thorLook ?? 'classic')
  /* What's worn over the coat. There's only one slot, because an outfit is a whole edited character
   * and not a layer on top (`thorWear.ts` explains why). */
  const [worn, setWorn] = useState(s?.thorWear ?? BARE)
  const [facing, setFacing] = useState(0)
  const [spin, setSpin] = useState(0)
  const cvRef = useRef<HTMLCanvasElement>(null)

  /* The mirror must use the same walk frames the world uses,
   * `/art/characters/thor/walk/<heading>/0.png`, not the eight standing pngs at the top level.
   * Otherwise a coat gets picked on a body the player never sees. Those frames are already in the
   * scene's cache, so loading them costs nothing. */

  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    let live = true
    const img = new Image()
    img.onload = () => {
      if (!live) return
      /* If the browser refuses the canvas, the mirror stays empty and the words still say what's
       * worn. This must never throw inside a load callback, because nothing there can catch it. */
      try {
        const off = document.createElement('canvas')
        const g = cv.getContext('2d')
        const og = off.getContext('2d', { willReadFrequently: true })
        if (!g || !og) return
        drawRecolored(off, img, LOOKS[look]?.hue ?? null)
        /* Trim to the panther. The walk frames are 144 by 144 with the panther somewhere inside,
         * not the 52 by 67 tight crop the stage was sized for, so plain
         * center-and-stand-on-the-floor math puts most of the figure off the edge. Measure the
         * drawn pixels for each frame shown, the same scan the scene uses to find the feet. */
        const box = inkBox(og, off.width, off.height)
        cv.width = STAGE_W
        cv.height = STAGE_H
        g.imageSmoothingEnabled = false
        g.clearRect(0, 0, STAGE_W, STAGE_H)
        if (!box) return
        g.drawImage(
          off, box.x, box.y, box.w, box.h,
          Math.round((STAGE_W - box.w) / 2), STAGE_H - box.h - FOOT, box.w, box.h,
        )
      } catch { /* Left empty on purpose. See the note above. */ }
    }
    /* The mirror shows what was picked, not the bare panther. A coat is a recolor of this same
     * picture and an outfit is a different picture, so both get drawn here. */
    img.src = walkFrameOf(worn, RING[facing], 0)
    return () => { live = false }
  }, [look, facing, worn])

  /* The turn, one frame at a time. Eight steps bring the figure back to where it started, so
   * changing the coat shows the whole coat without changing the pose. The timer is cleared on
   * unmount. */
  useEffect(() => {
    if (spin <= 0) return
    const t = window.setTimeout(() => {
      setFacing((f) => (f + 1) % RING.length)
      setSpin((n) => n - 1)
    }, 80)
    return () => window.clearTimeout(t)
  }, [spin])

  /* Saved on every pick, not on a confirm button. There's no cancel on purpose, because an OK
   * button would turn the mirror into a form. */
  const pick = (k: string) => {
    setLook(k)
    writeSave({ thorLook: k })
    track('cosmetic_change', { look: k, via: 'outfitter' })
    /* The figure turns all the way around once, unless the student asked for less motion. */
    if (!prefersReducedMotion()) setSpin(RING.length)
    /* The mirror is the only thing on screen that changes, and it's a canvas. A player who can't
     * see the recolor needs the kit's stamp and the spoken announcement to know the button worked. */
    saved(`Wearing ${LOOKS[k]?.label ?? k}`)
  }

  const turn = (step: 1 | -1) => {
    const next = (facing + step + RING.length) % RING.length
    setSpin(0)
    setFacing(next)
    announce(`Facing ${headingWord(RING[next])}`)
  }

  /* The panel hook handles escape, so only the panel on top responds to it. A window listener here
   * would also fire when something else is open on top of the wardrobe. */
  const panel = usePanel({ label: 'Your clothes', onClose })

  return (
    <div className="wd-veil" onClick={onClose}>
      <div className="wd-panel kit-surface-panel" onClick={(e) => e.stopPropagation()} {...panel}>
        <header className="wd-top">
          <h2 className="wd-head">Your clothes</h2>
          <p className="wd-sub">Pick a coat color. Nothing here costs anything.</p>
        </header>

        <div className="wd-body">
          <div className="wd-mirror kit-surface-portrait_frame">
            {/* The mirror is a picture, so what it shows is written out next to it. */}
            <canvas ref={cvRef} className="wd-thor" aria-hidden="true" />
            <p className="wd-facing">Facing {headingWord(RING[facing])}</p>
            {/* The turn buttons, using the arrow from the plank's own glyph slot. */}
            <div className="wd-turns">
              <Plank size="sm" glyph={['icon_set', 'arrow']} className="wd-turn wd-turn-left" onClick={() => turn(-1)}>
                Turn left
              </Plank>
              <Plank size="sm" glyph={['icon_set', 'arrow']} className="wd-turn" onClick={() => turn(1)}>
                Turn right
              </Plank>
            </div>
          </div>

          <div className="wd-side">
            <section className="wd-group" aria-labelledby="wd-coats">
              <h3 className="wd-grouphead" id="wd-coats">Coats</h3>
              <div className="wd-swatches">
                {Object.entries(LOOKS).map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    className={`wd-swatch${look === k ? ' wd-swatch-on' : ''}`}
                    /* A swatch is only a color, so its name is written on the button where a
                     * keyboard can reach it, not in a tooltip only a mouse can reach. */
                    aria-pressed={look === k}
                    onClick={() => pick(k)}
                  >
                    <span
                      className="wd-dye"
                      aria-hidden="true"
                      /* The dye color itself, from thorLook.ts. This is what the player is
                       * choosing. */
                      style={{ background: v.hue === null ? 'var(--kit-front-teal)' : `hsl(${v.hue}, 48%, 42%)` }}
                    />
                    <span className="wd-swatch-name">{v.label}</span>
                    {look === k && <Glyph piece="icon_set" face="tick" size={15} className="wd-swatch-tick" />}
                  </button>
                ))}
              </div>
              {/* Say it in words too. The ring and the raised button both rely on shape, and a
                * student shouldn't have to work those out. */}
              <p className="wd-worn">Wearing {LOOKS[look]?.label ?? look}</p>
            </section>

            <section className="wd-group" aria-labelledby="wd-locked">
              <h3 className="wd-grouphead" id="wd-locked">Not yours yet</h3>
              <div className="wd-locks">
                {WEAR.map((it) => {
                  const got = it.has(s)
                  /* Earned and drawn means it can be worn. If `drawn` is false, the card says the
                   * art is missing instead of offering clothes it can't put on. */
                  const wearable = got && it.drawn
                  const on = worn === it.id
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className="wd-lock"
                      aria-pressed={wearable ? on : undefined}
                      data-state={on ? 'worn' : got ? 'earned' : 'locked'}
                      onClick={() => {
                        track('locked_item_inspected', { item: it.name, earned: got, wearable })
                        if (!wearable) {
                          announce(got
                            ? `${it.name}, earned. Nobody has drawn it yet, so Thor cannot wear it.`
                            : it.earn ? `${it.name}. Earn by: ${it.earn}` : `${it.name}. Not open yet.`)
                          return
                        }
                        /* Pressing the one already worn takes it off. That's the only way back to
                         * the bare panther. */
                        const next = on ? BARE : it.id
                        setWorn(next)
                        writeSave({ thorWear: next === BARE ? undefined : next })
                        track('wear_change', { wear: next })
                        saved(next === BARE ? 'Back to just the coat' : `Wearing ${it.name}`)
                        announce(next === BARE ? `${it.name} taken off` : `${it.name} on`)
                      }}
                    >
                      <Chip state={got ? 'plate_lit' : 'plate'} className="wd-lock-plate">
                        {got
                          ? <Glyph piece="stamp" face="awarded" size={20} />
                          : <Glyph piece="icon_set" face="lock" size={16} />}
                      </Chip>
                      <span className="wd-lock-words">
                        <span className="wd-lock-name">{it.name}</span>
                        <span className="wd-lock-earn">
                          {!got ? (it.earn ? `Earn by: ${it.earn}` : 'Not open yet.')
                            : !it.drawn ? 'Earned. Nobody has drawn it yet, so Thor cannot wear it.'
                              : on ? 'On. Press to take it off.' : 'Earned. Press to wear it.'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="wd-note">
                You earn these by playing. They are a record of what you did; the coats above
                are the part Thor wears.
              </p>
            </section>
          </div>
        </div>

        <div className="wd-foot">
          <Plank size="lg" keyCap="Esc" onClick={onClose}>Back to the game</Plank>
        </div>
      </div>
    </div>
  )
}
