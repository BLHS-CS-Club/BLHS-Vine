/* The screen where a student fills in their schedule for one year. */
import { useEffect, useState } from 'react'
import { firstLook, markLooked } from '../hud/first-look'
import { PROGRAMMES, seasonOf, type Programme } from '../roster/roster'
import { classIsReal, shownName } from '../roster/placeholders'
import { CLASSES, type ClassDef } from './catalog'
import { scheduleOwed } from './schedule'
import { SEASONS, assignSlot, clearSlot, loadSave, pickClass, dropClass, stampPlan, type Season } from '../save'
import { refuseClass, refuseSlot } from '../run/refusal'
import { yearWord } from '../run/year'
import { usePanel } from '../ui/a11y'
import { cinemaOn } from '../stage/cinema'
import { Glyph, Plank } from '../ui/controls'
import { awarded, saved as saidSaved } from '../ui/feedback'
import { track } from '../telemetry'
import './pickyear.css'

/* The five periods a freshman doesn't choose, named as plain subjects. */
const REQUIRED = ['English', 'Math', 'Science', 'PE', 'History']
/* How many rows the sheet shows: the five above plus the two the student fills in. */
const PERIODS = 7
const ELECTIVE_AT = REQUIRED.length


/** What a card can earn, in the school's own words, for the wall outline. */
function earnsOf(p: Programme): string {
  if (p.kind === 'sport') return 'JV, Varsity, Captain'
  return 'a cord, over four years'
}

