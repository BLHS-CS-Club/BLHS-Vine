import { useEffect, useState, type CSSProperties } from 'react'
import { loadSave } from '../save'
import { CordDrape } from './CordDrape'
import { YearCard } from './YearCard'
import { track } from '../telemetry'
import { announce, tabRowKeyDown, usePanel } from '../ui/a11y'
import { Chip, Gauge, Glyph, Plank, Tab, useKitReady } from '../ui/controls'
import { prefersReducedMotion } from '../ui/motion'
import {
  turnYearPage, yearbookPage, yearbookYears, yearTurned,
  type GpaMove, type YearbookRow, type YearbookSection,
} from './yearbook-page'
import { yearWord } from './year'
import { cinemaOn } from '../stage/cinema'
import './run.css'

/* The full yearbook spread for a year, plus the page turn that ends the year. */

/* How long each section waits before it appears. With six sections at 130ms each, the whole page is
 * in place in under a second, so it feels like it's being laid out instead of loading. */
const STEP_MS = 130

/* Animates the GPA number. In the first year it's written in, after that it counts from last year's
 * number, and it stays still if nothing changed. */
function useInkedNumber(from: number | null, to: number | null, move: GpaMove): number | null {
  const travels = (move === 'up' || move === 'down') && from !== null && to !== null
  const [shown, setShown] = useState<number | null>(travels && !prefersReducedMotion() ? from : to)
  useEffect(() => {
    if (!travels || prefersReducedMotion()) { setShown(to); return }
    const a = from as number
    const b = to as number
    const started = performance.now()
    const RUN_MS = 900
    let raf = requestAnimationFrame(function step(now: number) {
      const k = Math.min(1, (now - started) / RUN_MS)
      /* Eased out so the last digits slow down and settle. A number that stops at full speed looks
       * like a counter instead of ink drying. */
      setShown(a + (b - a) * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
      else setShown(b)
    })
    return () => cancelAnimationFrame(raf)
  }, [from, to, travels])
  return shown
}

/* Describes the GPA change in words, so the meaning doesn't depend on color alone. */
function moveWords(move: GpaMove, from: number | null): string {
  if (move === 'up' && from !== null) return `up from ${from.toFixed(2)} last year`
  if (move === 'down' && from !== null) return `down from ${from.toFixed(2)} last year`
  if (move === 'held' && from !== null) return 'exactly where it stood last year'
  return 'your first GPA'
}

/* ---- ONE ROW ------------------------------------------------------------- */

function Row({ row, section }: { row: YearbookRow; section: YearbookSection['id'] }) {
  if (section === 'marks') {
    /* A badge is a drawn plate with a stamp on it, not a line of text. */
    return (
      <li className="yb-row yb-row-mark">
        <Chip state="plate_lit" className="yb-markchip">
          <Glyph piece="stamp" face="awarded" size={18} />
        </Chip>
        <span className="yb-rowtitle">{row.title}</span>
        <span className="yb-rowmeta">{row.meta}</span>
      </li>
    )
  }

  if (section === 'threads') {
    /* A cord shows partial progress toward a real number, with the school's rule quoted. */
    return (
      <li className={`yb-row yb-row-thread${row.done ? ' yb-row-done' : ''}`}>
        <span className="yb-threadhead">
          <span className="yb-rowtitle">{row.title}</span>
          {row.done
            ? (
              <span className="yb-earned">
                <Glyph piece="stamp" face="approved" size={20} />
                <span className="yb-earnedword">earned</span>
              </span>
            )
            : <span className="yb-rowmeta">{row.meta}</span>}
        </span>
        <Gauge value={row.progress ?? 0} label={`${row.title}, ${row.meta}`} />
        {/* The full rule is in the Handbook, one press away. */}
      </li>
    )
  }

  return (
    <li className="yb-row">
      {row.face && <Glyph piece={row.face[0]} face={row.face[1]} size={20} className="yb-rowmark" />}
      <span className="yb-rowtitle">{row.title}</span>
      <span className="yb-rowmeta">{row.meta}</span>
    </li>
  )
}

/* ---- ONE SECTION, WITH ITS PLACE IN THE COMPOSITION ---------------------- */

function Section({ sec, step }: { sec: YearbookSection; step: number }) {
  return (
    <section className="yb-sect" style={{ '--yb-step': `${step * STEP_MS}ms` } as CSSProperties}>
      <h3 className="yb-secthead">{sec.heading}</h3>
      {/* When a section shows something different from what its heading suggests, a small note
        * under the heading says so. */}
      {sec.caveat && <p className="yb-caveat">{sec.caveat}</p>}
      {sec.rows.length === 0
        /* An empty section says it's empty instead of vanishing. If the student never sees the
         * heading, they never learn that part of the year was possible. */
        ? <p className="yb-empty">{sec.empty}</p>
        : <ul className="yb-rows">{sec.rows.map((r) => <Row key={sec.id + r.key} row={r} section={sec.id} />)}</ul>}
    </section>
  )
}

/* ---- THE PAGE ------------------------------------------------------------ */

export function Yearbook({ onClose, onGraduate }: { onClose: () => void; onGraduate?: () => void }) {
  const [turned, setTurned] = useState(false)
  const [draping, setDraping] = useState(false)
  // The year the book is open to. It starts on the current year, and the spine changes it.
  const [year, setYear] = useState(() => loadSave()?.year ?? 1)
  const panel = usePanel({ label: 'The yearbook', onClose })
  useKitReady()
  const s = loadSave()
  const page = s ? yearbookPage(s, year) : null
  const shown = useInkedNumber(page?.priorGpa ?? null, page?.gpa ?? null, page?.move ?? 'first')

  /* Read the GPA and how it changed out loud for a screen reader. */
  useEffect(() => {
    if (!page) return
    announce(page.gpa === null
      ? `Year ${page.year}. Nothing on the transcript yet.`
      : `Year ${page.year}. Grade point average ${page.gpa.toFixed(2)}, ${moveWords(page.move, page.priorGpa)}.`)
  }, [page?.year, page?.gpa, page?.move, page?.priorGpa])

  if (!s || !page) return null

  const years = yearbookYears(s)
  /* Only the current year can be turned, only once, and only when nothing is left to do. */
  const canTurn = page.current && !page.turned && page.ready
  const lastYear = year >= 4

  const turn = () => {
    track('year_end', {
      year, gpa: page.gpa,
      entries: s.ledger.filter((e) => e.year === year).map((e) => ({ id: e.id, grade: e.grade })),
      stickers: s.stickers.length, facts: s.facts.length, nudge: page.nudge,
    })
    /* The turn is one save, so a failure can't leave it half done. */
    turnYearPage(s, year)
    setTurned(true)
    /* After the save, the counselor drapes a cord as the last screen. */
    setDraping(true)
  }

  const move = page.move

  /* During the film, the yearbook is shown as one card instead of the full spread. */
  const inFilm = cinemaOn()

  if (draping) {
    return (
      <CordDrape
        year={year}
        /* The film doesn't go back to a yearbook it already showed. The drape is the last screen,
         * and closing it goes back to the game. */
        onDone={() => { setDraping(false); if (inFilm) onClose() }}
      />
    )
  }

  if (inFilm) {
    return <YearCard year={year} page={page} onDone={canTurn ? turn : onClose} />
  }

  return (
    <div className="yb-veil" onClick={onClose}>
      <div className="yb-page kit-surface-panel" onClick={(e) => e.stopPropagation()} {...panel}>
        {!turned ? (
          <>
            <header className="yb-head">
              <h2 className="yb-title">Yearbook</h2>
              {/* A year that's ready to close only shows its number, with no extra label. */}
              <span className="yb-year">
                Year {page.year}
                {!(page.current && !page.turned && page.ready) && (
                  <span className="yb-yearstate">
                    {page.turned ? 'closed' : page.current ? 'still open' : 'a past year'}
                  </span>
                )}
              </span>
            </header>

            <div className="yb-body">
              {/* ---- THE NUMBER COMES FIRST, BECAUSE IT'S WHAT THE STUDENT CAME TO SEE ---- */}
              <section className={`yb-number yb-move-${move}`} style={{ '--yb-step': '0ms' } as CSSProperties}>
                <span className="yb-numwrap">
                  {/* Show a sentence instead of a number when nothing has been graded. */}
                  <span className={`yb-num${shown === null ? ' yb-num-none' : ''}`}>
                    {shown === null ? 'no GPA yet' : shown.toFixed(2)}
                  </span>
                  {page.letter && <span className="yb-letter">{page.letter}</span>}
                </span>
                <span className="yb-numsaid">
                  <span className="yb-numlabel">grade point average</span>
                  <span className="yb-nummove">
                    {move !== 'first' && move !== 'held' && (
                      <Glyph
                        piece="pointer" face="chevron" size={16}
                        className={`yb-movemark yb-movemark-${move}`}
                        fallback={<span className={`yb-caret yb-caret-${move}`} aria-hidden="true" />}
                      />
                    )}
                    {moveWords(move, page.priorGpa)}
                  </span>
                  {/* This year's GPA on its own, next to the overall one. */}
                  {/* It's left out when it would be the same number twice. */}
                  <span className="yb-yearmean">
                    {page.yearGpa === null
                      ? 'nothing was graded this year'
                      : page.gpa !== null && Math.abs(page.yearGpa - page.gpa) < 0.005
                        ? ''
                        : `this year alone: ${page.yearGpa.toFixed(2)}`}
                  </span>
                </span>
              </section>

              {/* The spread: sections flow across two columns and the browser balances them. */}
              <div className="yb-spread">
                {page.sections.map((sec, i) => (
                  <Section key={sec.id} sec={sec} step={i + 1} />
                ))}
              </div>

              {/* One line about something the student didn't try. It points it out without
                * scolding, and there's only ever one. */}
              <p className="yb-nudge" style={{ '--yb-step': `${6 * STEP_MS}ms` } as CSSProperties}>
                {page.nudge}
              </p>
            </div>

            <footer className="yb-foot">
              {years.length > 1 && (
                /* The spine has one tab per year played, so a turned page can still be opened. The
                 * tabs sit on a row that scrolls instead of wrapping, and the Left and Right keys
                 * move between them. */
                <div className="yb-spine kit-tabrow" role="tablist" aria-label="Years">
                  {years.map((y, i) => (
                    <Tab
                      key={y}
                      active={y === year}
                      onClick={() => setYear(y)}
                      onKeyDown={(e) => tabRowKeyDown(e, years, i, setYear)}
                    >
                      Year {y}{yearTurned(s, y) ? ' · closed' : ''}
                    </Tab>
                  ))}
                </div>
              )}
              <div className="yb-acts">
                {canTurn ? (
                  <>
                    <Plank size="lg" glyph={['icon_set', 'arrow']} onClick={turn}>
                      {lastYear ? 'Finish all four years' : 'End this year'}
                    </Plank>
                    {/* Inside a cutscene, the option to keep playing is hidden. */}
                    {!cinemaOn() && <Plank size="md" onClick={onClose}>Keep playing this year</Plank>}
                  </>
                ) : (
                  <Plank size="lg" keyCap="Esc" onClick={onClose}>
                    {page.turned ? 'Close the yearbook' : 'Back to the game'}
                  </Plank>
                )}
              </div>
            </footer>
          </>
        ) : (
          <div className="yb-turned">
            {lastYear ? (
              <>
                <h2 className="yb-title">Four years finished.</h2>
                <p className="yb-turnedline">Your graduation is ready. Everyone is waiting for you.</p>
                <div className="yb-acts">
                  {onGraduate
                    ? <Plank size="lg" glyph={['icon_set', 'star']} onClick={onGraduate}>Walk the stage</Plank>
                    : <Plank size="lg" onClick={onClose}>Back to the game</Plank>}
                </div>
              </>
            ) : (
              /* The same card for every year except the last one. */
              <>
                <h2 className="yb-title">Year {yearWord(year)} is done.</h2>
                {/* Say what's true now instead of promising anything about next time. */}
                <p className="yb-turnedline">
                  That is year {yearWord(year)}. The Maw is yours to walk, and the Guide has every
                  club and class at Bonney Lake in it.
                </p>
                <div className="yb-acts">
                  <Plank size="lg" onClick={onClose}>That is year {yearWord(year)}</Plank>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
