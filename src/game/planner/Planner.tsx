/* The year sheet: three season tokens, three seasons, a class list, and the stamp that locks it all
 * in. */
import { useEffect, useRef, useState } from 'react'
import {
  classById, classOffer, cordHint, DEPT_LABEL, DEPTS, LADDER_NOTE,
  type ClassDef, type Dept,
} from './catalog'
/* The roster decides what a season token can be spent on. A slot holds a programme id, and the
 * roster says which programmes exist. */
import { PROGRAMMES, programmeById, seasonOf } from '../roster/roster'
import {
  assignSlot, clearSlot, dropClass, loadSave, pickClass, SEASONS, stampPlan, subscribeSave,
  type SaveGame, type Season, type YearPlan,
} from '../save'
import { cordsOf, letterOf, rankName } from '../progress'
import { coreBeatId } from '../beats/beats'
import { beatState } from '../beats/state'
import { classLedgerId } from '../beats/classes'
import { firstLook, markLooked } from '../hud/first-look'
import { SHEET_STEPS, Tour } from '../hud/Tour'
import { yearStatus } from '../run/year'
import { picksOf, pickVerb, pickVerbHere, type Pick } from '../run/pick'
import { nextObjective } from '../run/objective'
import { refuseClass, refuseSlot } from '../run/refusal'
import { yearbookYears, yearTurned } from '../run/yearbook-page'
import { track } from '../telemetry'
import { announce, focusablesIn, usePanel } from '../ui/a11y'
import { Empty, Glyph, Plank, Socket } from '../ui/controls'
import { saved } from '../ui/feedback'
import './planner.css'

// A plank is a button a student presses to do something. A row on the paper is never a plank.

const CORE_BEAT_DESC: Record<number, string> = {
  1: 'You learn the POWER values, the bell schedule, and how to join a club',
  2: 'You learn every cord and seal, and the Universal Retake Policy',
  3: 'You learn the 24 credits, dual credit, and the exact rule for AP Capstone',
  4: 'You check your cords and find out what you need to walk the stage',
}

/* The open-season message lives in one place so two copies can't drift apart. */
/* All three season tokens have to be spent before stamping. */
const OPEN_SEASONS = (left: number): string =>
  left > 1 ? `Not yet: fill all ${SEASONS.length} seasons. ${left} still empty.`
    : 'Not yet: one season is still empty.'

/* How far the pointer has to move before a press counts as a drag. It's small enough that a real
 * drag never feels sticky, and big enough that a trackpad tap that drifts a millimeter still opens
 * the column. */
const DRAG_SLOP = 6

/* Picking the same club again has to be allowed. Rank counts the years spent on a track (JV at one,
 * Varsity at two, Captain at three), so blocking repeats would make Captain impossible. This line
 * tells the player how many years they already have. */
function againLine(a: { id: string; rankTrack?: string }, s: SaveGame | null): string | null {
  if (!s) return null
  const track = a.rankTrack ?? a.id
  const years = new Set((s.completions ?? []).filter((c) => (c.rank ?? '') === track).map((c) => c.year))
  if (!years.size) return null
  /* Compare against the rank already held, not only whether a next name exists. `rankName` returns
   * Captain for both three and four years, so without this check a Captain would be told one more
   * year makes them Captain. */
  const now = rankName(years.size)
  const next = rankName(years.size + 1)
  return next && next !== now
    ? `${years.size} year${years.size > 1 ? 's' : ''} in. One more makes you ${next}.`
    : `${years.size} years in, and already ${now ?? 'counted'}.`
}

/** A season token being dragged, between the rail and wherever it lands. */
type Airborne = {
  season: Season
  /** Where the coin is drawn, in the veil's coordinates. */
  x: number
  y: number
  /** The column under the pointer right now, for the socket's `over` state. */
  over: Season | null
  /** The activity row under the pointer, when a column's list is open. */
  act: string | null
  /**
   * True once the pointer has moved past DRAG_SLOP, so this is a drag and the pointerup isn't a
   * click.
   */
  moved: boolean
}

/** What was refused, and where the message has to show up. */
type Refusal = { where: Season | 'classes'; why: string }

