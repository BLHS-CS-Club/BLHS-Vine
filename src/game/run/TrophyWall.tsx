/* The trophy wall. It has one frame for each thing the player chose, across every year, and each
 * frame stays empty until that thing is done. */
import { Fragment, useEffect, useState } from 'react'
import { loadSave } from '../save'
import { wallAll } from './wall'
import { usePanel } from '../ui/a11y'
import { Glyph, Plank } from '../ui/controls'
import { track } from '../telemetry'
import { yearWord } from './year'
import { play } from '../audio'
import './wall.css'

export function TrophyWall({ onClose }: { onClose: () => void }) {
  const panel = usePanel({ onClose, label: 'The trophy wall' })
  const s = loadSave()
  /* Show every year, not just the current one. `wallOf(s)` defaults to the year the student is in,
   * so early in a year it would show almost nothing. */
  const seats = wallAll(s)
  const filled = seats.filter((w) => w.earned).length

  useEffect(() => { track('wall_opened', { filled, of: seats.length }) }, [filled, seats.length])

  /* The wall fills one frame at a time with a pop, in the order things happened that year. Only
   * earned frames pop, so nothing gets a sound for something that wasn't done. It runs once each
   * time the wall opens, so a save happening in the background doesn't restart it. */
  const [landed, setLanded] = useState(0)
  const earnedIds = seats.filter((w) => w.earned).map((w) => `${w.year}:${w.id}`)
  useEffect(() => {
    if (landed >= earnedIds.length) return
    const t = window.setTimeout(() => {
      setLanded((v) => v + 1)
      /* The same small sound the game plays whenever something is awarded. */
      play('cork_pop')
    }, landed === 0 ? 420 : 460)
    return () => window.clearTimeout(t)
  }, [landed, earnedIds.length])
  /* Whether this earned frame has had its turn to pop in yet. */
  const showing = (id: string) => earnedIds.indexOf(id) < landed

  return (
    <div className="tw-veil" onClick={onClose}>
      <div {...panel} className="tw-sheet kit-surface-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="tw-title">The trophy wall</h2>
        {/* The count is the headline, written in words instead of as a fraction. */}
        {/* It uses the same word and count as the drape and the yearbook. */}
        <p className="tw-lede">
          {seats.length === 0
            ? 'No badges yet. Pick your year and an empty frame appears for each thing you choose.'
            : filled === 0
              ? `No badges on the wall yet. ${seats.length} empty ${seats.length === 1 ? 'frame' : 'frames'}: finish a thing and its badge goes up here.`
              : `${filled} ${filled === 1 ? 'badge' : 'badges'} on the wall, ${seats.length - filled} ${seats.length - filled === 1 ? 'frame' : 'frames'} still empty.`}
        </p>

        {/* Frames are grouped by year. The year heading is what makes year one's Advisory look like
          * year one's and not a copy of year two's. */}
        <div className="tw-wall">
          {seats.map((w, i) => (
            <Fragment key={`${w.year}:${w.id}`}>
              {(i === 0 || seats[i - 1].year !== w.year) && (
                <h3 className="tw-year">Year {yearWord(w.year)}</h3>
              )}
            <article
              className={`tw-frame${w.earned && showing(`${w.year}:${w.id}`) ? ' tw-frame-full tw-frame-land' : ''}`}
              data-kind={w.kind}
            >
              {/* The plate shows the state: a drawn stamp when earned, a dashed hole when not. */}
              <span className="tw-plate" aria-hidden="true">
                {w.earned && showing(`${w.year}:${w.id}`)
                  ? <Glyph piece="stamp" face="awarded" size={34} />
                  : <span className="tw-hole" />}
              </span>
              <span className="tw-words">
                <span className="tw-name">{w.name}</span>
                {/* An earned frame always shows what was earned, even before its pop. The animation
                  * only controls when the stamp appears, never which text is shown. */}
                <span className={w.earned ? 'tw-got' : 'tw-wants'}>
                  {w.earned ? w.says : w.wants}
                </span>
              </span>
            </article>
            </Fragment>
          ))}
        </div>

        <div className="tw-foot">
          <Plank size="md" keyCap="Esc" onClick={onClose}>Back</Plank>
        </div>
      </div>
    </div>
  )
}
