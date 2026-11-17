/* The end-of-year screen where the counselor drapes a cord on the student. It shows every cord
 * they've earned and the one they're closest to. */
import { useEffect } from 'react'
import { loadSave } from '../save'
import { cordsOf } from '../progress'
import { onTheWall } from './wall'
import { usePanel } from '../ui/a11y'
import { Gauge, Glyph, Plank } from '../ui/controls'
import { track } from '../telemetry'
import './drape.css'

export function CordDrape({ year, onDone }: { year: number; onDone: () => void }) {
  const panel = usePanel({ onClose: onDone, label: 'The counselor drapes a cord' })
  const s = loadSave()

  /* List every earned cord first, then the closest unearned one below them. Showing only one cord
   * would repeat the same ribbon every year and skip the ones earned later. */
  const all = cordsOf(s ?? ({} as never)).filter((c) => c.published)
  const won = all.filter((c) => c.earned)
  /* A cord with zero progress is never shown as the closest one. The game doesn't hand out a ribbon
   * for something the student hasn't started. */
  const near = all
    .filter((c) => !c.earned && c.progress > 0)
    .sort((a, b) => b.progress - a.progress)[0] ?? null
  const cord = won[0] ?? near

  const filled = onTheWall(s, year)
  /* Cords only count at graduation, so the gold color and the seal wait until year four. */
  const closed = !!cord?.earned && !!s?.graduated

  useEffect(() => {
    track('cord_draped', { year, cord: cord?.id ?? null, progress: cord?.progress ?? 0, wall: filled })
  }, [year, cord, filled])

  return (
    <div className="cd-veil">
      <div {...panel} className="cd-card kit-surface-panel">
        <p className="cd-who">The counselor</p>

        {cord ? (
          <>
            {/* The cord itself: two ribbons hanging from a collar. It turns gold only once it's
              * earned. */}
            <div className={`cd-drape${closed ? ' cd-drape-earned' : ''}`} aria-hidden="true">
              <span className="cd-collar" />
              <span className="cd-fall cd-fall-l" />
              <span className="cd-fall cd-fall-r" />
              {closed && <Glyph piece="stamp" face="awarded" size={30} className="cd-seal" />}
            </div>

            {!!won.length && (
              <>
                <p className="cd-lead">{won.length === 1 ? 'Your cord' : 'Your cords'}</p>
                <ul className="cd-list">
                  {won.map((c) => (
                    <li className="cd-row" key={c.id}>
                      <Glyph piece="stamp" face="awarded" size={18} className="cd-rowseal" />
                      <span className="cd-rowname">{c.name}</span>
                      {/* The ribbon drawing uses the game's own colors, so print the school's real
                        * colors too. Otherwise a teal ribbon could be mistaken for the real black
                        * and silver one. */}
                      <span className="cd-rowcolors">{c.colors}</span>
                    </li>
                  ))}
                </ul>
                {!s?.graduated && (
                  <p className="cd-when">
                    Cords are counted at graduation, in year four. Keep this up and they are yours.
                  </p>
                )}
              </>
            )}

            {near && (
              <>
                <p className="cd-lead">{won.length ? 'Working towards' : 'The cord you are closest to'}</p>
                <h2 className="cd-name">{near.name}</h2>
                <p className="cd-colors">Its real colours: {near.colors}</p>
                {/* How far along the student is, shown with the school's own numbers. */}
                <Gauge value={near.progress} label={`${near.name}, ${near.detail}`} className="cd-bar" />
                <p className="cd-stands">{near.detail}</p>
                <p className="cd-rule">
                  <span className="cd-rulelabel">Bonney Lake gives it for</span> {near.rule}
                </p>
              </>
            )}
          </>
        ) : (
          /* No cord has any progress yet. That's a normal way to end a first year, so the counselor
           * explains how to start one instead of showing an empty drape. */
          <>
            <h2 className="cd-name">No cord started yet</h2>
            <p className="cd-stands">
              A cord takes more than one year. Pick something and stay with it, and this is where it shows.
            </p>
          </>
        )}

        <p className="cd-wall">
          {/* `onTheWall` is given this year, so the count is only for this year and the sentence
            * has to say so. The whole wall across every year lives in `run/wall.ts`. */}
          {filled === 0
            ? 'No badges on your wall this year.'
            : `${filled} ${filled === 1 ? 'badge' : 'badges'} on your wall this year.`}
        </p>

        <div className="cd-foot">
          {/* The button names what just happened and doesn't promise anything about next time. */}
          <Plank size="lg" onClick={onDone}>
            {won.length > 1 ? 'That is my cords' : won.length === 1 ? 'That is my cord' : 'Keep going'}
          </Plank>
        </div>
      </div>
    </div>
  )
}
