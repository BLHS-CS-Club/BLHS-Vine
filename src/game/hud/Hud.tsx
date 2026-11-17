import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Handbook, type Tab as HandbookTab } from './Handbook'
import { HelpCard } from './Help'
import { UI_PANELS } from '../ui-bus'
import { ChartPanel } from '../world/ChartPanel'
import { SettingsPanel } from '../../app/SettingsPanel'
import { Planner } from '../planner/Planner'
import { PickYear } from '../planner/PickYear'
import { onCornerChange, plaqueShown, plaquesRevealed } from './corner-bus'
import { TrophyWall } from '../run/TrophyWall'
import { Graduation } from '../run/Graduation'
import { CoreBeatRunner } from '../beats/ActivityRunner'
import { coreBeatFor, coreBeatId } from '../beats/beats'
import { classBeat } from '../beats/classes'
import { classById } from '../planner/catalog'
import type { CoreBeat } from '../beats/frames'
import { Wardrobe } from './Wardrobe'
import { Tour } from './Tour'
import { Yearbook } from '../run/Yearbook'
import { YearStart } from '../run/YearStart'
import { loadSave, subscribeSave } from '../save'
import { useNav } from '../../app/SceneManager'
import { track } from '../telemetry'
import { onBeatRequest, onUiRequest } from '../ui-bus'
import { onWorldHold, worldHeld } from '../world-bus'
import { cinemaOn } from '../stage/cinema'
import { onPlaceCard, onSceneDrawn, onStageBusy, placeCardUp, sceneDrawn } from '../stage/stage-bus'
import { FOUNDING_FLAG } from '../run/objective'
import { announce, panelDepth, usePanel } from '../ui/a11y'
import { grant } from '../grant'
import { attemptsOn } from '../beats/state'
import { checkIdOf, refuseCheck } from '../beats/palette'
import { placeById, programmeById } from '../roster/roster'
import type { BeatRequest } from '../ui-bus'
import { countAsDone, noIslandLine } from '../run/pick'
import { requestVoyage } from '../world/sail-bus'
import { faceStyle } from '../ui/kitFaceStyle'
import { Glyph, Plank, useKitReady } from '../ui/controls'
import { hudGrants, type HudElement } from './inventory'
import './hud.css'

/* Turns a beat id string into the beat itself. This is the only place that happens. */
function beatById(id: string, s: ReturnType<typeof loadSave>): CoreBeat | null {
  if (!s) return null
  for (let y = 1; y <= 4; y++) if (id === coreBeatId(y)) return coreBeatFor(y, s)
  const cls = classById(id.replace(/^class:/, ''))
  return cls ? classBeat(cls, s.year) : null
}

/* An island brings its own questions, and this beat gives no credit. The island's `award()` writes
 * the credit row `island:<programme>:y<n>`, and sharing that id would make `recordGrade` count two
 * attempts and count the GPA twice. The questions are checked here because `checksOf` drops a bad
 * one without saying anything. */
function islandBeat(req: BeatRequest, s: ReturnType<typeof loadSave>): CoreBeat | string {
  const decl = req.decl
  if (!decl || !s) return `no activity called "${req.beat}"`
  if (!Array.isArray(decl.items) || !decl.items.length) return `"${req.beat}" arrived with no items in it`

  for (const item of decl.items) {
    const why = refuseCheck(item)
    if (why) return `"${req.beat}" cannot be played: ${why}`
  }
  /* Two questions with the same id share one answer slot, so the second answer overwrites the first
   * and a perfect run scores one out of two. Refuse it and name the id instead of quietly giving
   * half marks. */
  const ids = decl.items.map((i) => checkIdOf(i))
  const twice = ids.find((id, i) => ids.indexOf(id) !== i)
  if (twice !== undefined)
    return `"${req.beat}" has two questions both called "${twice}". `
      + 'An id is how an answer is filed, so two of them would score as one.'

  const programme = decl.programme
  const place = placeById(programmeById(programme)?.place)?.name
  return {
    /* The id includes the year, like every other id in the save. Without `y${s.year}`, a
     * second-year attempt lands on year one's row, `recordGrade` treats it as a retake and keeps
     * the older higher grade, and the student gets a credit they didn't earn this year. */
    id: `${programme ?? 'island'}:${req.beat}:y${s.year}`,
    year: s.year,
    title: decl.title || req.beat,
    place: decl.place || place || '',
    kind: 'island',
    chrome: 'screen',
    tags: [],
    steps: decl.items.map((check) => ({ kind: 'check' as const, check })),
    takeaways: [],
    credit: 0,
  }
}

