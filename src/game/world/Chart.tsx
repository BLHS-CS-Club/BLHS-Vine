/* The chart: every island drawn on the water as its own painting, with its state taken from the
 * player's run. */
import { useEffect, useRef, useState } from 'react'
import {
  compositionCache, compositionReport, loadComposition, regionAt, seaSlots,
  type SlotState, type WorldComposition, type WorldSlot,
} from './composition'
import { dockOf, stateLine, type Dock, type DockDrawn } from './states'
import { atPct, chartBox, CHART_DENSE, CHART_TALL, CHART_THUMB, islandCut, pinPx, type IslandCut } from './chart-frame'
import { loadSave, subscribeSave } from '../save'
import { mooringFor } from '../run/resume'
import { Empty, Failed, Glyph, Loading, Plank } from '../ui/controls'
import { announce } from '../ui/a11y'
import { isAfloat, requestSail, requestVoyage, sailFrom, sailListenerCount, voyageListenerCount } from './sail-bus'
import { picksOf } from '../run/pick'
import { note } from '../ui/feedback'
import './chart.css'

/* The sentence shown when the sea holds only one island. It says what each island really is and who
 * is building the rest. */
const SEA_IS_YOUNG = 'Every island here is a real Bonney Lake club, sport or class. '
  + 'Students are still building the rest.'

/* ---- one mark at one place on a dock. Empty places are still drawn. */
function Mark({ m, big = false }: { m: DockDrawn; big?: boolean }) {
  const shape = <span className={`ch-s ${m.shape}`} />
  if (!m.on) return <span className="ch-slot ch-slot-off" aria-hidden="true" />
  return (
    <span className={`ch-slot${big ? ' ch-slot-big' : ''}`} title={m.word}>
      {m.face
        ? <Glyph piece={m.face[0]} face={m.face[1]} size={big ? 30 : 18} fallback={shape} />
        : shape}
    </span>
  )
}

/** The rail of standing places, or the single mark shown where there's no dock. */
function DockRow({ dock }: { dock: Dock }) {
  if (dock.instead) {
    return (
      <span className="ch-dock ch-dock-bare" data-fog={dock.instead.kind === 'fog' ? dock.fog : undefined}>
        <Mark m={dock.instead} big />
      </span>
    )
  }
  return (
    <span className="ch-dock">
      {dock.slots.map((m) => <Mark key={m.kind} m={m} />)}
    </span>
  )
}

/* The one badge an island shows on the water. At forty pixels wide, six marks would blur together,
 * so only the most important one shows: seal, then flag, then star, then tick. The list underneath
 * draws the full six place rail, where an empty place is easy to read. */
const BADGE_ORDER = ['stamp', 'flag', 'open', 'ashore'] as const

const badgeOf = (dock: Dock): DockDrawn | null => {
  for (const want of BADGE_ORDER) {
    const m = dock.slots.find((s) => s.kind === want)
    if (m?.on) return m
  }
  return null
}

/* `public/maps-vendored/<map>/scene.png` is the whole canvas, which is mostly transparent margin.
 * So the window is the painted area the world data records, with the picture shifted up and left
 * behind it. If the image fails to load, try the committed folder once before leaving a hole. */
function Painting({ cut, lift = false }: { cut: IslandCut; lift?: boolean }) {
  const [src, setSrc] = useState(cut.src)
  const [gone, setGone] = useState(false)
  useEffect(() => { setSrc(cut.src); setGone(false) }, [cut.src])
  return (
    <span
      className={`ch-pic${gone ? ' ch-pic-gone' : ''}`}
      style={{ width: cut.w, height: cut.h, marginTop: lift ? -cut.h / 2 : 0 }}
    >
      {/* With no painting, show the pin instead. A broken image icon on the chart looks worse. */}
      {gone ? <span className="ch-s ch-s-pin" /> : (
        <img
          className="ch-pic-img"
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          style={{ width: cut.imgW, height: cut.imgH, left: cut.left, top: cut.top }}
          onError={() => {
            if (src === cut.spare) {
              /* Say which bundle didn't load. Otherwise an island goes missing from the chart with
               * no clue why. */
              console.warn(`[chart] no painting for this island at ${cut.src} or ${cut.spare}`)
              setGone(true)
              return
            }
            setSrc(cut.spare)
          }}
        />
      )}
    </span>
  )
}