export function Planner({ onClose, onAdvisory, onPlayPick, onLook, onYearbook }: {
  onClose: () => void
  /* review shows the answers, which is a different button from taking the quiz. */
  onAdvisory?: (review?: boolean) => void
  /* One button per pick. The sheet only says what the pick is. What pressing it does, a voyage or a
   * card, is up to the roster and the HUD. */
  onPlayPick?: (pick: Pick) => void
  /* The two panels about the player instead of the school. They open from buttons in the sheet's
   * footer. */
  onLook?: (what: 'wall' | 'wardrobe') => void
  onYearbook?: () => void
}) {
  const [, bump] = useState(0)
  useEffect(() => subscribeSave(() => bump((v) => v + 1)), [])
  const s = loadSave()
  const year = s?.year ?? 1
  const plan: YearPlan = s?.plans[year] ?? { slots: {}, classes: [], stamped: false }
  /* Every pick goes in one list with one verb, so class rows and club cards always behave the same.
   * `run/pick.ts` explains why they're one thing. */
  const picks = picksOf(s, year)

  const openedAt = useRef(Date.now())
  const changes = useRef(0)
  const [placing, setPlacing] = useState<Season | null>(null)
  const [pickingClass, setPickingClass] = useState(false)
  const [confirming, setConfirming] = useState(false)
  /* The refusal the student is looking at, and where it belongs on the sheet. */
  const [refused, setRefused] = useState<Refusal | null>(null)
  const [air, setAir] = useState<Airborne | null>(null)

  const veilRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  /* A ref copy of the dragged token, for pointer handlers that were made on an older render. The
   * state draws the picture, and this ref is what the handlers check. */
  const airRef = useRef<Airborne | null>(null)
  const grabAt = useRef<{ x: number; y: number } | null>(null)
  /* Eats the click the browser sends right after a drag ends. */
  const swallowClick = useRef(false)

  useEffect(() => { track('planner_opened', { year }) }, [year])

  /* Controls are found by id. That's safe because only one year sheet is ever on screen. */
  const backTo = (el: HTMLElement | null | undefined) => el?.focus?.()
  const byId = (id: string) => document.getElementById(id)
  const socketOf = (season: Season) => byId(`pl-sock-${season}`)
  /* Wait until after the render, because the control being focused only comes back once the
   * sub-state closes. */
  const focusAfter = (id: string) => { window.setTimeout(() => backTo(byId(id)), 0) }

  const cancelDrag = () => {
    if (!airRef.current) return
    const season = airRef.current.season
    airRef.current = null
    grabAt.current = null
    setAir(null)
    announce(`Nothing placed. ${season} is still open.`)
  }

  const shutColumn = () => {
    const was = placing
    setPlacing(null)
    setRefused(null)
    if (was) backTo(socketOf(was))
  }

  /* Escape closes the innermost thing first: the coin, the confirm, the picker, a column, then the
   * sheet. */
  const escape = () => {
    if (airRef.current) { cancelDrag(); return }
    if (confirming) { setConfirming(false); focusAfter('pl-stamp'); return }
    if (pickingClass) { setPickingClass(false); setRefused(null); focusAfter('pl-pick'); return }
    if (placing) { shutColumn(); return }
    onClose()
  }

  const panel = usePanel({ label: 'The year sheet', onClose: escape })

  /* Move focus when the view swaps. Pressing a season replaces the focused button with a list of
   * buttons. Without this, focus drops to `<body>` and the next Tab starts from the top of the
   * page. */
  useEffect(() => {
    if (!placing || !listRef.current) return
    focusablesIn(listRef.current)[0]?.focus()
  }, [placing])
  useEffect(() => {
    if (!pickingClass || !pickerRef.current) return
    focusablesIn(pickerRef.current)[0]?.focus()
  }, [pickingClass])

  if (!s) return null

  const pickedByYear: Record<number, string[]> = {}
  for (const [y, p] of Object.entries(s.plans)) pickedByYear[Number(y)] = p.classes

  const refuse = (where: Season | 'classes', why: string) => {
    setRefused({ where, why })
    announce(why)
  }

  /* Click, drop and keyboard all go through this one function. A refused choice still comes through
   * here, so it gets a message instead of being quietly filtered out. */
  const place = (season: Season, activityId: string) => {
    const why = refuseSlot(activityId, season, s, year)
    if (why) { refuse(season, why); track('slot_refused', { year, season, activity: activityId, why }); return }
    changes.current++
    setRefused(null)
    assignSlot(year, season, activityId)
    track('slot_assigned', {
      year, season, activity: activityId,
      deliberationMs: Date.now() - openedAt.current, changes: changes.current,
    })
    setPlacing(null)
    announce(`You joined ${programmeById(activityId)?.name ?? activityId} for ${season}.`)
    focusAfter(`pl-sock-${season}`)
  }

  const lift = (season: Season) => {
    changes.current++
    clearSlot(year, season)
    /* Removing a pick is logged too, because changing your mind is part of deciding. */
    track('slot_lifted', { year, season, deliberationMs: Date.now() - openedAt.current, changes: changes.current })
    announce(`${season} is empty again. You can pick something else.`)
  }

  const addClass = (id: string) => {
    /* The two-class limit is part of the game, so it's said out loud instead of the button quietly
     * disappearing. It uses the same check `pickClass` enforces in the save. */
    const why = refuseClass(id, s, year)
    if (why) { refuse('classes', why); track('class_refused', { year, class: id, why }); return }
    setRefused(null)
    pickClass(year, id)
    track('class_picked', { year, class: id })
    setPickingClass(false)
    announce(`${classById(id)?.name ?? id} added to your classes.`)
    focusAfter('pl-pick')
  }

  const stamp = () => {
    /* The slot's value is already the programme id, so nothing gets converted on the way to the
     * save. */
    const committed = SEASONS.map((se) => plan.slots[se]).filter(Boolean) as string[]
    stampPlan(year, committed)
    track('planner_stamped', { year, slots: plan.slots, classes: plan.classes })
    setConfirming(false)
    /* The wax seal is drawn art, and the kit's saved() shows it off the sheet too. */
    saved(`Year ${year} is stamped and saved.`)
  }

  // ---- the drag, using pointer capture so mouse, trackpad and finger all work the same way

  const localPoint = (e: React.PointerEvent) => {
    const box = veilRef.current?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }

  const grab = (season: Season) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (plan.stamped || e.button > 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    grabAt.current = { x: e.clientX, y: e.clientY }
    const next: Airborne = { season, ...localPoint(e), over: null, act: null, moved: false }
    airRef.current = next
    setAir(next)
  }

  const carry = (e: React.PointerEvent<HTMLButtonElement>) => {
    const held = airRef.current
    const from = grabAt.current
    if (!held || !from) return
    const far = Math.hypot(e.clientX - from.x, e.clientY - from.y) > DRAG_SLOP
    if (!held.moved && !far) return
    /* Find the topmost element under the pointer, then the nearest drop target around it. The
     * dragged coin has `pointer-events: none` so it never hides what's under it. */
    const under = document.elementFromPoint(e.clientX, e.clientY)
    const target = under?.closest<HTMLElement>('[data-drop-season]') ?? null
    const next: Airborne = {
      ...held,
      ...localPoint(e),
      over: (target?.dataset.dropSeason as Season | undefined) ?? null,
      act: target?.dataset.dropAct ?? null,
      moved: true,
    }
    airRef.current = next
    setAir(next)
  }

  const letGo = (e: React.PointerEvent<HTMLButtonElement>): Airborne | null => {
    const held = airRef.current
    airRef.current = null
    grabAt.current = null
    setAir(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    return held
  }

  const release = (e: React.PointerEvent<HTMLButtonElement>) => {
    const held = letGo(e)
    if (!held) return
    if (!held.moved) return   // A press, not a drag. The click handler takes it.
    swallowClick.current = true
    land(held)
  }

  /* A cancelled pointer isn't a drop. The browser cancels the pointer when a touch turns into a
   * scroll, and treating that as a drop would spend a token on whatever was under the coin. */
  const abort = (e: React.PointerEvent<HTMLButtonElement>) => {
    const held = letGo(e)
    if (held?.moved) announce(`Nothing placed. ${held.season} is still open.`)
  }

  /* Where a dropped token goes. Every outcome announces a sentence, because a token that silently
   * snaps back teaches the player nothing. */
  const land = (held: Airborne) => {
    if (!held.over) { announce(`Nothing placed. ${held.season} is still open.`); return }
    if (held.over !== held.season) {
      /* There's no spare token. Each token belongs to its own season, and this message says so. */
      refuse(held.over, `That is your ${held.season.toLowerCase()} token. Drop it on ${held.season}.`)
      track('slot_refused', { year, season: held.over, activity: null, why: 'wrong season token' })
      return
    }
    if (held.act) { place(held.season, held.act); return }
    setRefused(null)
    setPlacing(held.season)
    announce(`Now pick your ${held.season.toLowerCase()} activity.`)
  }

  const pressToken = (season: Season) => {
    /* The press-to-place path. It does exactly what a drop on the same socket does, because the
     * keyboard has to be able to do everything the drag can. Press the coin, the column opens, and
     * the list takes focus. */
    if (swallowClick.current) { swallowClick.current = false; return }
    if (plan.stamped) return
    setRefused(null)
    setPlacing(season)
  }

  // ---- what the sheet knows -------------------------------------------------

  /* The counselor's margin notes. Each one prints the school's own rule with this game's count
   * under it. */
  const notes = cordsOf(s)
    .filter((c) => !c.earned)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 3)

  /* The margin looks at the sheet too, not only the ledger. Its job is to comment on the plan the
   * student is making right now, and nothing else in the game can see that. */
  const picked = plan.classes.map((id) => classById(id)).filter((c): c is ClassDef => !!c)
  const marginOnPlan = plan.stamped ? null
    : plan.classes.length < 2
      ? `${2 - plan.classes.length} focus ${plan.classes.length === 1 ? 'class' : 'classes'} still to choose.`
      : picked.every((c) => !cordHint(c.tags))
        ? 'Neither class counts toward a graduation cord. That is allowed. Take what you like.'
        : null

  /** The years whose page has turned. These are the past yearbooks the sheet can open. */
  const pastPages = yearbookYears(s).filter((y) => yearTurned(s, y))

  /* Whether there's any club or sport to pick at all, checked once for the whole sheet. */
  const offersActivities = PROGRAMMES.some((p) => p.playable)
  /* Read the first-look message once, and mark it seen in an effect after the panel is up. If the
   * read also marked it, the message would disappear on the second render. */
  const [told] = useState(() => firstLook('my-year'))
  useEffect(() => { markLooked('my-year') }, [])

  /* The sheet runs its tutorial once, starting in year two. In year one the principal is there to
   * explain it, and in year two nobody is. It's a first-look flag, so it runs once per run, and it
   * skips a stamped sheet because there's no pick a class button to point at. */
  const [teaching, setTeaching] = useState(false)
  useEffect(() => {
    if (year <= 1 || plan.stamped) return
    if (!firstLook('sheet')) return
    markLooked('sheet')
    setTeaching(true)
  }, [year, plan.stamped])
  const slotsFilled = SEASONS.filter((se) => plan.slots[se]).length
  /* One activity can't take two seasons, so the sheet asks for as many seasons as there are
   * playable islands, and never more than the year has. */
  const seats = Math.max(1, Math.min(SEASONS.length, PROGRAMMES.filter((p) => p.playable).length))
  /* Full means two classes and every seat filled, not two classes alone. `offersActivities` is the
   * same check the season columns use before they draw, so once a club ships the stamp waits for it
   * without this line changing. */
  const canStamp = !plan.stamped
    && plan.classes.length === 2
    && (!offersActivities || slotsFilled >= seats)
  const stampNote = plan.stamped ? null
    : plan.classes.length < 2 ? 'Pick two classes.'
      /* Only show this when there are season columns. With nothing playable on the roster there are
       * none, so a message about an empty season would make no sense. */
      : offersActivities && slotsFilled < seats ? OPEN_SEASONS(seats - slotsFilled)
        : null

  const objective = plan.stamped ? nextObjective(s) : null
  const classRefusal = refused?.where === 'classes' ? refused.why : null

  return (
    <div className="pl-veil" ref={veilRef} onClick={() => { if (!swallowClick.current) onClose(); swallowClick.current = false }}>
      <div
        className={`pl-sheet kit-surface-panel${air?.moved ? ' pl-dragging' : ''}`}
        onClick={(e) => { e.stopPropagation(); swallowClick.current = false }}
        {...panel}
      >
        {/* The close button is at the bottom, so it isn't the first thing keyboard focus lands on. */}
        <div className="pl-head">
          <h2 className="pl-title">Year sheet</h2>
          {told && <p className="pl-firstlook">{told}</p>}
          <span className="pl-year">Year {year} of 4</span>
        </div>

        {/* The advisory pin: the one thing on the sheet the student didn't choose. */}
        <div className="pl-pin">
          <Glyph piece="pointer" face="pin_tail" size={20} className="pl-pin-head" />
          <span className="pl-pin-words">
            <b>Advisory, every year.</b>{' '}{CORE_BEAT_DESC[year] ?? CORE_BEAT_DESC[1]}
          </span>
          {/* Three states: passed, failed and not tried. A failed beat must never show the tick. A
            * pass offers to show the answers, and only a beat that isn't passed offers a retake. */}
          {(() => {
            const st = beatState(s, coreBeatId(year))
            if (st === 'passed') {
              return (
                <span className="pl-pin-done">
                  <Glyph piece="icon_set" face="tick" size={15} />
                  passed
                  {onAdvisory && (
                    <Plank size="sm" onClick={() => onAdvisory(true)}>see your answers</Plank>
                  )}
                </span>
              )
            }
            if (!onAdvisory) return null
            return (
              <Plank size="sm" onClick={() => onAdvisory()}>
                {st === 'failed' ? 'take Advisory again' : 'go to Advisory'}
              </Plank>
            )
          })()}
        </div>

        <div className="pl-body">
          {/* The season columns stay off the sheet until an activity with a season is playable. */}
          {!offersActivities ? (
            <section className="pl-col pl-col-none">
              <h3 className="pl-colhead">After school</h3>
              <p className="pl-empty">Nobody has built a club or sport island yet.</p>
              <p className="pl-note">Your two Elective periods are the whole of this year's picks.</p>
              {/* ---- A CLUB ALREADY ON THE SHEET STILL HAS ITS BUTTON --------
                *
                * Nothing on the roster is playable today, so the seasons come off
                * the sheet and a student cannot pick a club at all. A SAVE can
                * still hold one: an older run, a member's island that shipped and
                * was then turned off, a teacher's seeded device. Without this the
                * pick would sit on the year gate with no control anywhere that
                * finishes it, which is the exact shape item 4 exists to kill. */}
              {picks.filter((p) => p.kind === 'activity').map((p) => (
                <div className="pl-class" key={p.id}>
                  <span className="pl-class-name">{p.name}</span>
                  {p.done
                    ? <span className="pl-class-grade">done</span>
                    : onPlayPick && (
                      <Plank size="sm" onClick={() => onPlayPick(p)}>{pickVerb(p)}</Plank>
                    )}
                </div>
              ))}
            </section>
          ) : (
          <div className="pl-cols" role="group" aria-label="The three seasons">
            {SEASONS.map((season) => {
              const committed = plan.slots[season] ? programmeById(plan.slots[season]!) : null
              /* only a programme with an island behind it is on the menu, and the refused rows carry their reason */
              const menu = PROGRAMMES.filter((a) => a.playable).map((a) => ({ a, why: refuseSlot(a.id, season, s, year) }))
              const wrongToken = !!air?.moved && air.over === season && air.season !== season
              const shownRefusal = wrongToken
                ? `That is your ${air.season.toLowerCase()} token. Drop it on ${air.season}.`
                : refused?.where === season ? refused.why : null
              return (
                <section className="pl-col" key={season}>
                  <h3 className="pl-col-head">
                    <Glyph piece="pip" face={season.toLowerCase()} size={18} className="pl-col-pip" />
                    {season}
                  </h3>

                  {committed ? (
                    /* a filled slot is not a button, because it holds the lift control inside it */
                    <div className="pl-filled kit-surface-socket" data-state="filled">
                      <div className="pl-card-name">{committed.name}</div>
                      <div className="pl-card-blurb">{committed.blurb}</div>
                      {committed.host && <div className="pl-card-host">with {committed.host}</div>}
                      <div className="pl-card-token">
                        <Glyph
                          piece="pip"
                          face={season.toLowerCase()}
                          size={22}
                          fallback={<span className="pl-coin pl-coin-spent" aria-hidden="true" />}
                        />
                        <span>this is your {season.toLowerCase()} activity</span>
                      </div>
                      {!plan.stamped && (
                        <Plank size="sm" wide onClick={() => lift(season)}>remove this activity</Plank>
                      )}
                      {/* AND A CLUB GETS THE SAME ONE BUTTON A CLASS GETS. It never
                          had one: a season slot was a thing you chose and then
                          could not do anything with until an island existed, which
                          is three of a student's four picks sitting inert on the
                          sheet that is supposed to be his to-do list. */}
                      {plan.stamped && (() => {
                        const pick = picks.find((q) => q.kind === 'activity' && q.id === committed.id)
                        if (!pick) return null
                        return pick.done
                          ? <div className="pl-card-done">done</div>
                          : onPlayPick && (
                            <Plank size="sm" wide onClick={() => onPlayPick(pick)}>{pickVerbHere(pick)}</Plank>
                          )
                      })()}
                    </div>
                  ) : plan.stamped ? (
                    <div className="pl-open">left open this year</div>
                  ) : (
                    <Socket
                      id={`pl-sock-${season}`}
                      data-drop-season={season}
                      caption={s.tokens.includes(season)
                        ? `pick your ${season.toLowerCase()} activity`
                        : `you already used your ${season.toLowerCase()} pick`}
                      over={!!air?.moved && air.over === season && air.season === season}
                      refusing={shownRefusal}
                      aria-expanded={placing === season}
                      aria-controls={`pl-list-${season}`}
                      onClick={() => { setRefused(null); setPlacing(season) }}
                    >
                      {/* An empty socket shows its own season's mark, dimmed, so the player knows
                        * which season it is. */}
                      <span className="pl-sock-well">
                        <Glyph
                          piece="pip"
                          face="ghost"
                          size={38}
                          className="pl-sock-ring"
                          fallback={<span className="pl-coin pl-coin-ghost" aria-hidden="true" />}
                        />
                        <Glyph
                          piece="pip"
                          face={season.toLowerCase()}
                          size={24}
                          className="pl-sock-want"
                        />
                      </span>
                    </Socket>
                  )}

                  {placing === season && !plan.stamped && (
                    <div className="pl-menu" id={`pl-list-${season}`} ref={listRef}>
                      {menu.length === 0 && (
                        <Empty
                          what="No activities open yet"
                          fills="Clubs and sports show up here when they open."
                        />
                      )}
                      {menu.map(({ a, why }) => (
                        <button
                          type="button"
                          className={`pl-act${why ? ' pl-act-shut' : ''}`}
                          key={a.id}
                          data-drop-season={season}
                          data-drop-act={a.id}
                          /* Never `disabled`, so a refused row can still get focus and say why. */
                          aria-disabled={!!why}
                          onClick={() => place(season, a.id)}
                        >
                          <span className="pl-act-name">{a.name}</span>
                          <span className="pl-act-why">
                            {/* The drawn lock goes before the sentence, never in place of it. */}
                            {why && <Glyph piece="icon_set" face="lock" size={13} className="pl-act-lock" />}
                            {/* A sport's season comes from the school's table, looked up by id. */}
                            {why ?? againLine(a, s) ?? (a.kind === 'sport'
                              ? `a ${String(seasonOf(a)).toLowerCase()} sport`
                              : 'a club, any season')}
                          </span>
                        </button>
                      ))}
                      <Plank size="sm" wide onClick={shutColumn}>cancel</Plank>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
          )}

          <div className="pl-rail">
            {offersActivities && (
            <section>
              <h3 className="pl-sect">Your season tokens</h3>
              {/* Three tokens for the three columns, each coin drawn and labeled. */}
              <div className="pl-tokens">
                {s.tokens.map((t, i) => (
                  <button
                    type="button"
                    key={t + i}
                    className={`pl-token${air?.season === t && air.moved ? ' pl-token-aloft' : ''}${placing === t ? ' pl-token-lifted' : ''}`}
                    aria-label={`Your ${t.toLowerCase()} season token. Press it to pick your ${t.toLowerCase()} activity.`}
                    disabled={plan.stamped}
                    onPointerDown={grab(t)}
                    onPointerMove={carry}
                    onPointerUp={release}
                    onPointerCancel={abort}
                    onClick={() => pressToken(t)}
                  >
                    <Glyph
                      piece="pip"
                      face={t.toLowerCase()}
                      size={26}
                      fallback={<span className="pl-coin" aria-hidden="true" />}
                    />
                    <span className="pl-token-name">{t}</span>
                  </button>
                ))}
                {s.tokens.length === 0 && <span className="pl-token-hint">You have used all three season tokens.</span>}
              </div>
              {s.tokens.length > 0 && (
                <p className="pl-token-note">
                  {plan.stamped
                    /* Unspent tokens are lost when the year ends, and the sheet says so. */
                    ? 'Your year sheet is stamped. Leftover season tokens are gone when the year ends.'
                    : 'Drag a season token onto a season, or press the token.'}
                </p>
              )}
            </section>
            )}

            <section>
              <h3 className="pl-sect">Focus classes, pick 2</h3>
              {plan.classes.map((id) => {
                const c = classById(id)
                if (!c) return null
                const hint = cordHint(c.tags)
                const st = beatState(s, classLedgerId(id))
                const grade = s.ledger.find((e) => e.id === classLedgerId(id))?.grade
                const pick = picks.find((q) => q.kind === 'class' && q.id === id)
                return (
                  <div className="pl-class" key={id}>
                    <span className="pl-class-name">{c.name}</span>
                    {hint && <span className="pl-class-hint">{hint}</span>}
                    {!plan.stamped && (
                      <Plank
                        size="sm"
                        className="pl-class-x"
                        glyph={['icon_set', 'cross']}
                        aria-label={`remove ${c.name}`}
                        onClick={() => { dropClass(year, id); announce(`${c.name} removed from your classes.`) }}
                      >
                        remove
                      </Plank>
                    )}
                    {/* The grade always shows, and a failed class keeps its button. A row reading F
                      * with no way back in would be a dead end. */}
                    {plan.stamped && st !== 'untried' && grade !== undefined && (
                      <span className="pl-class-grade">{letterOf(grade)}</span>
                    )}
                    {plan.stamped && st !== 'passed' && onPlayPick && pick && (
                      /* One button for both cases, and the roster decides which. No course has an
                       * island yet, so it reads Go and counts the pick. Once one does, the same
                       * button starts a voyage and only the word changes. */
                      <Plank size="sm" onClick={() => onPlayPick(pick)}>
                        {st === 'failed' ? 'try it again' : pickVerb(pick)}
                      </Plank>
                    )}
                  </div>
                )
              })}

              {!plan.stamped && plan.classes.length < 2 && !pickingClass && (
                <Plank size="sm" wide id="pl-pick" data-tour="pick-class" onClick={() => setPickingClass(true)}>pick a class</Plank>
              )}

              {pickingClass && (
                <div className="pl-classmenu" ref={pickerRef}>
                  {/* The prerequisite order is the game's rule, so it's stated once above the list. */}
                  <p className="pl-ladder-note">{LADDER_NOTE}</p>
                  {DEPTS.map((dept: Dept) => {
                    const list = classOffer(year, pickedByYear).filter((o) => o.c.dept === dept)
                    if (!list.length) return null
                    return (
                      <div key={dept}>
                        <h4 className="pl-dept">{DEPT_LABEL[dept]}</h4>
                        {list.map(({ c, why, ladder }) => {
                          const hint = cordHint(c.tags)
                          return (
                            <button
                              type="button"
                              className={`pl-act${why ? ' pl-act-shut' : ''}${ladder ? ' pl-act-rung' : ''}`}
                              key={c.id}
                              aria-disabled={!!why}
                              onClick={() => (why ? refuse('classes', `${c.name}: ${why}.`) : addClass(c.id))}
                            >
                              <span className="pl-act-name">{c.name}</span>
                              <span className="pl-act-why">
                                {why && <Glyph piece="icon_set" face="lock" size={13} className="pl-act-lock" />}
                                {why ?? hint ?? 'does not count toward a cord'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                  {classRefusal && <p className="pl-refusal">{classRefusal}</p>}
                  <Plank
                    size="sm"
                    wide
                    onClick={() => { setRefused(null); setPickingClass(false); focusAfter('pl-pick') }}
                  >
                    cancel
                  </Plank>
                </div>
              )}
              {!pickingClass && classRefusal && <p className="pl-refusal">{classRefusal}</p>}
            </section>

            {(notes.length > 0 || marginOnPlan) && (
              <section>
                <h3 className="pl-sect">Cords you are working toward</h3>
                {marginOnPlan && <p className="pl-note-plan">{marginOnPlan}</p>}
<ul className="pl-notes">
                  {notes.map((c) => (
                    <li key={c.id}>
                      <span className="pl-note-name">{c.name}</span>
                      {/* Always the school's own sentence, with this game's count under it. */}
                      <span className="pl-note-rule">{c.rule}</span>
                      {c.progress > 0 && <span className="pl-note-count">{c.detail}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* The yearbook opens on the current year, and its spine leads back to past ones. */}
            {onYearbook && pastPages.length > 0 && (
              <section>
                <h3 className="pl-sect">Past yearbooks</h3>
                <Plank size="sm" wide onClick={onYearbook}>
                  open a past yearbook ({pastPages.map((y) => `year ${y}`).join(', ')})
                </Plank>
              </section>
            )}
          </div>
        </div>

        {/* The trophy wall and wardrobe buttons live here. In the corner they'd turn it into a long
          * list of buttons, and they don't belong in the Guide, which is about the school. These
          * two are about the player. */}
        {onLook && (
          <div className="pl-mine">
            <Plank size="sm" onClick={() => onLook('wall')}>Your trophy wall</Plank>
            <Plank size="sm" onClick={() => onLook('wardrobe')}>Your character</Plank>
          </div>
        )}

        {/* The stamp is in a flex footer outside the scroll, so it never leaves the screen. */}
        <div className="pl-foot">
          <div className="pl-foot-act">
            {plan.stamped ? (
              <>
                <div className="pl-waxed">
                  <Glyph
                    piece="stamp"
                    face="sealed"
                    size={54}
                    className="pl-wax"
                    fallback={<span className="pl-wax-fallback" aria-hidden="true" />}
                  />
                  <span className="pl-waxed-word">Your year sheet is stamped. Year {year} is saved.</span>
                </div>
                <div className="pl-foot-said">
                  {(() => {
                    const st = yearStatus(s)
                    if (st.readyForYearbook && !st.yearbookSeen && onYearbook) {
                      /* Show the nudge arrow here too. This button looks the same before and after
                       * it becomes the only thing left to do, so the arrow is what makes it stand
                       * out. */
                      return (
                        <>
                          <p className="kit-nudge-say" role="status">
                            <span className="kit-nudge-arrow" aria-hidden="true">▼</span>
                            Everything is finished. Turn the page.
                          </p>
                          <Plank size="md" className="kit-nudge" onClick={onYearbook}>Open the yearbook</Plank>
                        </>
                      )
                    }
                    if (!st.readyForYearbook) {
                      /* Only show what really holds up the year. Classes don't block the yearbook. */
                      return !st.coreBeatDone
                        ? <p className="pl-stamp-note">Finish Advisory to open the yearbook.</p>
                        : null
                    }
                    return null
                  })()}
                  {/* Says what to do next, using the same function the arrow uses. */}
                  {objective && <p className="pl-stamp-note">Next: {objective.say}</p>}
                </div>
              </>
            ) : confirming ? (
              <>
                <Plank size="lg" glyph={['stamp', 'sealed']} onClick={stamp}>Yes, stamp the year sheet</Plank>
                <Plank size="md" onClick={() => { setConfirming(false); focusAfter('pl-stamp') }}>go back</Plank>
                <p className="pl-stamp-note">
                  Nothing on this sheet can be changed afterward.
                  {offersActivities && slotsFilled < seats
                    && ` ${OPEN_SEASONS(seats - slotsFilled)}`}
                </p>
              </>
            ) : (
              <>
                {/* This is a tutorial, not a nudge, so it runs before the sheet is full. */}
                <Plank
                  size="lg"
                  id="pl-stamp"
                  data-tour="stamp"
                  disabled={!canStamp}
                  title={stampNote ?? undefined}
                  onClick={() => setConfirming(true)}
                >
                  Stamp the year sheet
                </Plank>
                {stampNote && <p className="pl-stamp-note">{stampNote}</p>}
              </>
            )}
          </div>
          <Plank size="sm" className="pl-close" onClick={onClose}>close</Plank>
          {teaching && <Tour steps={SHEET_STEPS} onDone={() => setTeaching(false)} />}
        </div>
      </div>

      {/* The dragged coin is a sibling of the sheet, so it uses the veil's coordinates. */}
      {air?.moved && (
        <span className="pl-air" style={{ left: air.x, top: air.y }} aria-hidden="true">
          <Glyph piece="pip" face={air.season.toLowerCase()} size={34} fallback={<span className="pl-coin pl-coin-big" />} />
        </span>
      )}
    </div>
  )
}
