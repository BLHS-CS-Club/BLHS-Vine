/* The end of the year shown as one card: what the student picked and what they earned. */
import { useEffect } from 'react'
import { Glyph, Plank } from '../ui/controls'
import { usePanel } from '../ui/a11y'
import { classById } from '../planner/catalog'
import { programmeById } from '../roster/roster'
import { shownName } from '../roster/placeholders'
import { SEASONS, loadSave } from '../save'
import { track } from '../telemetry'
import type { YearbookPage } from './yearbook-page'
import './run.css'
import { yearWord } from './year'
import './yearcard.css'

/* The year word always comes from `run/year.ts`. Don't keep a separate copy of that table here, or
 * the card's heading and its button can end up naming different years. */

type CardRow = { key: string; title: string; meta?: string; done?: boolean }

/* ---- WHAT THE STUDENT PICKED, READ FROM THEIR YEAR SHEET --------------- */
function pickedRows(year: number): CardRow[] {
  const s = loadSave()
  const plan = s?.plans?.[year]
  const rows: CardRow[] = []
  for (const id of plan?.classes ?? []) {
    const c = classById(id)
    rows.push({ key: `class:${id}`, title: shownName(id, c?.name ?? id), meta: 'elective' })
  }
  for (const se of SEASONS) {
    const id = plan?.slots?.[se]
    if (!id) continue
    const p = programmeById(id)
    rows.push({ key: `slot:${se}`, title: shownName(id, p?.name ?? id), meta: se.toLowerCase() })
  }
  return rows
}

/* What the student earned, taken from the yearbook page: grades, badges and finished cords. */
/* One row per thing. Three yearbook sections go under one "What you earned" heading, so a class
 * could show up as a grade and again as the badge that grade earned. A badge for something already
 * listed is dropped, and a badge with no grade behind it stays. */
function earnedRows(page: YearbookPage): CardRow[] {
  const of = (id: string) => page.sections.find((sec) => sec.id === id)?.rows ?? []
  const said = new Set<string>()
  const once = (title: string) => {
    const k = title.trim().toLowerCase()
    if (said.has(k)) return false
    said.add(k)
    return true
  }
  return [
    ...of('paper').filter((r) => once(r.title))
      .map((r) => ({ key: `p:${r.key}`, title: r.title, meta: r.meta, done: true })),
    ...of('marks').filter((r) => once(r.title))
      .map((r) => ({ key: `m:${r.key}`, title: r.title, meta: r.meta, done: true })),
    ...of('threads').filter((r) => r.done && once(r.title))
      .map((r) => ({ key: `t:${r.key}`, title: r.title, done: true })),
  ]
}

function List({ head, rows, empty }: { head: string; rows: CardRow[]; empty: string }) {
  return (
    <section className="yc-col">
      <h3 className="yc-head">{head}</h3>
      {rows.length === 0
        ? <p className="yc-empty">{empty}</p>
        : (
          <ul className="yc-rows">
            {rows.map((r) => (
              <li key={r.key} className="yc-row">
                {r.done && <Glyph piece="icon_set" face="tick" size={16} className="yc-tick" />}
                <span className="yc-rowtitle">{r.title}</span>
                {r.meta && <span className="yc-rowmeta">{r.meta}</span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

export function YearCard({ year, page, onDone }: {
  year: number
  page: YearbookPage
  /** The one button: turn the page if the year can be turned, or close the card if not. */
  onDone: () => void
}) {
  /* Escape and clicking outside do nothing. This card only shows during the film, and nothing in
   * the film can be skipped, so the button is the only control. */
  const panel = usePanel({ onClose: () => {}, closeOnEscape: false, label: `Year ${year}` })
  useEffect(() => { track('yearcard_shown', { year }) }, [year])

  const picked = pickedRows(year)
  const earned = earnedRows(page)

  return (
    <div className="yb-veil yc-veil">
      <div {...panel} className="yc-card kit-surface-panel">
        <header className="yc-top">
          {/* Only the year, with no "still open" or "closed" label. That label would contradict the
            * counselor, who is saying right then that the year is done. */}
          <h2 className="yc-title">Year {yearWord(year)}</h2>
        </header>
        <div className="yc-body">
          <List head="What you picked" rows={picked} empty="Nothing on the sheet this year." />
          <List head="What you earned" rows={earned} empty="Nothing graded this year." />
        </div>
        <footer className="yc-foot">
          {/* The card's one button. Its words move the player forward, not back. */}
          <Plank size="lg" className="yc-go" onClick={onDone}>That is year {yearWord(year)}</Plank>
        </footer>
      </div>
    </div>
  )
}