/* The grade a beat actually got, read from the ledger instead of passed around. The ledger is what
 * `recordGrade` wrote and what the GPA uses. */
function gradeFromLedger(beatId: string): number | null {
  const e = loadSave()?.ledger.find((x) => x.id === beatId)
  return e ? e.grade : null
}

// The corner controls, the pause sheet, and the place every sit-down panel opens from.

export function Hud({ onBlurWorld }: { onBlurWorld?: (b: boolean) => void }) {
  const nav = useNav()
  const [book, setBook] = useState<null | HandbookTab>(null)
  const [planner, setPlanner] = useState(false)
  /* false when closed, true to take it, or 'review' to look back at what was scored. */
  const [advisory, setAdvisory] = useState<false | true | 'review'>(false)
  const [yearbook, setYearbook] = useState(false)
  const [graduation, setGraduation] = useState(false)
  const [paused, setPaused] = useState(false)
  const [help, setHelp] = useState(false)
  /* The chart on its own screen. The corner sign and pressing E at a dock both open it. */
  const [chart, setChart] = useState(false)
  const [settings, setSettings] = useState(false)
  const [wall, setWall] = useState(false)
  /* Whether the wall or the wardrobe was opened from the year sheet. If it was, closing it goes
   * back to the sheet instead of dropping the player back in the room. */
  const fromSheet = useRef(false)
  const [wardrobe, setWardrobe] = useState(false)
  /* The handover tutorial, plus the callback waiting for it to finish. */
  const [tour, setTour] = useState<null | (() => void)>(null)
  /* A beat that world code asked for, plus the callback waiting for its grade. */
  const [playing, setPlaying] = useState<null | { beat: CoreBeat; done: (g: number | null) => void; triesAt: number }>(null)
  const [, bump] = useState(0)
  useEffect(() => subscribeSave(() => bump((v) => v + 1)), [])
  /* Redraw when the corner hands over another sign. */
  useEffect(() => onCornerChange(() => bump((v) => v + 1)), [])
  /* Whether anything in the world is talking. The world bus counts this across every scene. */
  const [held, setHeld] = useState(worldHeld)
  useEffect(() => { setHeld(worldHeld()); return onWorldHold(setHeld) }, [])
  /* Whether an arrival card is up. That also means the world isn't quiet. */
  const [cardUp, setCardUp] = useState(placeCardUp)
  useEffect(() => { setCardUp(placeCardUp()); return onStageBusy(() => setCardUp(placeCardUp())) }, [])
  const s = loadSave()
  /* Everything the run has handed over so far. Every mount reads this same pure function, so the
   * corner can't show different things in different scenes. */
  const g = hudGrants(s)
  /* Which signs the film has handed over so far. The one that just arrived swings in on its hook,
   * and the ones still to come stay dark. */
  const handedOver = plaquesRevealed()
  /* The seasons the player still has. A new run hasn't been given them yet and a finished one has
   * used them all, and the corner shows the button either way. */
  const left = s?.tokens ?? []
  /* The plan the cards are for: year one, before the sheet is stamped. */
  const firstPlan = (s?.year ?? 1) === 1 && !s?.plans?.[1]?.stamped
  useKitReady()

  /* Which controls were granted on this render, so only those swing in on their hook. */
  const seen = useRef<Set<HudElement> | null>(null)
  const entering = new Set<HudElement>()
  {
    const now = new Set<HudElement>((Object.keys(g) as HudElement[]).filter((k) => g[k]))
    if (seen.current === null) seen.current = now
    else {
      for (const k of now) if (!seen.current.has(k)) entering.add(k)
      seen.current = now
    }
  }


  const anyOpen = book !== null || planner || settings || advisory
    || yearbook || graduation || wardrobe || wall || chart || playing !== null

  /* Escape pauses, but only when no panel is up to handle it first. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return
      if (panelDepth() > 0) return                                            // A panel on top already handled it.
      if (planner || advisory || yearbook || graduation) return   // Sheets handle their own Esc. A beat never quits on Esc.
      /* Never open the pause sheet during a film. `PickYear` treats `cinemaOn()` as proof the film
       * opened it, so it would show up with no close button and a dead Escape key. Stamping it
       * would also set `planned` before the film waits for it, which quietly breaks the rest of the
       * intro. */
      if (cinemaOn()) return
      /* Only flip the pause here. The world hold is taken in the effect below. */
      setPaused((p) => !p)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [planner, advisory, yearbook, graduation, onBlurWorld])

  /* Whether the world is held comes from what's open, so no panel can forget to let go of it. */
  const heldByUs = useRef(false)
  useEffect(() => {
    const want = !!(anyOpen || paused)
    if (want === heldByUs.current) return
    heldByUs.current = want
    onBlurWorld?.(want)
  })

  /* Whoever asked for a panel, waiting until every panel is closed again. */
  const waiting = useRef<null | (() => void)>(null)
  const sawOpen = useRef(false)
  useEffect(() => {
    if (anyOpen || paused) { sawOpen.current = true; return }
    if (!sawOpen.current) return
    sawOpen.current = false
    const done = waiting.current
    waiting.current = null
    done?.()
  })
  /* Let the waiting caller go if the HUD itself unmounts, which is what happens when the player
   * goes through a door out of the room. */
  useEffect(() => () => { waiting.current?.(); waiting.current = null }, [])

  // The ui-bus. Stations in the world open these same panels (see ui-bus.ts).
  useEffect(() => onUiRequest((which, done) => {
    setPaused(false)
    /* Two waiters at once would leave the first one stuck, so let the old one go before taking the
     * new one. */
    if (done) { waiting.current?.(); waiting.current = done }
    if (which === 'planner') { track('planner_requested', { via: 'world' }); setPlanner(true) }
    if (which === 'advisory') { setAdvisory(true) }
    /* Every door marked Guide opens the school book, like the sign says. */
    if (which === 'handbook') { setBook('school') }
    /* The same binder, opened on the page the beat is about. */
    if (which === 'cords') { track('handbook_opened', { tab: 'cords', via: 'world' }); setBook('cords') }
    /* The chart opens as the chart, not as a book about school. */
    if (which === 'chart') { setChart(true) }
    /* If nothing here matches the name, let the waiting caller go. This is a chain of if checks
     * with no else, so an unknown name would leave the caller waiting until the bus's ten minute
     * limit, with the world held the whole time. `performIntent` already refuses an unknown panel
     * by name, and this is the backup behind it. */
    if (!(UI_PANELS as readonly string[]).includes(which)) {
      console.warn(`[hud] nothing here opens "${which}", so whoever asked is let go`)
      waiting.current?.()
      waiting.current = null
    }
    if (which === 'wardrobe') { fromSheet.current = false; track('wardrobe_opened', { via: 'world' }); setWardrobe(true) }
    if (which === 'settings') { setSettings(true) }
    /* The trophy wall, which fills in every time a student finishes something. */
    if (which === 'wall') { fromSheet.current = false; track('wall_requested', { via: 'world' }); setWall(true) }
    /* The yearbook, which any island can send a student to by name. */
    if (which === 'yearbook') { track('yearbook_opened', { via: 'world' }); setYearbook(true) }
    /* The tour isn't a panel and doesn't count toward `anyOpen`. It explains the corner for about
     * fourteen seconds with the world still running, and it answers its own waiter when it ends.
     * Holding the world would stop the very controls it points at. */
    if (which === 'tour') {
      track('tour_opened')
      if (done) { waiting.current = null }
      setTour(() => done ?? (() => { /* Nobody is waiting on it. */ }))
    }
  }), [onBlurWorld])

  /* A scored activity that world code asked for. Its grade goes back to whoever asked. */
  useEffect(() => onBeatRequest((req) => {
    setPaused(false)
    /* Always check the engine's own table first. A plain catalog id already resolves here, and an
     * island must never be able to replace a real class. */
    const known = beatById(req.beat, s)
    const built = known ?? islandBeat(req, s)
    /* Refuse it instead of answering null. A beat id nobody knows is a typo in someone's island,
     * and a null grade would make it look like it worked. */
    if (typeof built === 'string') { req.refuse(built); return }
    const beat = built
    /* Remember the attempt count now, so `closeAll` can tell closing without trying apart from
     * closing after an attempt. */
    setPlaying({ beat, done: req.done, triesAt: attemptsOn(loadSave(), beat.id) })
  }), [onBlurWorld, s])

  const openBook = (tab: HandbookTab) => { setPaused(false); setBook(tab) }
  const openPlanner = () => { setPaused(false); setPlanner(true) }
  const closeAll = () => {
    setBook(null); setPlanner(false); setAdvisory(false); setYearbook(false)
    setGraduation(false); setPaused(false); setSettings(false); setWardrobe(false); setWall(false)
    /* Whoever asked for a beat is told it ended, even when it ended by being closed. */
    /* A beat closed without a new attempt answers null, because gradeFromLedger would read whatever
     * old row is on the transcript. */
    setPlaying((p) => {
      if (!p) return null
      const now = attemptsOn(loadSave(), p.beat.id)
      p.done(now > p.triesAt ? gradeFromLedger(p.beat.id) : null)
      return null
    })
  }
  // The year's beat is worked out again on every render on purpose, because the year 4 audit beat
  // is built from the live save.
  /* Whether the world has finished arriving. It's on a timer so nothing waits forever. */
  const [settled, setSettled] = useState(false)
  /* Whether a map has drawn its first frame, so nothing opens over a black screen. */
  const [drawn, setDrawn] = useState(!!sceneDrawn())
  useEffect(() => {
    let t = window.setTimeout(() => setSettled(true), 2600)
    const off = onPlaceCard(() => {
      setSettled(false)
      window.clearTimeout(t)
      t = window.setTimeout(() => setSettled(true), 5200)
    })
    const offDrawn = onSceneDrawn((map) => {
      setDrawn(!!map)
      if (!map) return
      setSettled(false)
      window.clearTimeout(t)
      t = window.setTimeout(() => setSettled(true), 2600)
    })
    return () => { window.clearTimeout(t); off(); offDrawn() }
  }, [])

  const yearBeat = s ? coreBeatFor(s.year, s) : null
  // The year-start vignette. It shows once per year and only while the world is quiet, and an
  // arrival card on screen means the world isn't quiet.
  /* It waits for the arrival card first, so the player sees where they are before what the year is. */
  /* It never shows before the player has met the principal, which the founding flag records. */
  const showVignette = !!s?.introDone && s.flags.includes(FOUNDING_FLAG)
    && !anyOpen && !paused && !held && !s.graduated
    && !cardUp && settled && drawn && !s.flags.includes(`vignette:y${s.year}`)

  return (
    <>
      {/* The corner controls. Each one is a hanging carved sign with a drawn mark and a word. */}
      {/* Each sign only shows once the run has granted it. `plaqueShown` also gets a say, so an
        * island that reveals the corner one sign at a time can hold a sign back. */}
      {/* Each sign keeps its spot in the stack even before it's been handed over. */}
      <nav className="hud-stack" aria-label="Game menu">
        {(
        <button
          className={`hud-plaque${plaqueShown('map') && g.chart ? '' : ' hud-plaque-waiting'}${handedOver.includes('map') ? ' hud-arriving' : ''}${entering.has('chart') ? ' hud-arriving' : ''}`}
          data-tour="map"
          aria-label="Map. The islands you have found."
          aria-hidden={!(plaqueShown('map') && g.chart)}
          tabIndex={plaqueShown('map') && g.chart ? undefined : -1}
          aria-haspopup="dialog"
          /* The corner's Map sign opens the same chart. There's one chart with three ways in, and
           * none of them is the six-tab binder. */
          onClick={() => setChart(true)}
        >
          <Glyph piece="icon_set" face="compass" size={22} className="hud-plaque-mark" />
          <span className="hud-plaque-word">Map</span>
        </button>
        )}
        {(
        <button
          className={`hud-plaque${plaqueShown('guide') && g.handbook ? '' : ' hud-plaque-waiting'}${handedOver.includes('guide') ? ' hud-arriving' : ''}${entering.has('handbook') ? ' hud-arriving' : ''}`}
          data-tour="guide"
          aria-label="Guide. What the school offers, and what you have earned."
          aria-hidden={!(plaqueShown('guide') && g.handbook)}
          tabIndex={plaqueShown('guide') && g.handbook ? undefined : -1}
          aria-haspopup="dialog"
          /* The Guide opens on the school page, not the game's island list, because the handover
           * line promises every club and class at Bonney Lake. */
          onClick={() => openBook('school')}
        >
          {/* A drawn book mark, because a student looking for the Guide looks for a book. */}
          <span className="hud-plaque-mark kit-mark kit-mark-book" aria-hidden="true" />
          <span className="hud-plaque-word">Guide</span>
        </button>
        )}
        {(
          <button
            className={`hud-plaque${plaqueShown('my-year') && g.tokens ? '' : ' hud-plaque-waiting'}${handedOver.includes('my-year') ? ' hud-arriving' : ''} hud-tokenbtn${entering.has('tokens') ? ' hud-arriving' : ''}`}
            data-tour="my-year"
            /* This reads a save that might not exist yet, because the corner can be on screen when
             * there's no run. */
            /* The label says what the button opens and whether the year is still open. */
            aria-label={s?.plans?.[s.year]?.stamped
              ? 'My Year. Your schedule, and the classes you picked.'
              : 'My Year. Pick your classes and what you join.'}
            /* Hidden from screen readers means hidden from the keyboard too, so the sign sets both. */
            aria-hidden={!(plaqueShown('my-year') && g.tokens)}
            tabIndex={plaqueShown('my-year') && g.tokens ? undefined : -1}
            aria-haspopup="dialog"
            onClick={openPlanner}
          >
            {/* The season tokens the player still has, each drawn with its own picture and not only
              * a color. */}
            <span className="hud-tokens">
              {left.length > 0
                ? left.map((t, i) => (
                  <span className="hud-token" key={t + i} style={faceStyle('pip', t.toLowerCase())} />
                ))
                : <span className="hud-token hud-token-spent" style={faceStyle('pip', 'ghost')} />}
            </span>
            {/* The word says what the button opens. The pips are the only count on it. */}
            <span className="hud-plaque-word">My Year</span>
          </button>
        )}
        {/* Only three signs in the corner, because five would look like a list of buttons. The wall
          * and the wardrobe are things to look at, not places the year sends the player, so they
          * sit at the bottom of the year sheet in `planner/Planner.tsx`. */}
      </nav>

      {book && <Handbook initialTab={book} onClose={closeAll} />}
      {/* The first plan is a screen of cards. Every plan after that is the full year sheet. */}
      {planner && !firstPlan && (
        <Planner
          onClose={closeAll}
          onAdvisory={(review) => { setPlanner(false); setAdvisory(review ? 'review' : true) }}
          onPlayPick={(pick) => {
            /* One button per pick. If the pick has an island the ship sails there, and if it
             * doesn't, a card counts the pick as done. */
            setPlanner(false)
            /* Go through `grant` and not `awarded`. `awarded` only stamps, but `grant` compares the
             * save before and after, so a credit that pushes a cord over its line shows the cord's
             * own card. Finishing picks from the sheet is the only way to earn a cord, so it has to
             * go through here. */
            const countIt = () => {
              const beforePick = loadSave()
              countAsDone(pick)
              track('pick_counted', { id: pick.id, kind: pick.kind })
              grant(beforePick, loadSave(), {
                what: noIslandLine(pick),
                detail: 'It goes on your year sheet and on the wall.',
              })
              announce(noIslandLine(pick))
            }
            if (pick.map) {
              void requestVoyage(pick.map).then((a) => {
                if (a.ok) { announce(`Sailing to ${pick.name}.`); return }
                /* If a row's map can't be reached, treat it like a programme with no island yet and
                 * count it as done, so the year can move on. `sail_to`'s refusal is meant for
                 * whoever builds the island, so it goes to the console. On screen it would leave
                 * the pick stuck. */
                console.warn(`[pick ${pick.id}] counted as done, because it cannot be sailed to: ${a.why}`)
                countIt()
              })
              return
            }
            countIt()
          }}
          onLook={(what) => {
            /* Remember this so the Back button comes back here (see the mounts below). */
            fromSheet.current = true
            setPlanner(false)
            if (what === 'wall') { track('wall_requested', { via: 'sheet' }); setWall(true) }
            else { track('wardrobe_opened', { via: 'sheet' }); setWardrobe(true) }
          }}
          onYearbook={() => { setPlanner(false); setYearbook(true) }}
        />
      )}
      {planner && firstPlan && <PickYear year={s?.year ?? 1} onClose={closeAll} />}
      {advisory && yearBeat && (
        <CoreBeatRunner beat={yearBeat} review={advisory === 'review'} onClose={closeAll} />
      )}
      {playing && <CoreBeatRunner beat={playing.beat} onClose={closeAll} />}
      {/* A panel opened from the year sheet goes back to the sheet when it closes. */}
      {wall && <TrophyWall onClose={() => { setWall(false); if (fromSheet.current) setPlanner(true) }} />}
      {wardrobe && <Wardrobe onClose={() => { setWardrobe(false); if (fromSheet.current) setPlanner(true) }} />}
      {/* The fourteen seconds that explain the corner. */}
      {tour && <Tour onDone={() => { const f = tour; setTour(null); f() }} />}
      {yearbook && <Yearbook onClose={closeAll} onGraduate={() => { setYearbook(false); setGraduation(true) }} />}
      {graduation && <Graduation onClose={closeAll} />}
      {showVignette && s && <YearStart year={s.year} onDone={() => bump((v) => v + 1)} />}
      {settings && <SettingsPanel onClose={() => { setSettings(false); setPaused(true) }} />}

      {help && <HelpCard onClose={() => setHelp(false)} />}
      {chart && <ChartPanel onClose={() => setChart(false)} />}
      {/* The pause sheet is also hidden during a film, the same as the corner. */}
      {paused && !anyOpen && !cinemaOn() && (
        <PausePanel onClose={closeAll}>
          <Plank wide keyCap="Esc" onClick={closeAll}>Back to the game</Plank>
          {s?.introDone && <Plank wide onClick={openPlanner}>My Year</Plank>}
          {s?.graduated && (
            <Plank wide onClick={() => { setPaused(false); setGraduation(true) }}>
              {s.flags.includes('gear2') ? 'Walk the stage again' : 'Walk the stage'}
            </Plank>
          )}
          <Plank wide onClick={() => { setPaused(false); setBook('school') }}>Guide</Plank>
          {/* The same help card the corner opens, so the two can't get out of sync. */}
          <Plank wide onClick={() => { setPaused(false); setHelp(true) }}>How to play</Plank>
          <Plank wide onClick={() => { setPaused(false); setSettings(true) }}>Settings</Plank>
          <Plank wide onClick={() => { closeAll(); nav.go('title') }}>Save and leave</Plank>
        </PausePanel>
      )}
    </>
  )
}

/* The pause sheet. It's its own component so it always follows the panel rules from usePanel. */
function PausePanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = usePanel({ label: 'Paused', onClose })
  return (
    <div className="pz-veil" onClick={onClose}>
      <div className="pz-panel kit-surface-panel" onClick={(e) => e.stopPropagation()} {...panel}>
        {/* The title is plain words with no emoji. */}
        {/* The anchor next to it is a drawn mark. */}
        <div className="pz-title">
          <span className="pz-mark kit-mark kit-mark-anchor" aria-hidden="true" />
          Paused
        </div>
        {children}
        <div className="pz-note">Your progress saves by itself.</div>
      </div>
    </div>
  )
}