type Row = {
  key: string
  slot: WorldSlot
  dock: Dock
  line: string
  name: string
  /** The island's own painting, cropped and scaled, or null where nothing is built. */
  cut: IslandCut | null
  /** The same painting again at list size, for this island's row in the list. */
  thumb: IslandCut | null
  /** Whether the ship can be sent there from where the student is standing right now. */
  sailable: boolean
  /* Why it can't be pressed, when it can't and that's worth telling the player. */
  why: string | null
}

/* ---- clicking a named island sails the ship there */
function sailableRow(r: { dock: Dock; slot: WorldSlot }, here: string | undefined, onWater: boolean): boolean {
  return r.dock.named
    && r.dock.state !== 'rising'
    && !!r.slot.map
    && !!r.slot.berth
    /* The island the player is on is still offered while they're afloat on its water. You can't
     * sail to where you're standing, but someone steering the ship in that island's own water has
     * to be able to dock, and the pin is the only control on this page. */
    && (r.slot.map !== here || onWater)
}

/**
 * `onSailing` lets whatever opened the chart get out of the way once the ship is moving. The
 * Handbook passes its own close function.
 */
export function Chart({ onSailing, heading = true }: { onSailing?: () => void; heading?: boolean } = {}) {
  const [comp, setComp] = useState<WorldComposition | null>(compositionCache)
  const [, bump] = useState(0)
  const [inked, setInked] = useState<ReadonlySet<string>>(() => new Set())
  /* What each slot looked like on the last draw, so the chart can ink in a change instead of
   * swapping it. The chart listens to the save, so a discovery that happens while the binder is
   * open plays out in front of the student. */
  const before = useRef(new Map<string, SlotState>())

  useEffect(() => { void loadComposition().then(setComp) }, [])
  useEffect(() => subscribeSave(() => bump((v) => v + 1)), [])
  /* Redraw when the player gets on or off the ship, because that decides whether the island they're
   * on can be pressed. */
  useEffect(() => {
    const h = () => bump((v) => v + 1)
    window.addEventListener('blhs:afloat', h)
    return () => window.removeEventListener('blhs:afloat', h)
  }, [])

  const save = loadSave()

  /* No world data has loaded yet. That's different from a sea with nothing in it. */
  const slots = comp ? seaSlots(comp) : []

  /* Where the ship is tied up. The mist thins based on distance from here. */
  const moor = comp && save ? mooringFor(save.vessel, comp) : null
  const berthed: WorldSlot | null = moor?.slot ?? null
  const from = berthed ? berthed.at : null

  /* Where the player is standing, so their own island isn't offered, and whether a ship can take
   * them. */
  const here = sailFrom() ?? undefined
  /* Offer a voyage from any map with a scene, not only from one with water. The first leg is
   * walking out of the room, and `sail_to` handles that. Checking for an ocean under the painting
   * would leave the chart's only control dead in the Maw. */
  const afloat = voyageListenerCount() > 0 || sailListenerCount() > 0

  /* Every island is drawn at the same size, and the size goes down as more islands are added,
   * because dozens have to fit on one sheet. */
  const pin = pinPx(slots.length)

  const rows: Row[] = slots.map((s) => {
    const dock = dockOf(s, save, from)
    return {
      key: s.map ?? s.place ?? s.title,
      slot: s,
      dock,
      /* An island the player hasn't found doesn't show its painting. Drawing it would give away the
       * discovery, which is the same reason its name stays off the chart. */
      cut: dock.named ? islandCut(s, pin) : null,
      thumb: dock.named ? islandCut(s, CHART_THUMB) : null,
      sailable: afloat && sailableRow({ dock, slot: s }, here, isAfloat()),
      /* Why this row can't be pressed. Show it as a sentence instead of only leaving the control
       * out, so the chart never goes silent on the player. */
      why: !afloat ? 'You have to be standing somewhere with a way to the water.'
        : !dock.named ? null
          : s.map === here ? 'You are already here.'
            : !s.berth ? 'Nobody has put a dock on this one yet.'
              : null,
      line: stateLine(dock.state, s, save),
      /* An island the player hasn't found has no name on the chart. Printing its title would do the
       * discovering for them. */
      name: dock.named ? s.title : dock.state === 'rumour' ? 'a place nobody has built yet' : 'a place you have not found',
    }
  })

  /* When an island stops being misty, the mist clears and its mark inks in, once. */
  useEffect(() => {
    const fresh: string[] = []
    for (const r of rows) {
      const was = before.current.get(r.key)
      before.current.set(r.key, r.dock.state)
      if (was === 'misty' && r.dock.state !== 'misty') fresh.push(r.key)
    }
    if (!fresh.length) return
    setInked(new Set(fresh))
    const said = rows.filter((r) => fresh.includes(r.key)).map((r) => r.name)
    announce(`You found ${said.join(' and ')}. ${said.length > 1 ? 'They are' : 'It is'} on the chart now.`)
  })

  useEffect(() => {
    if (!inked.size) return
    const t = window.setTimeout(() => setInked(new Set()), 1400)
    return () => window.clearTimeout(t)
  }, [inked])

  /* Every click gets an answer, even when the ship can't go. A refusal shows as a sentence on
   * screen and is read out to a screen reader, so a press always gets a reply. */
  const sail = (r: Row) => {
    /* `requestVoyage` runs the whole journey and is the same `sail_to` a member's island calls, so
     * a pin and a line of Python use the same code. `requestSail` only steers the ship on this
     * painting's own ocean and refuses anything past the edge as aground, which is every other
     * island. This page never teleports anybody. */
    void requestVoyage(r.slot.map!).then((a) => {
      if (a.ok) {
        announce(`Sailing to ${r.name}.`)
        onSailing?.()
        return
      }
      /* If the voyage is refused, try `requestSail` instead. `requestVoyage` refuses the island the
       * player is already on, and `requestSail` steers the ship on this painting's own ocean, which
       * is how the player docks at that island. */
      void requestSail(r.slot).then((b) => {
        if (b.ok) { announce(`Sailing to ${r.name}.`); onSailing?.(); return }
        note(a.why)
        announce(a.why)
      })
    })
  }

  if (!comp) {
    return (
      <div className="ch-chart">
        {heading && <h2 className="ch-h">Chart</h2>}
        <Loading what="Loading the chart." />
      </div>
    )
  }

  if (!slots.length) {
    /* The world data came back with nothing in it. That's an error, not an empty sea. */
    return (
      <div className="ch-chart">
        {heading && <h2 className="ch-h">Chart</h2>}
        <Failed what="The chart could not be loaded." />
        <p className="ch-legend">
          The list of places came back empty. Nothing you have done is lost.
        </p>
      </div>
    )
  }

  /* The year's picks that nobody has built an island for. They go in the list, not on the sea. */
  const owed = picksOf(save).filter((p) => !p.map)

  /* The water fits around what's on it and takes its shape. */
  const box = chartBox(slots.map((s) => s.at))
  /* Past this many islands, the names and state lines wait for hover or focus. With a dozen
   * islands, the kit's smallest text is already wider than a pin. */
  const dense = slots.length > CHART_DENSE

  const known = new Set((save?.exposure ?? []).map((e) => e.place))
  const unvisited = (comp.regions ?? []).filter((r) => r.kind === 'sailable'
    && !slots.some((s) => known.has(s.place ?? '') && regionAt(comp, s.at)?.name === r.name))

  /* The ship marker shows the name the student typed at the pier. */
  const boat = save?.boatName?.trim() || 'your boat'
  /* Draw the ship where it's actually tied up. The berth is a real point on the water, so don't
   * place the ship under the island's mark with a hard-coded nudge. */
  const boatAt = berthed ? berthed.berth ?? berthed.at : null

  /* The platform couldn't be reached, so the game is drawing the copy built into it. Say so on
   * screen, because "the chart looks wrong" isn't something a teacher or a member can act on. */
  const builtIn = compositionReport().origin === 'built in'
  /* One island and nothing else is what the first deployment looks like, not a bug. */
  const isles = slots.filter((s) => !!s.map).length
  const lonely = isles <= 1

  return (
    <div className="ch-chart">
      {heading && <h2 className="ch-h">Chart</h2>}

      <div className="ch-sea">
        <div
          className="ch-water"
          data-dense={dense ? '1' : undefined}
          /* This one number gives the water the world's shape, so both axes use the same scale. */
          style={{
            aspectRatio: `${box.w} / ${box.h}`,
            /* Don't let it grow past the page. A tall world kept at its shape would push the list
             * and the legend below the bottom of the screen, where nobody knows to scroll, so the
             * water gets narrower instead. `CHART_TALL` is the height limit and the aspect sets the
             * width. */
            width: `calc(${CHART_TALL} * ${box.aspect.toFixed(4)})`,
            /* The grid spacing, from world units turned into a share of each side, so the squares
             * on the chart are square and stand for a real distance. */
            ['--ch-grid-x' as string]: `${(box.step / box.w) * 100}%`,
            ['--ch-grid-y' as string]: `${(box.step / box.h) * 100}%`,
          }}
          role="group"
          aria-label={`The archipelago. ${rows.length} place${rows.length === 1 ? '' : 's'}, and every one is listed underneath.`}
        >
          {/* The north marker, so the player can tell which way the chart faces. */}
          <span className="ch-north" aria-hidden="true">N</span>

          {/* The named regions of water, drawn under everything, so places the player hasn't been
            * show up on the page instead of being a hidden coordinate check. */}
          {(comp.regions ?? []).map((r) => (
            <div key={r.name} className={`ch-region ch-region-${r.kind}`} style={{
              left: `${((r.rect.x - box.x0) / box.w) * 100}%`,
              top: `${((r.rect.y - box.y0) / box.h) * 100}%`,
              width: `${(r.rect.w / box.w) * 100}%`,
              height: `${(r.rect.h / box.h) * 100}%`,
            }}>
              <span className="ch-region-name">{r.label ?? r.name}</span>
            </div>
          ))}

          {/* A year's picks go in the list below, not on the water, because many of them are class
            * names and not places. A row in the list can say it has no island yet. The water only
            * holds islands, regions and the ship. */}

          {rows.map((r) => {
            const badge = r.cut ? badgeOf(r.dock) : null
            const body = (
              <>
                {r.cut
                  ? <Painting cut={r.cut} lift />
                  : (
                    <span className="ch-blank" style={{ width: pin, height: pin, marginTop: -pin / 2 }}>
                      <DockRow dock={r.dock} />
                    </span>
                  )}
                {badge && (
                  <span className="ch-badge" title={badge.word}>
                    {badge.face
                      ? <Glyph piece={badge.face[0]} face={badge.face[1]} size={15} fallback={<span className={`ch-s ${badge.shape}`} />} />
                      : <span className={`ch-s ${badge.shape}`} />}
                  </span>
                )}
                <span className="ch-card">
                  <span className="ch-name">{r.name}</span>
                  <span className="ch-note">{r.line}</span>
                  {r.sailable
                    ? <span className="ch-sail">Sail here</span>
                    : r.why ? <span className="ch-shut">{r.why}</span> : null}
                </span>
              </>
            )
            const at = atPct(box, r.slot.at)
            /* Flip the card instead of letting it fall off the water. The name, state line and Sail
             * button hang under the island, and below the halfway line the bottom edge cuts them
             * off, so the card goes above the island instead. */
            const low = parseFloat(at.top) > 52
            const flip = low ? ' ch-isle-flip' : ''
            /* Only make it a button where there's somewhere to go. A control that's always there
             * and usually refuses teaches the student that the chart doesn't work. */
            return r.sailable ? (
              <button
                key={r.key}
                type="button"
                data-key={r.key}
                className={`ch-isle ch-${r.dock.state} ch-isle-go${flip}`}
                data-inked={inked.has(r.key) ? '1' : undefined}
                style={at}
                aria-label={`Sail to ${r.name}. ${r.line}`}
                title={`${r.name}. ${r.line}`}
                onClick={() => sail(r)}
              >
                {body}
              </button>
            ) : (
              <div
                key={r.key}
                data-key={r.key}
                className={`ch-isle ch-${r.dock.state}${flip}`}
                data-inked={inked.has(r.key) ? '1' : undefined}
                style={at}
                title={`${r.name}. ${r.line}`}
              >
                {body}
              </div>
            )
          })}

          {boatAt && (
            <div className="ch-you" style={atPct(box, boatAt)}>
              <span className="ch-s ch-s-ship" />
              <span className="ch-you-name">{boat}</span>
            </div>
          )}
        </div>
      </div>

      {/* What the picture means, right under the picture, in its own paragraph. */}
      <p className="ch-legend ch-legend-pic">
        Every island is drawn as its own painting, and the squares on the water are all one size, so
        how far apart two islands look is how far apart they really are.
      </p>
      {(unvisited.length > 0 || builtIn) && (
        <p className="ch-legend">
          {unvisited.length
            ? `${unvisited.map((r) => r.label ?? r.name).join(' and ')} ${unvisited.length > 1 ? 'are areas' : 'is an area'} you have not sailed to yet.`
            : ''}
          {builtIn ? ' The place list would not download, so this is the copy built into the game.' : ''}
        </p>
      )}

      {lonely && (
        <Empty
          what={isles === 1 ? 'One island is on the map so far.' : 'No island is on the map yet.'}
          fills={SEA_IS_YOUNG}
        />
      )}

      {/* ---- the list: the same facts as the chart, written as a list */}
      <ul className="ch-register">
        {berthed && (
          <li className="ch-row ch-row-you">
            <span className="ch-row-marks" aria-hidden="true"><span className="ch-s ch-s-ship" /></span>
            <span className="ch-row-words">
              <span className="ch-row-name">{boat}</span>
              <span className="ch-row-state">You are here, docked at {berthed.title}</span>
            </span>
          </li>
        )}
        {rows.map((r) => (
          <li className="ch-row" key={r.key}>
            {/* The same painting again, small, so it's clear the list and the water show the same
              * islands. */}
            {r.thumb && (
              <span className="ch-row-pic" aria-hidden="true">
                <Painting cut={r.thumb} />
              </span>
            )}
            <span className="ch-row-marks" aria-hidden="true"><DockRow dock={r.dock} /></span>
            <span className="ch-row-words">
              <span className="ch-row-name">{r.name}</span>
              <span className="ch-row-state">{r.line}</span>
              {/* A row that can't be sailed to says why. Without it, a student who opens the chart
                * from inside a room sees the island, finds nothing to press, and gets no hint that
                * they need to be somewhere else first. */}
              {!r.sailable && r.why && <span className="ch-row-closed">{r.why}</span>}
              {/* The school's own sentence, never an error, because out of season must never look
                * broken. The words come from `SPORT_SEASONS` instead of being written for each
                * island. */}
              {r.dock.closed && r.dock.closed !== r.line && (
                <span className="ch-row-closed">{r.dock.closed}</span>
              )}
            </span>
            {/* The way a keyboard reaches every island in one pass down the list. */}
            {r.sailable && (
              <Plank size="sm" className="ch-row-go" onClick={() => sail(r)}>
                Sail to {r.name}
              </Plank>
            )}
          </li>
        ))}
        {/* The year's picks that nobody has built an island for, last in the list and off the
          * water. */}
        {owed.map((p) => (
          <li className="ch-row ch-row-owed" key={`pick:${p.id}`}>
            <span className="ch-row-marks" aria-hidden="true"><span className="ch-s ch-s-pip ch-s-pip-shut" /></span>
            <span className="ch-row-words">
              <span className="ch-row-name">{p.name}</span>
              <span className="ch-row-state">
                {p.done
                  ? 'Counted as done on your year sheet. It has no island to sail to.'
                  : 'On your year sheet. Nobody has built its island yet.'}
              </span>
            </span>
          </li>
        ))}
      </ul>

    </div>
  )
}