export function PickYear({ year, onClose }: { year: number; onClose: () => void }) {
  /* During a cutscene this panel can't be closed: no close button, no Escape, no clicking outside. */
  const held = cinemaOn()
  const shut = held ? () => { /* The cutscene is in control, so there's no way out. */ } : onClose
  const panel = usePanel({ onClose: shut, closeOnEscape: !held, label: `Your schedule for year ${year}` })
  const [, bump] = useState(0)
  const [refused, setRefused] = useState<{ id: string; why: string } | null>(null)
  /* Which blank period's elective list is open. It's stored as the period number so the heading
   * over the list and the row it fills always match. */
  const [openAt, setOpenAt] = useState<number | null>(null)
  const redraw = () => bump((v) => v + 1)

  const s = loadSave()
  const plan = s?.plans?.[year] ?? { slots: {}, classes: [], stamped: false }

  useEffect(() => { track('pickyear_opened', { year }) }, [year])

  /* Every activity in the roster, in the roster's order. */
  const activities = PROGRAMMES

  const classes = CLASSES.filter((c) => c.years.includes(year) && !c.requires)

  /** Which season an activity is already in, if any. */
  const seatOf = (id: string): Season | null =>
    (SEASONS.find((se) => plan.slots[se] === id) ?? null)

  /* A sport goes in the season the school gives it, and a club takes the first free season. */
  const seasonFor = (p: Programme): Season | null => {
    const own = seasonOf(p)
    if (own) return own
    return SEASONS.find((se) => !plan.slots[se]) ?? null
  }

  const takeActivity = (p: Programme) => {
    const se = seasonFor(p)
    if (!se) {
      setRefused({ id: p.id, why: 'You have used all three season tokens. Put one back first.' })
      return
    }
    const no = refuseSlot(p.id, se, loadSave(), year)
    if (no) { setRefused({ id: p.id, why: no }); track('pick_refused', { what: p.id, why: no }); return }
    assignSlot(year, se, p.id)
    setRefused(null)
    saidSaved(`${p.name}, ${se}`)
    track('pick_taken', { what: p.id, season: se })
    redraw()
  }

  /* Putting something back is its own small button inside the locked card. Pressing the card again
   * doesn't undo it, so the undo never becomes the most obvious thing to press. */
  const putBack = (p: Programme, seat: Season) => {
    clearSlot(year, seat)
    setRefused(null)
    track('pick_put_back', { what: p.id, season: seat })
    redraw()
  }
  /* Same rule for a class: a ticked row is locked, with a small Put back button inside it. Pressing
   * the row again doesn't untick it. */
  const untick = (c: ClassDef) => {
    dropClass(year, c.id)
    setRefused(null)
    setOpenAt(null)
    track('pick_put_back', { what: c.id })
    redraw()
  }

  const takeClass = (c: ClassDef) => {
    const no = refuseClass(c.id, loadSave(), year)
    if (no) { setRefused({ id: c.id, why: no }); track('pick_refused', { what: c.id, why: no }); return }
    pickClass(year, c.id)
    setRefused(null)
    /* The list closes after a pick so the student sees the period they pressed fill in. Keeping it
     * open for the next blank would save one press but hide that. */
    setOpenAt(null)
    saidSaved(c.name)
    track('pick_taken', { what: c.id })
    redraw()
  }

  const chosen = SEASONS.filter((se) => plan.slots[se]).length
  const classesLeft = 2 - plan.classes.length
  /* How many classes and activities on this screen have a real island behind them. */
  const realClasses = classes.filter((c) => classIsReal(c.id))
  const realActivities = activities.filter((p) => p.playable)
  /* The rule for what this screen still needs lives in planner/schedule.ts. */
  const owed = scheduleOwed({
    electivesLeft: classesLeft,
    chosen,
    realClasses: realClasses.length,
    realActivities: realActivities.length,
    /* How many seasons this screen can really fill. One activity can't take two seasons, so asking
     * for three when fewer can be picked would make year one impossible to finish. */
    seats: realActivities.length,
  })
  const { ready, stage, notYet } = owed
  /* Read the first-look message once, and mark it seen in an effect after the panel is up. If the
   * read also marked it, the message would disappear on the second render. */
  const [told] = useState(() => firstLook('my-year'))
  useEffect(() => { markLooked('my-year') }, [])

  /* A class refusal shows under the list on its own line instead of inside a row, so the rows never
   * grow and the button never jumps. */
  const classNo = refused && classes.some((c) => c.id === refused.id) ? refused.why : null

  /* A pick already on the sheet stays there, even if the roster has changed since. */
  const taken = activities.filter((p) => seatOf(p.id))
  /* Only activities with an island behind them are offered, so no card promises a place that
   * doesn't exist. */
  const onOffer = activities.filter((p) => p.playable && !seatOf(p.id))
  /* True when the after-school cards shrink to chips so they don't compete with the class list. */
  const shelved = chosen > 0 || openAt !== null

  /* The seven period rows: five required subjects, then the two electives. The first blank elective
   * is the one the student can press. */
  const firstBlankAt = ELECTIVE_AT + plan.classes.length
  const rows = Array.from({ length: PERIODS }, (_, i) => {
    const n = i + 1
    if (i < ELECTIVE_AT) return { n, kind: 'required' as const, name: REQUIRED[i], cls: null }
    const id = plan.classes[i - ELECTIVE_AT]
    const cls = id ? CLASSES.find((c) => c.id === id) ?? null : null
    /* Numbered, so two blank lines that both say "Elective" don't look like the same line twice. */
    const blank = `Elective ${i - ELECTIVE_AT + 1}`
    return { n, kind: 'elective' as const, name: cls ? shownName(cls.id, cls.name) : blank, cls }
  })

  return (
    <div className="py-veil" onClick={shut}>
      <div {...panel} className="py-sheet kit-surface-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="py-title">Your schedule, year {yearWord(year)}</h2>
        {/* Explain what this screen is the first time it opens, right here on the sheet. */}
        {told && <p className="py-firstlook">{told}</p>}

        {/* ---- THE SEVEN PERIODS ----------------------------------------- */}
        <section className={`py-schedule${stage === 'schedule' ? ' py-lit' : ''}`} aria-labelledby="py-sched-h">
          <h3 className="py-h py-sched-h" id="py-sched-h">
            Fill your two Elective periods
            {/* How many electives are filled and how many the year needs. */}
            <span className="py-count"> {plan.classes.length} of 2 electives</span>
          </h3>
          <ol className="py-periods">
            {rows.map((r) => {
              const live = r.kind === 'elective' && !r.cls && r.n === firstBlankAt + 1
              const open = openAt === r.n
              const body = (
                <>
                  <span className="py-per-no">Period {r.n}</span>
                  <span className={`py-per-name${r.cls || r.kind === 'required' ? '' : ' py-per-blank'}`}>{r.name}</span>
                </>
              )
              return (
                <li
                  key={r.n}
                  className={`py-period py-period-${r.kind}${r.cls ? ' py-period-on' : ''}${live ? ' py-period-live' : ''}`}
                >
                  {/* Only a blank period the student can fill is a button. Every other row is just
                    * display, so a Put back button is never the most obvious thing to press. */}
                  {live && !open ? (
                    <button type="button" className="py-per-press" onClick={() => setOpenAt(r.n)}>
                      {body}
                      <span className="py-per-cue">Press to choose</span>
                    </button>
                  ) : (
                    <div className="py-per-press py-per-static">
                      {body}
                      {r.cls && (
                        <button type="button" className="py-untick" onClick={() => untick(r.cls as ClassDef)}>Put back</button>
                      )}
                    </div>
                  )}
                  {/* The elective list, drawn inside the row the pick will fill. */}
                  {open && (
                    <div className="py-electives">
                      <p className="py-elect-h">Pick an elective for Period {r.n}</p>
                      <div className="py-classes">
                        {classes.map((c) => {
                          const on = plan.classes.includes(c.id)
                          if (on) {
                            return (
                              <div key={c.id} className="py-class py-class-on" role="group" aria-label={`${c.name}, already on your schedule`}>
                                <span className="py-tick" aria-hidden="true">
                                  <Glyph piece="icon_set" face="tick" size={16} />
                                </span>
                                <span className="py-class-name">{c.name}</span>
                              </div>
                            )
                          }
                          /* Every elective the district lists can be picked. */
                          return (
                            <button key={c.id} type="button" className="py-class" onClick={() => takeClass(c)}>
                              <span className="py-tick" aria-hidden="true" />
                              <span className="py-class-name">{c.name}</span>
                            </button>
                          )
                        })}
                      </div>
                      {/* Never a dead end. When nothing can be picked, this line says what to do
                        * instead and names the button that does it. */}
                      <p className={`py-classnote${classNo ? ' py-classnote-no' : ''}`} role={classNo ? 'alert' : undefined}>
                        {/* One instruction under the list, or the refusal if there is one. */}
                        {classNo ?? 'Press one to put it in this period.'}
                      </p>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        </section>

        {/* After school is the other half of the year: the club and sport cards. */}
        <section className={`py-cardbox${stage === 'after' ? ' py-lit' : ''}`} aria-labelledby="py-cards-h">
          {/* The heading only asks for a pick when a club is really open. */}
          <h3 className="py-h py-cards-h" id="py-cards-h">
            {realActivities.length
              ? realActivities.length > 1
                ? `After school: pick ${Math.min(3, realActivities.length)}`
                : 'After school: pick one'
              : 'After school: no clubs open yet'}
            {realActivities.length > 0 && (
              <span className="py-count"> {chosen === 0 ? 'none yet' : `${chosen} taken`}</span>
            )}
          </h3>
          <div className="py-grid">
            {/* A taken card is locked. It's no longer a button, just a stamped sign with the season
              * on it and one small Put back button. */}
            {taken.map((p) => {
              const seat = seatOf(p.id) as Season
              return (
                <div
                  key={p.id}
                  className="py-card kit-surface-tab py-card-on"
                  role="group"
                  aria-label={`${p.name}, ${seat}. Yours.`}
                >
                  <span className="py-card-name">{p.name}</span>
                  <span className="py-card-where">{seat}. Yours.</span>
                  <span className="py-card-earns">{earnsOf(p)}</span>
                  <Glyph piece="stamp" face="approved" size={26} className="py-stamp" />
                  <button type="button" className="py-putback" onClick={() => putBack(p, seat)}>Put back</button>
                </div>
              )
            })}
            {/* Cards not taken yet are big while nothing is chosen, then shrink to small chips next
              * to the locked card. They can still be picked, but they never stand out more than the
              * main button. */}
            {onOffer.map((p) => {
              const no = refused?.id === p.id ? refused.why : null
              if (shelved) {
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="py-chip"
                    onClick={() => takeActivity(p)}
                    title={`${p.name}, ${seasonOf(p) ?? 'any season'}`}
                  >
                    <span className="py-chip-name">{p.name}</span>
                    {no && <span className="py-chip-no" role="alert">{no}</span>}
                  </button>
                )
              }
              return (
                <button
                  key={p.id}
                  type="button"
                  className="py-card kit-surface-tab"
                  onClick={() => takeActivity(p)}
                >
                  <span className="py-card-name">{p.name}</span>
                  <span className="py-card-where">{seasonOf(p) ?? 'any season'}</span>
                  <span className="py-card-earns">{earnsOf(p)}</span>
                  {no && <span className="py-no">{no}</span>}
                </button>
              )
            })}
          </div>
        </section>

        <div className="py-foot">
          {/* The close button is small on purpose. A bigger one would stand out more than the
            * button that finishes the schedule. */}
          {!held && <Plank size="sm" keyCap="Esc" className="py-close" onClick={onClose}>Close for now</Plank>}
          {notYet && <span className="py-notyet">{notYet}</span>}
          <Plank
            size="lg"
            className={`py-go${ready ? ' py-lit' : ''}`}
            disabled={!ready}
            onClick={() => {
              const taken = SEASONS.map((se) => plan.slots[se]).filter((x): x is string => !!x)
              stampPlan(year, taken)
              track('pickyear_stamped', { year, slots: plan.slots, classes: plan.classes })
              /* The stamp pops up, so setting a schedule feels like a moment instead of the panel
               * just closing. */
              /* The pop never shows a made-up name. With nothing picked `first` is undefined and it
               * shows the plain line, and a member's island shows its own name. */
              const first = PROGRAMMES.find((pg) => pg.id === taken[0])
              awarded(
                first ? `${shownName(first.id, first.name)} is yours.` : 'Your schedule is set.',
                `Year ${year} is on your schedule.`,
              )
              onClose()
            }}
          >
            That is my schedule
          </Plank>
        </div>
      </div>
    </div>
  )
}
