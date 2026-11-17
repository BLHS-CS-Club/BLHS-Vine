// This scene loads a map bundle exported from MAPVIS and lets the player walk around its painted
// map.
import { useEffect, useRef, useState } from 'react'
import { Application, Assets, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, TextStyle, Texture, TextureSource } from 'pixi.js'
import {
  HW, HH, isoX, isoY, DEPTH_RANGE, loadWaterVariants, configSeaTile, animSwells,
  type SwellSprite,
} from '../ocean'
import { cleanLife, lifeAt, type Life, type LifeBounds, separate } from './life'
/* The walking rules come from walk.ts, so the editor and this scene always agree on where someone
 * can stand. */
import { TEST_SPEED, Walker, canStand as lawCanStand, canStandFrom as lawCanStandFrom, defaultCfg, dirFrom, type MaskDoc, type WalkCfg } from './walk'
import { AnchorSet, type Anchor } from './anchors'
import { framingOf, shotOf, projectFramings, shotsOf, type NamedShot } from './framings'
import { readPaths, legsOf, lengthOf, pathNames, walkFaults, type Pathway } from './paths'
import { followStep } from './follow'
import { holdWorld, onWorldHold, worldHeld } from '../world-bus'
import { carryCinemaThroughDoor, cinemaBy, cinemaOn, onCinema, setCinema, takeCinemaCarry } from '../stage/cinema'
import { choose, clearDialogue, say } from '../dialogue'
import { engine } from '../intent-engine'
import { play as playSfx } from '../audio'
import { NotBuilt, PACE_OF, PLAYER, WAIT_FOR_CEILING_MS, performIntent, type Intent, type IntentHost, type IntentWorld, type Offset } from '../../vine/intents'
import { CutsceneRuntime } from '../cutscene/runtime'
import type { CutsceneStage } from '../cutscene/types'
import { findPath, onFloor, type Pt } from './path'
import { warmMap } from './warm'
import { setMapUrl, targetFromUrl, type PmapTarget } from './route'
import { loadSave, recordExposure, recordPosition, recordVessel } from '../save'
import { resumeFor, stampOf, RESUME_REASONS, type WorldStamp } from '../run/resume'
import { placeOfMap } from '../roster/roster'
import { setContext } from '../telemetry'
/* The world: how the maps are laid out on the ocean, the ship on the water, and the states a map's
 * slot can be in. */
import {
  loadComposition, slotOfMap, seaSlots, discoveredSlots, residentSlots, regionAt,
  berthOf, markNames, marksOf, approachTo, approachNames, berthOfRoute, farStart,
  type WorldComposition, type WorldSlot, type Berth, type WorldMark,
} from '../world/composition'
/* The voyage is kept outside this scene, so it keeps going when the ship passes through a door and
 * the scene reloads. */
import {
  beginVoyage as beginTravel, endVoyage as endTravel, setLeg as setTravelLeg,
  voyage as travelPlan, voyageSkipped, voyageCalledOff, onVoyage as onTravel, LEG_CEILING_MS,
} from '../world/travel'
import { stateOf, STATE_INK } from '../world/states'
import { onHeadBack } from '../world/home-bus'
import { clearIslandTasks } from '../hud/island-tasks'
import { onSailRequest, onVoyageRequest, setAfloat } from '../world/sail-bus'
import { seaRoute } from '../world/searoute'
import { requestUi } from '../ui-bus'
import { drawRecolored, lookHue } from '../thorLook'
import { poseFrame, walkFrame, wornKey } from '../thorWear'
import { wallAll } from '../run/wall'
import { subscribeSave } from '../save'
import { loadSettings, onSettings } from '../../app/SettingsPanel'
import { runEnding, setRunEnding } from '../hud/objective-bus'
import { sessionOver } from '../run/year'
import {
  newHull, stepHull, berthHelm, steerTo, easeHelm, lineUpPoint, insideTheApproach, RUN_IN_CORRIDOR_PX,
  DEFAULT_SAIL, HELM_IDLE,
  type Berthing, type Helm, type HullState,
} from '../world/sail'
import { cover, transitionBusy } from '../../app/transitions'
import { ceremonyCover, coverFor, passingCover, markSeen, seenThisSession, titleOfMap } from '../stage/covers'
import { setSceneDrawn, showPlaceCard } from '../stage/stage-bus'
import { motionMs, prefersReducedMotion } from '../ui/motion'
import { uiBand } from '../ui/frame'
import { kitNineSlice, kitPieceHeight, kitSprite, kitTexture } from '../ui/kitSprite'
import { goldenHour } from '../ui/atmosphere'
/* Asks the stage bus whether the arrival card is on screen. The scene has no way to tell that by
 * itself. */
import { note } from '../ui/feedback'
import { placeCardUp } from '../stage/stage-bus'
/* Lets this scene put its own line on the objective panel at the top of the screen, for a goal the
 * year doesn't know about. */
import { setObjectiveSaid, setWorldObjective } from '../hud/objective-bus'

/* How far from an island's own berth a start line can be and still count as that island's. Keep it
 * up here: arriveAboard reads it on the first frame of a sea arrival, and declaring it lower down
 * crashes with a "before initialization" error. */
const FAR_START_REACH = 900

/** The five states a prompt in the world can be in. */
export type PromptState = 'plain' | 'objective' | 'barred' | 'done'
import { composeWorldText, WORLD_TEXT } from '../ui/worldText'
import { MAW_MAP, isObjective, nextObjective } from '../run/objective'
import { labelFor, ownerOf } from './grape-router'
import { islandOfMap } from '../roster/member-islands'
import { vineIslandOfMap } from '../roster/vine-islands'
import { fetchGrape, type GrapeRef } from '../../vine/py/grape-source'
import { openGrape, type GrapeSession } from '../../vine/py/runGrape'
import { useNavMaybe } from '../../app/SceneManager'

/* When there's no picture for a heading, this gives the closest heading that might have one. That
 * way a character drawn in only four directions still faces roughly the right way instead of
 * snapping to south. */
const NEAREST_VIEW: Record<string, string> = {
  'south-east': 'east',
  'north-east': 'east',
  'south-west': 'west',
  'north-west': 'west',
  east: 'south-east',
  west: 'south-west',
  north: 'north-east',
  south: 'south-east',
}

// ---- the MAPVIS export contract (MAPVIS/src/core/editor.ts, exportBundle) ----
interface PmapEncoding {
  blocked: number; L0: number; ramp01: number; L1: number
  ramp12: number; L2: number; ramp23: number; L3: number
  stepTolerance?: number
}
interface PmapJson {
  id: string
  w: number; h: number
  /** The painting's real size and position inside its canvas, which can be smaller than the canvas. */
  base?: { w: number; h: number; ox: number; oy: number }
  encoding: PmapEncoding
  spawn: [number, number]
  /** Named routes, each with waypoints, a kind, and the direction to face at the end. */
  paths?: unknown
  /** Named camera shots. They're stored either here or inside each anchor's meta bag. */
  framings?: unknown
  character: { heightPx: number; hip: number; hipDY: number }
  speed: number                     // Pixels per second at the painting's scale.
  yScale: number                    // Up-and-down speed factor for the tilted ground.
  stairs: { value: number; connects: [number, number]; rect: [number, number, number, number]; px: number }[]
  occluders: { id: number; baseline: number }[]
  /** Every named spot on this map, so Python can name a place instead of giving an x and a y. */
  anchors?: unknown
  events?: unknown
  /** What kind of map this is, its title, and which school offering it belongs to. */
  class?: string
  title?: string
  islandId?: string
  meta?: Record<string, unknown>
}

/* How far above the placed objects the player and the occluders are lifted in draw order, so the
 * player is never hidden behind them. */
const OVER_PLACED = 1e4
/* Where a placement sits in the draw order: its y position plus the author's nudge, z. MAPVIS
 * stores the nudge as z instead of moving the object down the map, so a lamp drawn over a puddle
 * doesn't also shift south. With no z, it sorts by plain y. */
const depthOf = (a: { y: number; z?: unknown }) => {
  const z = Number((a as { z?: unknown }).z)
  return a.y + (Number.isFinite(z) ? z : 0)
}

const DIRS8 = ['south', 'north', 'east', 'west', 'south-east', 'north-east', 'north-west', 'south-west']
const A_MIN = 40 // Same alpha cutoff as BeachIso and objmap/measure.ts.

/* Personal space. The push apart is built from four numbers copied from MAPVIS. */

/* The smallest body anything can have, in painting pixels. */
const BODY_MIN = 2

/* The keep-out circle's radius, as a fraction of the drawn width. */
const BODY_R = 0.6

// The keep-out circle for something whose drawn art is w pixels wide.
function bodyRadius(w: number) {
  return Math.max(BODY_MIN, (w || 8) * BODY_R)
}

/* How wide the drawn part of a picture is, ignoring the empty canvas around it. */
function inkWidth(data: Uint8ClampedArray, w: number, h: number) {
  let x0 = w
  let x1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
  // A picture with nothing drawn in it gives back the full canvas width. That's never worse than
  // giving back zero.
  return x1 >= x0 ? x1 - x0 + 1 : w
}

/* Checks whether a walker can get close enough to touch something. */
function walkerCanReach(x: number, y: number, r: number, yScale: number, stands: (x: number, y: number) => boolean) {
  const ys = yScale || 1
  const reach = r + BODY_MIN
  const x0 = Math.ceil(x - reach)
  const x1 = Math.floor(x + reach)
  const y0 = Math.ceil(y - reach * ys)
  const y1 = Math.floor(y + reach * ys)
  for (let py = y0; py <= y1; py++)
    for (let px = x0; px <= x1; px++) {
      if (Math.hypot(px - x, (py - y) / ys) >= reach) continue
      if (stands(px, py)) return true
    }
  return false
}

/* For a placement the floor doesn't fence in, checks whether a spot is close enough to the box it
 * moves around in. */
function freeReach(x: number, y: number, r: number, yScale: number, b: LifeBounds | null | undefined) {
  // No box means no fence, so the placement can be anywhere and everything counts as reachable.
  if (!b) return true
  const reach = r + BODY_MIN
  const ys = yScale || 1
  return x >= b.x - reach && x <= b.x + b.w + reach && y >= b.y - reach * ys && y <= b.y + b.h + reach * ys
}

/* Cuts a push apart down so it never moves something onto a spot nobody can stand on. */
function floorPush(
  pts: { x: number; y: number }[],
  push: { dx: number; dy: number }[],
  stands: (x: number, y: number) => boolean,
  fenced: boolean[],
) {
  for (let i = 0; i < pts.length; i++) {
    const o = push[i]
    if (!o.dx && !o.dy) continue
    if (!fenced[i]) continue
    const p = pts[i]
    if (stands(p.x + o.dx, p.y + o.dy)) continue
    if (stands(p.x + o.dx, p.y)) {
      o.dy = 0
      continue
    }
    if (stands(p.x, p.y + o.dy)) {
      o.dx = 0
      continue
    }
    o.dx = 0
    o.dy = 0
  }
  return push
}

/* The drawn width of each loaded picture, cached by the picture's frame. */
const inkCache = new Map<string, number>()
function inkOf(tex: Texture): number {
  const f = tex.frame
  const key = `${tex.source.uid}:${f.x},${f.y},${f.width},${f.height}`
  const hit = inkCache.get(key)
  if (hit !== undefined) return hit
  const w = Math.round(tex.width)
  const h = Math.round(tex.height)
  let out = w
  try {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    g.drawImage(tex.source.resource as CanvasImageSource, f.x, f.y, f.width, f.height, 0, 0, w, h)
    out = inkWidth(g.getImageData(0, 0, w, h).data, w, h)
  } catch {
    // If a picture can't be read back, use its full canvas width.
  }
  inkCache.set(key, out)
  return out
}

/* The facing comes from walk.ts's dirFrom, using the same squashed vector, so the scene draws the
 * same facing the editor's walk test would. */

function radial(size: number, stops: [number, string][]) {
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [t, c] of stops) grad.addColorStop(t, c)
  g.fillStyle = grad; g.fillRect(0, 0, size, size)
  return Texture.from(cv)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    /* The walk mask is read pixel by pixel, so the image has to load with cross-origin access.
     * Otherwise the browser won't let the code read its pixels. */
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

// Reads an image's pixels once into one flat RGBA array.
function pixelsOf(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h
  const g = cv.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  return g.getImageData(0, 0, w, h).data
}

// Finds which rows of a texture have something drawn, by scanning alpha. That tells where the art's
// top and feet really are.
function scanRows(t: Texture): { top: number; feet: number } | null {
  try {
    const src = t.source
    const cv = document.createElement('canvas'); cv.width = src.pixelWidth; cv.height = src.pixelHeight
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.drawImage(src.resource as CanvasImageSource, 0, 0)
    const d = g.getImageData(0, 0, cv.width, cv.height).data
    let top = -1, feet = -1
    for (let y = 0; y < cv.height; y++) {
      let hit = false
      for (let x = 0; x < cv.width && !hit; x++) if (d[(y * cv.width + x) * 4 + 3] > A_MIN) hit = true
      if (hit) { if (top < 0) top = y; feet = y }
    }
    return feet < 0 ? null : { top, feet }
  } catch { return null }
}

/* Finds the left and right edges of whatever is drawn between two rows. */
function scanCols(t: Texture, y0: number, y1: number): { left: number; right: number } | null {
  try {
    const src = t.source
    const cv = document.createElement('canvas'); cv.width = src.pixelWidth; cv.height = src.pixelHeight
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.drawImage(src.resource as CanvasImageSource, 0, 0)
    const d = g.getImageData(0, 0, cv.width, cv.height).data
    const lo = Math.max(0, y0), hi = Math.min(cv.height - 1, y1)
    let left = -1, right = -1
    for (let x = 0; x < cv.width; x++) {
      let hit = false
      for (let y = lo; y <= hi && !hit; y++) if (d[(y * cv.width + x) * 4 + 3] > A_MIN) hit = true
      if (hit) { if (left < 0) left = x; right = x }
    }
    return right < 0 ? null : { left, right }
  } catch { return null }
}

/* Which map to open, and where in it to arrive, is worked out in route.ts. */

export default function PmapScene() {
  /* The way out of the world, used by end_run. It's optional so a test harness can mount this scene
   * by itself. */
  const navMaybe = useNavMaybe()
  const hostRef = useRef<HTMLDivElement>(null)
  /* The map is kept in state, so going through a door re-runs the effect instead of reloading the
   * page. */
  const [target, setTarget] = useState<PmapTarget>(targetFromUrl)

  useEffect(() => {
    let destroyed = false
    let instance: Application | null = null
    /* start() sets this once the stage exists. The cleanup below calls it whether or not start()
     * got that far. */
    let teardownStage = () => { /* Nothing was published. */ }
    /* start() sets this if the map opened an island. A running worker holds a MicroPython heap, so
     * a scene that closes in the middle of a say() must not leave one behind on a 4 GB Chromebook. */
    let stopIsland = () => { /* No island on this map. */ }
    const keys: Record<string, boolean> = {}
    const kd = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = true }
    const ku = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false }
    /* Forget every held key as soon as the world is taken away. Otherwise the e that opened a panel
     * fires the station again when the panel closes, and a held d walks the player into a wall
     * behind the year sheet. */
    const dropKeys = () => { for (const k of Object.keys(keys)) keys[k] = false }
    /* A walk started with a click stops too. start() sets this once the scene's walk state exists.
     * Before that, and after teardown, it does nothing. */
    let cancelPlayerWalk = () => { /* No scene yet. */ }
    /* The chart's own controls for sending the ship to sea. They're removed along with the scene. */
    let offSail = () => { /* No ocean yet. */ }
    let offHome = () => { /* No dock yet. */ }
    let offVoyage = () => { /* Nothing to sail to yet. */ }
    /* Runs when the trip is canceled from outside this scene. SkipVoyage drops the plan, but this
     * scene still owns the black bars. */
    let offTravel = () => { /* Nobody is traveling yet. */ }
    /* The outfit watcher. It's declared out here because the scene's teardown is out here. */
    let offLook = () => { /* Nobody is dressed yet. */ }
    /* The camera switch. It's out here because the teardown is out here. */
    let offCamera = () => { /* No camera yet. */ }
    const offHold = onWorldHold((held) => { if (held) { dropKeys(); cancelPlayerWalk() } })

    /* Movie mode. A world hold puts away this scene's furniture, and these two values follow it as
     * well. */
    let movieOn = false
    let movieHold: null | (() => void) = null
    let onMovie: (on: boolean) => void = () => { /* No scene yet. */ }
    const offCinema = onCinema((on) => {
      /* Raising the movie frame takes away the player's controls, and lowering it gives them back. */
      if (on && !movieOn) movieHold ??= holdWorld('movie')
      if (!on) { movieHold?.(); movieHold = null }
      movieOn = on
      onMovie(on)
    })

    const start = async () => {
      const params = new URLSearchParams(window.location.search)
      const mapId = target.map
      const DBG = params.has('dbg')
      /* Show the loading text before the first fetch, because the fetch is most of the wait. */
      loadingPlate = document.createElement('div')
      loadingPlate.setAttribute('aria-live', 'polite')
      loadingPlate.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
        + 'background:#05080c;color:#baf3ea;font:bold 18px Deckhand,monospace;letter-spacing:.04em;pointer-events:none;z-index:2'
      loadingPlate.textContent = `Loading ${titleOfMap(mapId)}`
      hostRef.current?.appendChild(loadingPlate)

      /* Tracks what opening this map really costs: the URLs asked for and the files fetched. */
      const asked = new Set<string>()
      const req = (u: string) => { asked.add(u); return u }
      // Takes back a file the bundle doesn't have, so it doesn't count toward what opening this map
      // costs.
      const unreq = (u: string) => { asked.delete(u) }
      try { performance.setResourceTimingBufferSize(4000) } catch { /* Not every browser has this. */ }
      const netAtStart = performance.getEntriesByType('resource').length

      /* Where a map comes from. First the copy vendored at build time, then the folder committed in
       * this repo. The platform is used only when ?src=platform asks for it, so a student's browser
       * never fetches from it. */
      const srcMode = params.get('src')
      const wantLocal = srcMode === 'local'
      const wantPlatform = srcMode === 'platform'
      const host = (import.meta.env?.VITE_MAPVIS_URL || '').replace(/\/+$/, '')
      const pinned = params.get('v')
      let dir = `/maps-painted/${mapId}`
      let mp: PmapJson | null = null
      /* Left undefined for a committed folder, which isn't the same as version zero. resumeTarget
       * treats a bundle with a version number and one without as two different bundles. */
      let mapVersion: number | undefined

      if (!wantLocal && !wantPlatform) {
        try {
          const man = await fetch(req(`/maps-vendored/${mapId}/manifest.json`)).then((r) =>
            r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : Promise.reject(new Error(String(r.status))),
          )
          dir = `/maps-vendored/${mapId}`
          mp = man.map as PmapJson
          mapVersion = Number(man.version)
          console.log(`[pmap] ${mapId} v${man.version} from the vendored copy`)
        } catch {
          /* Not vendored, so use the committed folder. */
        }
      }

      if (wantPlatform) {
        try {
          const q = pinned ? `?v=${encodeURIComponent(pinned)}` : ''
          const man = await fetch(req(`${host}/api/v1/maps/${encodeURIComponent(mapId)}${q}`)).then((r) =>
            r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
          )
          // Every file of a published version lives under one prefix that never changes.
          dir = `${host}/api/v1/maps/${encodeURIComponent(mapId)}/file/${man.version}`
          mp = man.map as PmapJson
          /* Which published version this is. A saved position only fits the bundle it was saved on. */
          mapVersion = Number(man.version)
          console.log(`[pmap] ${mapId} v${man.version} from the platform`)
        } catch {
          /* Not published, or the platform can't be reached, so use the committed folder. */
        }
      }

      // ---- the bundle: map.json first, then the three images, all data before any Pixi ----
      try {
        if (!mp)
          mp = await fetch(req(`${dir}/map.json`)).then((r) => {
            if (!r.ok) throw new Error(`map.json ${r.status}`)
            return r.json()
          })
      } catch (e) {
        console.error(`[pmap] could not load ${dir}/map.json`, e)
        if (hostRef.current) hostRef.current.innerHTML =
          `<div style="color:#c9d6e2;font:14px system-ui;padding:24px">This place did not load. Reload the page and try again. (map: ${mapId})</div>`
        return
      }
      // Checked once here, so the code below doesn't have to keep checking for null.
      if (!mp) return
      const map: PmapJson = mp
      const [sceneImg, levelsImg, occImg] = await Promise.all([
        loadImage(req(`${dir}/scene.png`)),
        loadImage(req(`${dir}/levels.png`)),
        /* Only count occluders.png if it arrives. Room maps have no occluders, and counting the 404
         * makes the tally one more than the bundle's file count, which looks like a bug in the log. */
        loadImage(req(`${dir}/occluders.png`)).catch(() => {
          unreq(`${dir}/occluders.png`)
          return null
        }),
      ])
      if (destroyed) return
      const W = map.w, H = map.h

      /* Read every anchor by name. Doors are one of the six kinds. */
      const anchors = AnchorSet.from(mapId, map)
      const doors = anchors.ofKind('door')

      /* Named paths and named camera shots. An older flat list of shots gets folded into the shape
       * the reader expects. */
      const paths: Pathway[] = readPaths(map, mapId)
      const folded = projectFramings(anchors.all, (map as { framings?: unknown }).framings, mapId)
      const shots: Map<string, NamedShot> = shotsOf(anchors.all)
      if (DBG && (paths.length || shots.size)) {
        console.log(`[pmap] ${mapId}: ${paths.length} path(s) ${pathNames(paths).join(' ') || '-'}`
          + ` · ${shots.size} shot(s) ${[...shots.keys()].join(' ') || '-'}`
          + (folded ? ` (${folded} folded off the bundle's own list)` : ''))
      }
      /* Every placement, looked up by any string that can name it: its MAPVIS id or the author's
       * name for it. */
      const placedById = new Map<string, Sprite>()

      /* An actor a script has taken control of. It's the map's own placement, not a copy. */
      type Driven = {
        x: number; y: number; visible: boolean; look: number | null
        /* Which way it faces while a script controls it. */
        facing: string | null
        /* then turns a polled move into a promise. It fires once, when the move really ends. */
        /* via is the rest of the route, so a guided walk runs as one move instead of many. */
        move: null | { tx: number; ty: number; via?: { x: number; y: number }[]; speed: number; done: boolean; then?: () => void }
        /* How far through its walk cycle it is, in frames. */
        animT: number
        /* How far it really moved this frame, in ground pixels. */
        moved: number
      }
      const driven = new Map<Sprite, Driven>()

      /* Finds the point a given ground distance ahead along the route. The facing direction is
       * worked out from it. */
      const aheadAlong = (
        m: { tx: number; ty: number; via?: { x: number; y: number }[] },
        fx: number, fy: number, want: number, ys: number,
      ): { x: number; y: number } => {
        let x = fx, y = fy
        let left = want
        const legs: { x: number; y: number }[] = [{ x: m.tx, y: m.ty }, ...(m.via ?? [])]
        for (const leg of legs) {
          const dx = leg.x - x, dy = leg.y - y
          const d = Math.hypot(dx, dy / ys)
          if (d >= left) {
            const k = d > 0 ? left / d : 0
            return { x: x + dx * k, y: y + dy * k }
          }
          left -= d
          x = leg.x; y = leg.y
        }
        return { x, y }
      }
      /* How far a placement's draw depth is shifted from where it stands. The nudge stays the same
       * for the whole scene while a moving thing's y changes every frame, so it's stored per sprite
       * instead of being added in each of the three places a depth gets written. */
      const depthBias = new Map<Sprite, number>()
      const biased = (sp: Sprite, y: number) => y + (depthBias.get(sp) ?? 0)
      const looksOf = new Map<Sprite, Look[]>()
      /* The name of each look, in the same order the art uses. Slot 0 is the placement's own look. */
      const lookNamesOf = new Map<Sprite, string[]>()

      /* Anchors this scene has already warned about, so a room that syncs its shelf on every load
       * warns once instead of on every visit. */
      const saidUnbound = new Set<string>()

      const actorSprite = (name: string): Sprite | null => placedById.get(name) ?? null
      const take = (sp: Sprite): Driven => {
        let d = driven.get(sp)
        if (!d) { d = { x: sp.position.x, y: sp.position.y, visible: sp.visible, look: null, facing: null, move: null, animT: 0, moved: 0 }; driven.set(sp, d) }
        return d
      }


      /* Record that the player saw this map's place. */
      {
        const place = placeOfMap(mapId)
        if (place) {
          recordExposure(place.id, true)
          engine.log('place_seen', { place: place.id, map: mapId, docked: true })
        }
        /* Tag every heartbeat with where the student is until that changes. That way time spent is
         * tracked per map without each map keeping its own clock. */
        setContext({ map: mapId, place: place?.id ?? null })
      }

      /* Where this painting sits on the shared ocean, if the world layout has placed it. */
      const comp: WorldComposition | null = await loadComposition().catch(() => null)
      const slot: WorldSlot | undefined = comp ? slotOfMap(comp, mapId) : undefined
      /* The bundle's own painted area. It only counts when it's different from the full canvas. */
      const said = map.base
      const paintBase = said
        && [said.w, said.h, said.ox, said.oy].every((n) => isFinite(Number(n)))
        && said.w > 0 && said.h > 0
        && !(said.w === W && said.h === H && !said.ox && !said.oy)
        ? { w: said.w, h: said.h, ox: said.ox || 0, oy: said.oy || 0 }
        : null
      /* Where the painting sits, taken from the world layout first, then the bundle, then the whole
       * canvas. Its center is worked out from this. */
      const paintedSaid = slot?.origin
        ? { w: slot.footprint.w, h: slot.footprint.h, ox: slot.origin.x, oy: slot.origin.y }
        : paintBase ?? (slot
          ? { w: slot.footprint.w, h: slot.footprint.h, ox: (W - slot.footprint.w) / 2, oy: (H - slot.footprint.h) / 2 }
          : { w: W, h: H, ox: 0, oy: 0 })
      /* Clip the painted area to the canvas instead of rejecting it. The footprint comes from the
       * ocean layout and the canvas size comes from the bundle, so they can disagree, and an area
       * that sticks out past the canvas would show a band of empty space. */
      const px0 = Math.max(0, Math.min(W, paintedSaid.ox))
      const py0 = Math.max(0, Math.min(H, paintedSaid.oy))
      const px1 = Math.max(px0, Math.min(W, paintedSaid.ox + paintedSaid.w))
      const py1 = Math.max(py0, Math.min(H, paintedSaid.oy + paintedSaid.h))
      const painted = { w: px1 - px0 || W, h: py1 - py0 || H, ox: px1 > px0 ? px0 : 0, oy: py1 > py0 ? py0 : 0 }
      if (painted.w !== paintedSaid.w || painted.h !== paintedSaid.h
        || painted.ox !== paintedSaid.ox || painted.oy !== paintedSaid.oy) {
        console.warn(`[pmap] ${mapId}: the painted rect it was given, `
          + `${paintedSaid.w}x${paintedSaid.h} at ${paintedSaid.ox},${paintedSaid.oy}, reaches outside the `
          + `${W}x${H} canvas, so it has been cut back to ${painted.w}x${painted.h} at ${painted.ox},${painted.oy}. `
          + 'The footprint on the ocean page and this map cannot both be right.')
      }
      const pc = { x: painted.ox + painted.w / 2, y: painted.oy + painted.h / 2 }
      if (painted.w !== W || painted.h !== H) {
        console.info(`[pmap] ${mapId}: the painting is ${painted.w}x${painted.h} at ${painted.ox},${painted.oy}`
          + ` inside a ${W}x${H} canvas, off ${slot?.origin ? 'the world document' : 'the bundle'}`)
      }
      const toSea = (px: number, py: number) => ({
        x: (slot?.at.x ?? 0) + px - pc.x,
        y: (slot?.at.y ?? 0) + py - pc.y,
      })
      const fromSea = (sx: number, sy: number) => ({
        x: sx - (slot?.at.x ?? 0) + pc.x,
        y: sy - (slot?.at.y ?? 0) + pc.y,
      })

      if (DBG && anchors.all.length) {
        console.log(`[pmap] ${mapId}: ${anchors.all.length} anchors ·`,
          anchors.all.map((a) => `${a.name}(${a.kind})`).join(' '))
      }
      /* Checks whether a door's target map exists. Each target is checked once, and the platform is
       * asked too. */
      const doorState = new Map<string, 'checking' | 'ok' | 'missing'>()
      const isJson = (r: Response) => r.ok && (r.headers.get('content-type') || '').includes('json')
      const checkDoor = (to: string) => {
        if (doorState.has(to)) return
        if (!to) { doorState.set(to, 'missing'); return }
        doorState.set(to, 'checking')
        const committed = () => fetch(`/maps-painted/${to}/map.json`)
          .then((r) => doorState.set(to, isJson(r) ? 'ok' : 'missing'))
          .catch(() => doorState.set(to, 'missing'))
        const local = () => fetch(`/maps-vendored/${to}/manifest.json`)
          .then((r) => { if (isJson(r)) doorState.set(to, 'ok'); else return committed() })
          .catch(() => committed())
        if (!wantPlatform || !host) { void local(); return }
        void fetch(`${host}/api/v1/maps/${encodeURIComponent(to)}`)
          .then((r) => {
            if (!isJson(r)) return local()
            doorState.set(to, 'ok')
            /* Start downloading the room behind the door now, instead of waiting until the player
             * opens it. */
            void warmMap(to)
          })
          .catch(() => local())
      }
      /* Every door is checked when the map loads, so clicking one never fails because the check
       * hasn't run yet. */
      for (const d of doors) checkDoor(d.to || '')

      const sdata = pixelsOf(sceneImg, W, H)
      const ldata = pixelsOf(levelsImg, W, H)
      const odata = occImg ? pixelsOf(occImg, W, H) : null
      const sAlpha = (x: number, y: number) => sdata[(y * W + x) * 4 + 3]

      /* Island or room. The bundle says which, and if it doesn't, guess from whether the border is
       * transparent. */
      const declared = typeof map.class === 'string' ? map.class : ''
      let coastCut = false
      for (let x = 0; x < W && !coastCut; x++) if (sAlpha(x, 0) <= A_MIN || sAlpha(x, H - 1) <= A_MIN) coastCut = true
      for (let y = 0; y < H && !coastCut; y++) if (sAlpha(0, y) <= A_MIN || sAlpha(W - 1, y) <= A_MIN) coastCut = true
      if (declared === 'room' || declared === 'hall') coastCut = false
      else if (declared === 'island') coastCut = true
      else if (declared) console.warn(`[pmap] ${mapId}: unknown map class "${declared}", guessing from the border`)

      // The walking rules: MAPVIS's code, imported, with the step tolerance and character sizes
      // from the bundle.
      const TOL = map.encoding.stepTolerance ?? 10
      const HIP = map.character.hip
      const HIPDY = map.character.hipDY
      /* The level under a pixel, rounded. Anything off the canvas counts as blocked. */
      const lvlAt = (x: number, y: number) => {
        const xi = Math.round(x), yi = Math.round(y)
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 0
        return ldata[(yi * W + xi) * 4]
      }
      /* The bundle's numbers, in the shape walk.ts expects. */
      const cfg: WalkCfg = {
        ...defaultCfg(),
        speed: map.speed,
        hip: HIP,
        hipDY: HIPDY,
        near: TOL,
        charH: map.character.heightPx,
        yScale: map.yScale,
      }
      /* Everything the walk rules need from the map: a way to read levels, and a hit marker that
       * does nothing. */
      const doc = { lvlAt, markHit: () => {} } as unknown as MaskDoc
      // The character has a body. The feet and two hip points must all be on floor at the same
      // level, so no shoulder hangs over a terrace edge.
      const canStandFrom = (x: number, y: number, fromLvl: number) => lawCanStandFrom(doc, cfg, x, y, fromLvl)
      const canStand = (x: number, y: number) => lawCanStand(doc, cfg, x, y)

      // ---- Pixi ----
      TextureSource.defaultOptions.scaleMode = 'nearest'
      const app = new Application()
      /* Pixi's accessibility layer is on. It builds itself the first time someone presses Tab. */
      await app.init({ resizeTo: window, background: coastCut ? '#073442' : '#05080c', antialias: false })
      if (destroyed) { app.destroy(true, { children: true }); return }
      instance = app
      hostRef.current?.appendChild(app.canvas)
      /* The loading text stays on screen while the map loads, and the stage stays hidden until the
       * first frame. */
      app.stage.visible = false

      const world = new Container()
      world.sortableChildren = true
      app.stage.addChild(world)

      /* The canvas accepts pointer input, so a click anywhere on the painting can do something. */
      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen

      // Camera zoom. The contain zoom is pulled back so the island floats in open sea. Adding ?z=N
      // to the URL overrides it.
      const zOverride = parseFloat(params.get('z') || '0')
      /* Three named shots: the wide island view, the walking view, and a room that fills the
       * screen. */
      const fitIn = Math.min(app.screen.width / W, app.screen.height / H)
      /* This is named fitCover because cover is already the door transition imported at the top of
       * this file. Don't shadow that name, or every door breaks. */
      const fitCover = Math.max(app.screen.width / W, app.screen.height / H)
      /* The camera never shows anything outside the painting. The zoom floor uses the painted area
       * instead of the canvas, because a canvas can be much bigger than its picture (the hub's
       * 688x640 canvas holds a 669x377 picture). It uses a cover fit, so there are never black
       * bars. */
      const Z_PAINT = Math.max(app.screen.width / painted.w, app.screen.height / painted.h)
      /* An island's camera fence is the painting plus 160 pixels of sea on every side, instead of
       * its coastline. A floor based on the coastline alone would change a lot with the window's
       * shape. A room has no sea edge and keeps the painting. */
      const SEA_EDGE = coastCut ? 160 : 0
      const fenceW = painted.w + SEA_EDGE * 2
      const fenceH = painted.h + SEA_EDGE * 2
      /* On an island, use a contain fit so the whole picture is on screen and the engine's ocean
       * fills the rest. A room still uses the cover fit, because outside a room there's only black. */
      const Z_ISLAND = coastCut
        ? Math.min(app.screen.width / painted.w, app.screen.height / painted.h)
        : Z_PAINT
      /* How tall the player should look on screen. 52 puts a 20 pixel body at about 60 screen
       * pixels on a 768 tall window. It matches the Maw's zoom, so islands and rooms show the
       * player at the same size. */
      const BODY_ON_GLASS = 52
      /* The close shot uses the same math with a bigger body: 94 pixels of the player on a 768 tall
       * window. Because it's worked out from body height, a map with 40 pixel people and a map with
       * 18 pixel people show the player at the same size. */
      const BODY_ON_GLASS_CLOSE = 94
      const bodyH = Math.max(6, map.character?.heightPx || 18)
      const Z_WALK = Math.max(
        Z_ISLAND,
        Math.round(((app.screen.height / 768) * BODY_ON_GLASS / bodyH) * 4) / 4,
      )
      /* The zoom the player walks in: the wide view, or the close camera if the student turned it
       * on. The setting is read on every call, so flipping it moves the camera right away. Close
       * never goes below Z, since zoomTo already clamps to Z_MIN on the other side. */
      const walkZ = () => (loadSettings().closeCamera ? Math.max(Z, zForBody(BODY_ON_GLASS_CLOSE)) : Z)
      const zForBody = (px: number) => Math.max(
        Z_ISLAND,
        Math.round(((app.screen.height / 768) * px / bodyH) * 4) / 4,
      )
      const Z = zOverride > 0 ? zOverride
        /* On an island the walking shot is sized to the player's body, and it never zooms out past
         * the island's own fit. Don't base it on Z_PAINT, because that depends on whether the
         * painting is squarer than the window. */
        : coastCut ? Math.max(Z_ISLAND, Z_WALK)
          /* In a room the zoom is a whole number, one step closer than the cover fit, so the
           * painting never sits on half pixels and no black shows around it. The small epsilon
           * stops a cover of 2.0000001 from rounding up to 3. */
          : Math.max(1, Math.ceil(fitCover - 1e-3) + 1)

      /* The base zoom that authored camera shots are multiples of. It's kept separate from the
       * walking zoom. */
      const Z_SHOT = coastCut ? Z_ISLAND : Math.max(1, Math.floor(fitIn * 2) / 2)

      /* The zoom used to watch a crossing. It's the walking zoom, so the ship is big enough to look
       * like a ship. */
      const Z_SHIP = Z

      /* How long the camera stays on the island when the ship arrives, before it follows the player
       * again. It's the length of the place card plus a short pause, since the card names the place
       * and the shot shows it. */
      const ARRIVAL_LOOK_MS = 3600

      /* The close-up shot, for when the camera is about the player instead of the place. */
      /* It's twice the walking zoom, which shows the player about 80 screen pixels tall, and the
       * camera follows the player around the room. */
      const Z_CLOSE = Z * 2
      world.scale.set(Z)

      /* The zoom is a live value that everything reads, and it can change after the map loads. */
      /* There's no separate sailing zoom floor to tune. An island is fenced to its painting plus a
       * margin of ocean, and Z_ISLAND is the zoom where that fence fills the window. */
      let camZ = Z
      /* Sailing uses this same floor, so a scripted voyage and steering by hand share one zoom. */
      /* The lowest zoom anything can use. On an island it's the fence, so a wide shot can show the
       * whole island with sea around it. In a room it's the painting, since there's nothing outside
       * a room to show. */
      const Z_MIN = coastCut ? Z_ISLAND : Math.max(Z_PAINT, Z)

      // The engine's ocean under the painting. Its tiles have to be much smaller than the painted
      // island, and a sprite pool draws only the tiles that are on screen.
      const SEA_SCALE = 0.5             // Half the module's 64x32 diamonds, in screen pixels.
      const waterS: SwellSprite[] = []
      let refreshSea: () => void = () => {}   // Set inside the if (coastCut) block below.
      let sea: Container | null = null
      /* Distance from the painting's own pixels. The sparkles, the ship and discovery all use it. */
      let paintDistPx: (x: number, y: number) => number = () => 1e6
      if (coastCut) {
        const waterV = await loadWaterVariants()
        // The 16 sea tiles the ocean helper loads, listed here so they count toward the cost of
        // opening the map.
        for (let i = 0; i < 16; i++) req(`/art/intro/water-n/${i}.png`)
        let waterFallback: Texture | undefined
        try { waterFallback = await Assets.load(req('/art/iso/water.png')) } catch { /* The water pools work without it. */ }

        // Distance to land, on a coarse grid of cells seeded from every solid pixel of the
        // painting. The grid only needs to cover the depth ramp, because past its edge distPx
        // returns a huge distance and the ramp is already at its deepest color.
        const CS = 8
        /* The grid is sized for the widest shot, so the shallow shelf never ends in a hard line. */
        const pad = Math.ceil((DEPTH_RANGE + 6) * HH * SEA_SCALE / Z_MIN)
        const sx0 = -pad, sy0 = -pad, sx1 = W + pad, sy1 = H + pad
        const gw = Math.ceil((sx1 - sx0) / CS), gh = Math.ceil((sy1 - sy0) / CS)
        const dist = new Float32Array(gw * gh).fill(-1)
        const q: number[] = []
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            if (sAlpha(x, y) <= A_MIN) continue
            const ci = Math.floor((y - sy0) / CS) * gw + Math.floor((x - sx0) / CS)
            if (dist[ci] !== 0) { dist[ci] = 0; q.push(ci) }
          }
        let head = 0
        while (head < q.length) {
          const i = q[head++]
          const cx = i % gw, cy = (i / gw) | 0, d = dist[i]
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nc = cx + dc, nr = cy + dr
            if (nc < 0 || nr < 0 || nc >= gw || nr >= gh) continue
            const ni = nr * gw + nc
            if (dist[ni] === -1) { dist[ni] = d + 1; q.push(ni) }
          }
        }
        const distPx = (x: number, y: number) => {
          const cx = Math.floor((x - sx0) / CS), cy = Math.floor((y - sy0) / CS)
          if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return (sx1 - sx0)
          const d = dist[cy * gw + cx]
          return d < 0 ? (sx1 - sx0) : d * CS
        }
        paintDistPx = distPx

        // Two sea containers: the animated swell ring around the coast, kept apart from the still
        // deep water.
        sea = new Container()
        sea.scale.set(SEA_SCALE)
        sea.sortableChildren = true
        const seaLayer = new Container()          // Still deep water.
        seaLayer.zIndex = -1
        seaLayer.sortableChildren = true
        seaLayer.isRenderGroup = true
        const seaLive = new Container()           // Animated ring around the coast.
        seaLive.zIndex = -0.9
        seaLive.sortableChildren = true
        sea.addChild(seaLayer, seaLive)
        app.stage.addChildAt(sea, 0)              // Always under the world.

        // The island's center in sea tile coordinates. The sea grows outward from here.
        const WORLD_R = 600     // Tiles of ocean in every direction.
        const ccx = W * Z / 2 / SEA_SCALE, ccy = H * Z / 2 / SEA_SCALE
        const CXs = (ccx / HW + ccy / HH) / 2, CYs = (ccy / HH - ccx / HW) / 2

        // Depth at a sea tile, based on its distance to the painted coast. It's dithered so the
        // depth bands don't form rings around the island.
        const h01 = (a: number, b: number) => {
          const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
          return s - Math.floor(s)
        }
        /* Uses the live zoom, because the sea only lines up with the painting at the current drawn
         * scale. */
        const dsAt = (tx: number, ty: number) => {
          const d = -(distPx(isoX(tx, ty) * SEA_SCALE / camZ, isoY(tx, ty) * SEA_SCALE / camZ) * camZ / SEA_SCALE) / HH
          return d < -2 ? d - h01(tx, ty) * 1.4 : d
        }

        const seaPool: Sprite[] = []       // Pool for the still water (seaLayer).
        const seaPoolL: Sprite[] = []      // Pool for the animated ring (seaLive).
        refreshSea = () => {
          if (!sea) return
          const vw = app.screen.width, vh = app.screen.height
          /* The sea keeps the same tile size on screen at every zoom, so the far-zoom branches
           * never run. */
          const blk = SEA_SCALE >= 0.5 ? 1 : SEA_SCALE >= 0.24 ? 2 : SEA_SCALE >= 0.11 ? 4 : 8
          const liveD = SEA_SCALE < 0.35 ? 14 : DEPTH_RANGE + 12
          // Convert the screen corners into sea coordinates. The sea pans along with the world.
          const wx0 = (0 - sea.x) / SEA_SCALE, wx1 = (vw - sea.x) / SEA_SCALE
          const wy0 = (0 - sea.y) / SEA_SCALE, wy1 = (vh - sea.y) / SEA_SCALE
          const txMin = Math.floor((wx0 / HW + wy0 / HH) / 2) - blk * 2
          const txMax = Math.ceil((wx1 / HW + wy1 / HH) / 2) + blk * 2
          const tyMin = Math.floor((wy0 / HH - wx1 / HW) / 2) - blk * 2
          const tyMax = Math.ceil((wy1 / HH - wx0 / HW) / 2) + blk * 2
          waterS.length = 0
          let used = 0, usedL = 0
          const place = (px: number, py: number, pd: number, pb: number) => {
            const live = pd > -liveD
            let sp: Sprite
            if (live) {
              sp = seaPoolL[usedL] ?? (seaPoolL[usedL] = seaLive.addChild(new Sprite()))
            } else {
              sp = seaPool[used] ?? (seaPool[used] = seaLayer.addChild(new Sprite()))
            }
            const m = configSeaTile(sp, px, py, pd, waterV, waterFallback, pb)
            if (!m) { sp.visible = false; return }
            sp.visible = true
            if (live) { waterS.push(m); usedL++ } else used++
          }
          const t0x = Math.floor(txMin / blk) * blk, t0y = Math.floor(tyMin / blk) * blk
          for (let by2 = t0y; by2 <= tyMax; by2 += blk) {
            for (let bx2 = t0x; bx2 <= txMax; bx2 += blk) {
              const mx = bx2 + (blk - 1) / 2, my = by2 + (blk - 1) / 2
              const ddx = mx - CXs, ddy = my - CYs
              if (ddx * ddx + ddy * ddy > WORLD_R * WORLD_R) continue
              const dsC = dsAt(mx, my)
              if (dsC > blk * 1.5 + 1) continue                 // All land here.
              if (blk === 1) { if (dsC <= 0) place(mx, my, dsC, 1); continue }
              // The deep water has a flat ramp, so big blocks look the same as small ones there.
              // The steep ring near the coast has to stay fine, or its depth values show steps at
              // block size.
              if (dsC < -(DEPTH_RANGE + blk * 1.5)) { place(mx, my, dsC, blk); continue }
              // The ramp ring and the shoreline are drawn at fine grain, so the coast and the depth
              // ramp keep their exact edges on every tile. At far zooms it uses every second tile
              // inside the ring.
              const fine = dsC < -(blk * 1.5 + 1) && blk >= 4 ? 2 : 1
              for (let ty2 = by2; ty2 < by2 + blk; ty2 += fine) {
                for (let tx2 = bx2; tx2 < bx2 + blk; tx2 += fine) {
                  const fx2 = tx2 + (fine - 1) / 2, fy2 = ty2 + (fine - 1) / 2
                  const d2 = dsAt(fx2, fy2)
                  if (d2 <= 0) place(fx2, fy2, d2, fine)
                }
              }
            }
          }
          for (let i = used; i < seaPool.length; i++) seaPool[i].visible = false
          for (let i = usedL; i < seaPoolL.length; i++) seaPoolL[i].visible = false
        }
      }

      /* The painting itself. It sits over the sea and under everything alive, and it's built from
       * the image that's already loaded. */
      /* skipCache is on because the cache key would be the Image, and it would never be removed. */
      const sceneT: Texture = Texture.from(sceneImg, true)
      sceneT.source.scaleMode = 'nearest'
      const base = new Sprite(sceneT)
      base.zIndex = 0
      world.addChild(base)

      // Occluders follow MAPVIS's rule. Each one is cut from the painting's own pixels and sorted
      // at its exported baseline, so it covers the character only while the character's feet are
      // above that baseline.
      if (odata) {
        for (const o of map.occluders) {
          const cv = document.createElement('canvas'); cv.width = W; cv.height = H
          const g = cv.getContext('2d')!
          const im = g.createImageData(W, H)
          let n = 0
          for (let i = 0; i < W * H; i++) {
            if (odata[i * 4] !== o.id) continue
            im.data[i * 4] = sdata[i * 4]
            im.data[i * 4 + 1] = sdata[i * 4 + 1]
            im.data[i * 4 + 2] = sdata[i * 4 + 2]
            im.data[i * 4 + 3] = sdata[i * 4 + 3]
            n++
          }
          if (!n) continue
          g.putImageData(im, 0, 0)
          const t = Texture.from(cv)
          t.source.scaleMode = 'nearest'
          const sp = new Sprite(t)
          // Lifted into the player's draw band by the same amount, so an occluder still hides the
          // player when it should.
          sp.zIndex = OVER_PLACED + o.baseline
          world.addChild(sp)
        }
      }

      // Placed assets: pictures taken out of the map so they can move, anchored at their feet.
      /* One appearance as it comes in the file: a plain src, a list of frames, or a set of
       * headings. */
      /* The atlas fields that sit beside the paths: a rectangle on the packed sheet for each frame. */
      type Rect = [number, number, number, number]
      interface PmapLook {
        src?: string; frames?: string[]; fps?: number; dirs?: Record<string, string[]>
        srcAt?: Rect; framesAt?: Rect[]; dirsAt?: Record<string, Rect[]>
      }
      interface PmapAsset extends PmapLook {
        id: string; group: string
        /* What the author named this thing. It's the only way a member's Python can refer to it. */
        name?: string
        x: number; y: number; scale: number
        // The MAPVIS transform rules: separate x and y scale, rotation around the feet, and flips
        // stored as negative scale.
        scaleX?: number; scaleY?: number; rot?: number; flipX?: boolean; flipY?: boolean
        /* How it moves, if it moves: the numbers life.ts reads straight from the editor. It's typed
         * unknown on purpose, because cleanLife is the only code that knows the shape and has to
         * reject a bad one. */
        life?: unknown
        /* The extra appearances a sequence can switch to, from index 1 up. */
        looks?: PmapLook[]
      }
      // One appearance, loaded. Every texture is ready before the sprite is added, so switching
      // pictures in the middle of a round costs nothing.
      interface Look { frames: Texture[]; views: Record<string, Texture[]> | null; fps: number }
      const animAssets: { sp: Sprite; frames: Texture[]; fps: number; t: number }[] = []
      const lifeAssets: { sp: Sprite; life: Life; home: { x: number; y: number }; baseSX: number; bodyW: number; flipX: boolean; looks: Look[]; animT: number; baseRot: number }[] = []
      /* The standing placements a mover has to walk around, meaning the ones something can reach. */
      /* The name comes along so a warning can say which figure was left walkable. Without it,
       * nobody could find the figure to fix in MAPVIS. */
      const standing: { x: number; y: number; r: number; name?: string }[] = []
      const obstacles: { x: number; y: number; r: number; name?: string }[] = []
      try {
        const ar = await fetch(req(`${dir}/assets.json`))
        // Check the content type. The dev server answers a missing file with the app's index.html
        // and a 200, so only a real JSON body means the bundle has assets.
        if (ar.ok && (ar.headers.get('content-type') || '').includes('json')) {
          const aj: { assets?: PmapAsset[]; atlas?: string } = await ar.json()
          let placed = 0
          /* The atlas sheet, downloaded once. The loose PNGs are the fallback. */
          let sheet: TextureSource | null = null
          if (aj.atlas) {
            try {
              const at: Texture = await Assets.load(req(`${dir}/${aj.atlas}`))
              at.source.scaleMode = 'nearest'
              sheet = at.source
            } catch (e) {
              console.warn(`[pmap] the atlas ${aj.atlas} would not load, falling back to one request per frame`, e)
            }
          }
          /* One frame of the sheet as a texture, cached by rectangle so a shared picture is only
           * made once. */
          const cells = new Map<string, Texture>()
          const cellOf = (r: Rect, src: TextureSource): Texture => {
            const key = `${r[0]},${r[1]},${r[2]},${r[3]}`
            const hit = cells.get(key)
            if (hit) return hit
            const t = new Texture({ source: src, frame: new Rectangle(r[0], r[1], r[2], r[3]) })
            cells.set(key, t)
            return t
          }
          /* One frame, taken from the sheet when there's a rectangle for it, or from the loose PNG
           * otherwise. */
          const frameOf = async (u: string, r?: Rect): Promise<Texture> => {
            if (r && sheet) return cellOf(r, sheet)
            const t: Texture = await Assets.load(req(`${dir}/${u}`))
            t.source.scaleMode = 'nearest'
            return t
          }
          /* Loads one appearance. This covers the placement itself and every extra look it switches
           * to. */
          const loadLook = async (s: PmapLook): Promise<Look | null> => {
            const listed = !!(s.frames && s.frames.length)
            const srcs = listed ? s.frames! : s.src ? [s.src] : []
            if (!srcs.length) return null
            /* The rectangles match up with the paths by index, so if only part of the sheet was
             * packed, each frame falls back on its own. */
            const rects: (Rect | undefined)[] = listed ? (s.framesAt ?? []) : s.srcAt ? [s.srcAt] : []
            const frames: Texture[] = await Promise.all(srcs.map((u, i) => frameOf(u, rects[i])))
            /* Views: the frames for each heading, for something that faces the way it walks. */
            let views: Record<string, Texture[]> | null = null
            if (s.dirs && Object.keys(s.dirs).length) {
              views = {}
              for (const [k, arr] of Object.entries(s.dirs)) {
                if (!Array.isArray(arr)) continue
                // Empty entries are dropped from both lists together, so no rectangle shifts onto
                // the wrong frame.
                const dr = s.dirsAt?.[k]
                const pairs = arr.map((u, i) => [u, dr?.[i]] as const).filter(([u]) => !!u)
                if (!pairs.length) continue
                const ts: Texture[] = await Promise.all(pairs.map(([u, r]) => frameOf(u, r)))
                views[k] = ts
              }
            }
            // The 6 matches MAPVIS (editor.ts assetFrame) for a view set, which never has an fps
            // saved. A plain frame list keeps 4.
            return { frames, views, fps: s.fps || (views ? 6 : 4) }
          }
          for (const a of aj.assets ?? []) {
            try {
              const look0 = await loadLook(a)
              if (!look0) { console.warn(`[pmap] asset "${a.id}" lists no src and no frames, skipped`); continue }
              const frames = look0.frames
              const views = look0.views
              const srcs = a.frames && a.frames.length ? a.frames : a.src ? [a.src] : []
              /* Every look is loaded up front. One that fails still keeps its slot, so the indexes
               * stay correct. */
              const looks: Look[] = [
                look0,
                ...(await Promise.all(
                  (a.looks ?? []).map(async (L, i) => {
                    try {
                      const lk = await loadLook(L)
                      if (lk) return lk
                      console.warn(`[pmap] asset "${a.id}" look ${i + 1} lists no src and no frames, using its first picture`)
                    } catch (e) {
                      console.warn(`[pmap] asset "${a.id}" look ${i + 1} failed to load, using its first picture`, e)
                    }
                    return look0
                  }),
                )),
              ]
              const sp = new Sprite(frames[0])
              sp.anchor.set(0.5, 1)
              sp.position.set(a.x, a.y)
              // The full transform is anchored at the feet. Flips are negative scale, so the anchor
              // and the y-sort key never move.
              const asx = Number(a.scaleX) > 0 ? Number(a.scaleX) : a.scale
              const asy = Number(a.scaleY) > 0 ? Number(a.scaleY) : a.scale
              sp.scale.set(asx * (a.flipX ? -1 : 1), asy * (a.flipY ? -1 : 1))
              sp.rotation = Number(a.rot) || 0
              /* Depth is its y plus the author's nudge, using depthOf from above. */
              sp.zIndex = depthOf(a)
              world.addChild(sp)
              if (depthOf(a) !== a.y) depthBias.set(sp, depthOf(a) - a.y)
              /* It can be looked up by its MAPVIS id and by the name its author typed. */
              placedById.set(a.id, sp)
              if (a.name) placedById.set(a.name, sp)
              /* Every look this thing has, stored per sprite so a script can ask for one by index.
               * A state is the same placement wearing a different picture. */
              looksOf.set(sp, looks)
              /* Look names come from the flat lookNames list that MAPVIS publishes. The game never
               * sees lookName or looks[].name, which are only used while authoring. The literal
               * string "undefined" is dropped, because older bundles store it for every unnamed
               * look and actor_look(x, "undefined") would then match a real picture. */
              {
                const raw = a as unknown as {
                  lookNames?: unknown; lookName?: unknown; looks?: { name?: unknown }[]
                }
                const flat = Array.isArray(raw.lookNames)
                  ? raw.lookNames.map((n) => (typeof n === 'string' ? n : ''))
                  : null
                const named = (flat ?? [
                  typeof raw.lookName === 'string' ? raw.lookName : '',
                  ...(raw.looks ?? []).map((L) => typeof L?.name === 'string' ? L.name : ''),
                ]).map((n) => (n === 'undefined' ? '' : n))
                if (named.some(Boolean)) lookNamesOf.set(sp, named)
              }
              // A moving placement stores a few numbers instead of frames, and the ticker moves it
              // each frame.
              const lf = cleanLife(a.life)
              /* Warns when a sequence state names its art instead of using an index, because that
               * freezes it. */
              const rawStates = (a.life as { states?: unknown } | null)?.states
              const badArt = (Array.isArray(rawStates) ? (rawStates as { art?: unknown }[]) : [])
                .find((s) => s && s.art != null && !Number.isFinite(Number(s.art)))
              if (badArt) console.warn(`[pmap] asset "${a.id}" has a sequence state whose art is "${String(badArt.art)}" and not an index, so it will draw its first picture throughout. Re-export the map from MAPVIS.`)
              /* A sprite's frames are run by one thing only. Still placements go in animAssets
               * here, and moving ones cycle their frames in the life pass. */
              if (frames.length > 1 && !lf) animAssets.push({ sp, frames, fps: look0.fps, t: Math.random() * frames.length })
              if (lf) {
                // Things in the air fly over the map instead of sorting into it.
                if (lf.airborne) sp.zIndex = 99000 + (depthOf(a) | 0)
                // Its frames run on their own clock, started at a random point so two copies of one
                // figure don't step in sync and look like one thing.
                /* Its body width, measured once from look 0's drawn pixels instead of the canvas. */
                lifeAssets.push({ sp, life: lf, home: { x: a.x, y: a.y }, baseSX: Math.abs(asx), bodyW: Math.abs(asx) * inkOf(frames[0]), flipX: !!a.flipX, looks, animT: Math.random() * 8, baseRot: Number(a.rot) || 0 })
              } else {
                // It stays where it was put, so whether movers walk around it depends only on the
                // fences near it, and that never changes. It uses the same body width the movers
                // use.
                standing.push({ x: a.x, y: a.y, r: bodyRadius(Math.abs(asx) * inkOf(frames[0])), name: a.id ?? a.name })
                if (views) {
                  /* A view set that never travels still has frames worth playing, facing its own
                   * heading. */
                  const rest =
                    Object.keys(views).find((k) => (srcs[0] || '').endsWith(k + '-0.png')) ||
                    (views.south ? 'south' : Object.keys(views)[0])
                  const set = views[rest]
                  if (set && set.length > 1)
                    animAssets.push({ sp, frames: set, fps: look0.fps, t: Math.random() * set.length })
                }
              }
              placed++
            } catch (e) {
              console.warn(`[pmap] asset "${a.id}" failed to load, skipped`, e)
            }
          }
          if (placed) console.log(`[pmap] ${placed} placed assets (${animAssets.length} animated)`)
        }
      } catch { /* Fetch failed. Same as a 404: no assets. */ }

      /* A driven body steps through its look's frames based on distance traveled, so it doesn't
       * slide across the room standing still. The walk art is read from this repo by the
       * placement's own name, so it works on maps already published. A body with no walk art stays
       * as it is. */
      const gaitOf = new Map<Sprite, Look>()
      {
        /* The folder a body's walk art is in, for art that isn't named the same as the placement.
         * Art filed under the placement's own name doesn't need a row here. */
        const GAIT_ART: Record<string, string> = { principal_desk: 'principal' }
        const gaitPath = (folder: string, dir: string, i: number) =>
          `/art/characters/${folder}/walk/${dir}/${i}.png`
        /* Counts how many frames the set really has, using HEAD requests once so a body with no
         * walk art doesn't cost a 404 every frame. Check the content type too, because the dev
         * server answers an unknown path with index.html and a 200, so checking ok alone counts
         * frames that don't exist. */
        const countFrames = async (folder: string): Promise<number> => {
          let n = 0
          while (n < 12) {
            const r = await fetch(gaitPath(folder, 'south', n), { method: 'HEAD' }).catch(() => null)
            if (!r || !r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) break
            n++
          }
          return n
        }
        const loadGait = async (sp: Sprite, folder: string) => {
          const n = await countFrames(folder)
          if (n < 2) return
          const views: Record<string, Texture[]> = {}
          for (const dir of DIRS8) {
            try {
              const ts = await Promise.all(
                Array.from({ length: n }, (_, i) => Assets.load(gaitPath(folder, dir, i)) as Promise<Texture>),
              )
              for (const t of ts) t.source.scaleMode = 'nearest'
              views[dir] = ts
            } catch { /* A heading is missing. The set is refused below. */ }
          }
          /* Refuse the whole set if any heading is missing. A body facing a heading it has no
           * picture for falls back to south and moonwalks across the room. */
          if (Object.keys(views).length < DIRS8.length) {
            console.warn(`[pmap] "${folder}" walk art covers ${Object.keys(views).length}/8 headings, not used`)
            return
          }
          gaitOf.set(sp, { frames: views.south, views, fps: 6 })
        }
        /* Every name a script can drive, instead of a hardcoded list. Only anchors can be driven,
         * so this costs at most a dozen HEAD requests even on a busy map (the hub has 94 placements
         * and one anchor). Art filed under the anchor's own name needs no row in this repo. */
        /* Find the sprite the same way actorBody does, through the anchor's bound placement.
         * placedById is keyed by the placement's id and its author's name, so looking a sprite up
         * by the anchor's name finds nothing and the walk never loads. */
        const drivable = new Map<string, Sprite>()
        for (const a of anchors.all) {
          const sp = a.placement ? placedById.get(a.placement) : undefined
          if (sp) drivable.set(a.name, sp)
        }
        for (const [name, folder] of Object.entries(GAIT_ART)) {
          const sp = placedById.get(name) ?? drivable.get(name)
          if (sp) drivable.set(name, sp)
          void folder
        }
        /* A walk carried in the map itself wins over one filed in this repo. If a placement has a
         * second look called walk, its gait is already in the bundle, so giving a host a walk only
         * takes a MAPVIS edit and a republish. */
        const carried = (sp: Sprite): Look | undefined => {
          const names = lookNamesOf.get(sp)
          const set = looksOf.get(sp)
          if (!names || !set) return undefined
          const i = names.findIndex((n) => n === 'walk' || n === 'walking')
          const look = i > 0 ? set[i] : undefined
          if (!look) return undefined
          /* Same refusal as loadGait, for the same reason. A walk missing a heading turns into a
           * moonwalk as soon as the body faces that way. */
          const have = Object.keys(look.views ?? {}).length
          if (have < DIRS8.length) {
            console.warn(`[pmap] the "walk" face on a driven body covers ${have}/8 headings, not used`)
            return undefined
          }
          return look
        }
        /* Only something that looks like a body is asked whether it has a walk, since every anchor
         * can be driven. */
        const looksLikeABody = (sp: Sprite): boolean => {
          const set = looksOf.get(sp)
          const views = set?.[0]?.views
          return !!views && Object.keys(views).length >= 4
        }
        const needArt: [string, Sprite][] = []
        for (const [name, sp] of drivable) {
          const own = carried(sp)
          if (own) { gaitOf.set(sp, own); continue }
          if (looksLikeABody(sp) || name in GAIT_ART) needArt.push([name, sp])
        }
        await Promise.all(
          needArt.map(([name, sp]) => loadGait(sp, GAIT_ART[name] ?? name)),
        )
      }

      /* Anchors tied to a placement now ask the sprite where it is on each frame. */
      anchors.follow((ref) => {
        const sp = placedById.get(ref)
        return sp ? { x: sp.x, y: sp.y } : null
      })

      /* Works out which standing placements anything can really reach. This runs once, after every
       * mover has loaded. */
      {
        const free = lifeAssets.filter((q) => !q.life.walkOnly)
        /* Nothing is made solid on a doorway or a spawn point. A figure stamped into the floor
         * right next to a door can turn into a wall across the entrance, and a torch drawn beside a
         * door must never lock a student out of an island. */
        const mouths = [
          ...anchors.all.filter((a) => a.kind === 'door' || a.kind === 'spawn')
            .map((a) => anchors.standAt(a)),
          { x: map.spawn[0], y: map.spawn[1] },
        ]
        const onAMouth = (q: { x: number; y: number; r: number }) =>
          mouths.some((m) => Math.hypot(m.x - q.x, (m.y - q.y) / (map.yScale || 1))
            <= q.r + HIP + BODY_MIN)
        for (const s of standing) {
          if (onAMouth(s)) {
            console.log(`[pmap] ${mapId}: ${s.name ?? 'a figure'} stands on a way in, `
              + 'so it is left walk-through rather than walling the door')
            continue
          }
          if (
            walkerCanReach(s.x, s.y, s.r, map.yScale, canStand) ||
            free.some((q) => freeReach(s.x, s.y, s.r, map.yScale, q.life.bounds))
          )
            obstacles.push(s)
        }
      }

      /* Standing figures are stamped into the floor, so the same walking rules keep everything out
       * of them. */
      let floored = 0
      if (obstacles.length) {
        const ys = map.yScale || 1
        const blocked = map.encoding.blocked
        /* The anchors a body has to be able to reach, each with its own radius plus a body's width
         * of clearance. Nothing gets stamped on them or right up against them. */
        /* Keep clear the spot a body stands at, from standAt, instead of the anchor's own pixel. A
         * clear zone around the anchor's pixel can be wider than the thing itself (a trophy plinth
         * has a radius of 20), and then the thing never becomes solid. */
        const keepClear = anchors.all
          .filter((a) => a.kind !== 'region' && a.kind !== 'trigger')
          .map((a) => {
            const at = anchors.standAt(a)
            return { x: at.x, y: at.y, r: Math.max(a.r, 8) + HIP + BODY_MIN }
          })
        /* The flood fill uses the real walking rules, hips and all, so it only reaches places a
         * body can. */
        const reach = (from: { x: number; y: number }) => {
          const seen = new Uint8Array(W * H)
          const q = new Int32Array(W * H)
          let head = 0, tail = 0, n = 0
          const push = (x: number, y: number, fromLvl: number) => {
            if (x < 0 || y < 0 || x >= W || y >= H) return
            const i = y * W + x
            if (seen[i] || !canStandFrom(x, y, fromLvl)) return
            seen[i] = 1; q[tail++] = i; n++
          }
          const sx = Math.round(from.x), sy = Math.round(from.y)
          push(sx, sy, lvlAt(sx, sy))
          while (head < tail) {
            const i = q[head++]
            const x = i % W, y = (i / W) | 0
            const l = lvlAt(x, y)
            push(x + 1, y, l); push(x - 1, y, l); push(x, y + 1, l); push(x, y - 1, l)
          }
          return { n, seen }
        }
        /* Start from the map's own spawn point, because the question is about the map and not this
         * visit. If the spawn is blocked, use the first open pixel. */
        let start = { x: map.spawn[0], y: map.spawn[1] }
        if (ldata[(Math.round(start.y) * W + Math.round(start.x)) * 4] === blocked) {
          outer: for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (ldata[(y * W + x) * 4] !== blocked) { start = { x, y }; break outer }
          }
        }
        /* What the floor can reach right now. This baseline is updated after each figure is stamped
         * in, so each figure is judged only on whether it shuts someone out by itself. */
        let before = reach(start)

        /* Stamp one figure at a time, and take back out only the one that causes a problem.
         * Measuring all of them in one pass would fail every figure because of one awkward one. */
        const measure = (): { lost: number; cutOff: Anchor[] } => {
          const after = reach(start)
          return {
            lost: before.n ? 1 - after.n / before.n : 0,
            cutOff: anchors.all.filter((a) => {
              if (a.kind === 'region' || a.kind === 'trigger') return false
              const p = anchors.standAt(a)
              /* A door is something the player walks into, and a thing like a plinth is something
               * the player stands beside. A door needs its own standing spot to stay reachable,
               * because the player has to arrive on it to open it. A plinth only needs some way to
               * get next to it. */
              if (a.kind !== 'door' && a.kind !== 'spawn') {
                const reach = Math.max(a.r, 8) + HIP + BODY_MIN
                let stillThere = false
                for (let rr = 0; rr <= reach && !stillThere; rr += 4) {
                  for (let k = 0; k < 16; k++) {
                    const ang = (k / 16) * Math.PI * 2
                    const qx = Math.round(p.x + Math.cos(ang) * rr)
                    const qy = Math.round(p.y + Math.sin(ang) * rr * ys)
                    if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue
                    if (after.seen[qy * W + qx] === 1) { stillThere = true; break }
                  }
                }
                return !stillThere
              }
              /* No anchor gets a pass here, because stamp keeps a body's width clear around every
               * standing spot. */
              const i = Math.round(p.y) * W + Math.round(p.x)
              if (i < 0 || i >= W * H) return false
              return before.seen[i] === 1 && after.seen[i] === 0
            }),
          }
        }
        const refused: string[] = []
        let lost = 0
        /* Shrink a figure instead of giving up on it. Each one is tried at full width, then three
         * quarters, then half. Figures can stand close together (about 20 pixels apart in ATC), and
         * stamping one at full width can close the gap to the next. */
        const stamp = (s: { x: number; y: number; r: number }, scale: number, pad = 0): number[] => {
          const undo: number[] = []
          /* Only the ground under the figure is stamped, never the air its head is in. That's the
           * same idea the drawn-width measurement uses for the push pass. */
          const rx = Math.max(1, s.r * scale + pad), ry = Math.max(1, (s.r * scale + pad) * ys)
          for (let y = Math.ceil(s.y - ry); y <= Math.floor(s.y + ry); y++) {
            for (let x = Math.ceil(s.x - rx); x <= Math.floor(s.x + rx); x++) {
              if (x < 0 || y < 0 || x >= W || y >= H) continue
              const ex = (x - s.x) / rx, ey = (y - s.y) / ry
              if (ex * ex + ey * ey > 1) continue
              const i = (y * W + x) * 4
              if (ldata[i] === blocked) continue                    // Already a wall.
              /* A figure's own anchor only keeps a body's width clear, while every other anchor
               * keeps its full clearance. The full r + hip + body ring would sit inside the figure
               * and stop anything from being stamped. Clearing nothing would cover the spot a body
               * has to stand on, and scripts then fail with "no route for host to the_desk". */
              const own = (k: { x: number; y: number; r: number }) =>
                Math.hypot(k.x - s.x, (k.y - s.y) / ys) <= s.r
              if (keepClear.some((k) => Math.hypot(k.x - x, (k.y - y) / ys)
                <= (own(k) ? HIP + BODY_MIN : k.r))) continue
              undo.push(i, ldata[i])
              ldata[i] = blocked
            }
          }
          return undo
        }
        const putBack = (undo: number[]) => {
          for (let k = 0; k < undo.length; k += 2) ldata[undo[k]] = undo[k + 1]
        }
        /* Checks what a full-width stamp would shut off, so the warning can name it. */
        const measureAfter = (s: { x: number; y: number; r: number }): string[] => {
          const undo = stamp(s, 1)
          const m = measure()
          putBack(undo)
          return m.cutOff.map((a2) => a2.name)
        }

        for (const s of obstacles) {
          let done = false
          for (const scale of [1, 0.75, 0.5]) {
            /* Test with the figure grown by a body's width, then stamp it at its own size. The
             * flood fill can squeeze through a 2 pixel gap that the player can't, so testing at
             * real size lets figures block walks that authors drew through. */
            const probe = stamp(s, scale, HIP + BODY_MIN)
            const roomy = measure()
            putBack(probe)
            if (roomy.cutOff.length || roomy.lost > 0.25) continue
            const undo = stamp(s, scale)
            /* A stamp that covered no pixels doesn't count, so try the next size. */
            if (!undo.length) continue
            const m = measure()
            /* Undo the stamp if it cuts off any anchor or if more than a quarter of the walkable
             * ground would be lost. */
            if (m.cutOff.length || m.lost > 0.25) { putBack(undo); continue }
            floored += undo.length / 2
            lost = m.lost
            done = true
            /* This figure is in the floor now, so the next one is measured against it. */
            before = reach(start)
            if (scale < 1) {
              console.log(`[pmap] ${mapId}: ${s.name ?? 'a figure'} is solid at `
                + `${Math.round(scale * 100)}% of its width, because its full one shut something off`)
            }
            break
          }
          if (!done) {
            /* Name both sides in the warning. "The desk shuts the president off" is something an
             * author can fix in MAPVIS, and "a figure shut something off" isn't. */
            const why = measureAfter(s)
            refused.push(`${s.name ?? 'a figure'}${why.length ? ` (shuts off ${why.join(', ')})` : ''}`)
          }
        }
        if (refused.length) {
          console.warn(`[pmap] ${mapId}: ${refused.length} of ${obstacles.length} standing figures`
            + ` are not in the floor, because each of them shut something off: ${refused.join(', ')}.`
            + ` Those ones can still be walked through; the rest are solid.`)
          engine.log('floor_stamp_refused', { map: mapId, figures: obstacles.length, refused })
        }
        if (DBG || floored) {
          console.log(`[pmap] ${obstacles.length - refused.length} of ${obstacles.length} standing`
            + ` figures put in the floor (${floored} px, ${(lost * 100).toFixed(1)}% of the ground)`)
        }
      }

      // ---- &dbg=1: the levels mask, color-coded per level value, over the painting ----
      if (DBG) {
        const enc = map.encoding
        const colOf: Record<number, [number, number, number, number]> = {
          [enc.blocked]: [239, 68, 68, 64],
          [enc.L0]: [46, 204, 113, 116],
          [enc.ramp01]: [163, 230, 53, 116],
          [enc.L1]: [250, 204, 21, 116],
          [enc.ramp12]: [251, 146, 60, 116],
          [enc.L2]: [244, 114, 182, 116],
          [enc.ramp23]: [167, 139, 250, 116],
          [enc.L3]: [96, 165, 250, 116],
        }
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H
        const g = cv.getContext('2d')!
        const im = g.createImageData(W, H)
        for (let i = 0; i < W * H; i++) {
          // A level value that isn't in the list shows as magenta, so a bad export is easy to see.
          const c = colOf[ldata[i * 4]] ?? [255, 0, 255, 116]
          im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = c[3]
        }
        g.putImageData(im, 0, 0)
        const t = Texture.from(cv)
        t.source.scaleMode = 'nearest'
        const overlay = new Sprite(t)
        overlay.zIndex = 8e5
        world.addChild(overlay)
      }

      // The player's walk frames, sized from map.json and trimmed so the anchor really sits at the
      // feet.
      const walkT: Record<string, Texture[]> = {}
      /* The outfit the player is wearing. walkFrame returns the plain panther's path until outfit
       * art exists, so this works with no outfit art on disk and picks up the jacket once its
       * folder is added. thorWear.ts explains why an outfit is a full set of frames instead of a
       * layer. */
      await Promise.all(DIRS8.map(async (d) => {
        walkT[d] = await Promise.all([0, 1, 2, 3, 4, 5]
          .map((i) => Assets.load(req(walkFrame(loadSave(), d, i)))))
        for (const t of walkT[d]) t.source.scaleMode = 'nearest'
      }))

      /* Print what opening this map cost, split into the bundle's files and the engine's art. */
      {
        // Split on /art/ instead of on dir, because the platform manifest is fetched one level
        // above the version prefix and still counts as the map's cost.
        const art = [...asked].filter((u) => u.startsWith('/art/')).length
        const real = performance.getEntriesByType('resource').length - netAtStart
        console.log(
          `[pmap] ${mapId}: ${asked.size} request(s) to open, ${asked.size - art} of them the map ` +
          `and ${art} engine art. The browser recorded ${real}.`,
        )
      }

      const rig = scanRows(walkT.south[0])
      // The player is drawn smaller than the editor's character height, because the YOU marker is
      // what helps people find the player. Adding ?ch=N to the URL changes it.
      const charH = Number(params.get('ch') || 0) || Math.max(8, Math.round(map.character.heightPx * 0.6))
      const thorScale = charH / (rig ? rig.feet - rig.top + 1 : 67)
      // Twice the editor's walking speed by default. Adding ?spd=F to the URL changes the factor.
      const SPD = map.speed * (Number(params.get('spd') || 0) || 2)
      /* Divides out walk.ts's test speed factor, so the player walks at this scene's own speed. */
      cfg.speed = SPD / TEST_SPEED
      for (const d of DIRS8) {
        walkT[d] = walkT[d].map((t) => {
          const r = scanRows(t)
          return r ? new Texture({ source: t.source, frame: new Rectangle(0, 0, t.source.pixelWidth, r.feet + 1) }) : t
        })
      }
      /* The shirt color is redrawn pixel by pixel instead of tinted. thorLook.ts shifts the hue of
       * the shirt pixels only, which a tint can't do because it multiplies the whole image and
       * would change the fur too. That costs 48 small canvases once at load, and the subscription
       * below catches a change made while the map is open. */
      const walkArt: Record<string, Texture[]> = {}
      /* The held poses, both dyed and as painted. They're declared up here because dressThor below
       * reads them right away, and a const declared further down the same scope can't be used
       * before its line runs. */
      const poseTex = new Map<string, Texture>()
      const poseSrc = new Map<string, Texture>()
      let drawnLook: string | null = null
      /** Runs one frame through the shirt recolor and keeps its trim. */
      const dye = (t: Texture): Texture => {
        const src = t.source.resource as CanvasImageSource & { width: number; height: number }
        /* If a frame's pixels can't be read, leave it as painted instead of dropping it. A missing
         * shirt color is better than a missing character. */
        if (!src) return t
        try {
          const cv = document.createElement('canvas')
          drawRecolored(cv, src, lookHue(drawnLook ?? undefined))
          const out = Texture.from(cv)
          out.source.scaleMode = 'nearest'
          return new Texture({ source: out.source, frame: t.frame.clone() })
        } catch { return t }
      }
      const dressThor = (look: string | undefined) => {
        const hue = lookHue(look)
        const key = look ?? 'classic'
        if (drawnLook === key) return
        drawnLook = key
        for (const d of DIRS8) walkArt[d] = hue === null ? walkT[d] : walkT[d].map(dye)
        /* Dye the poses too. The player sits at the fire and lies down using held poses from a
         * different folder, so dyeing only the walk frames would turn the player back to teal the
         * moment they stop. */
        for (const [file, t] of poseSrc) poseTex.set(file, hue === null ? t : dye(t))
      }
      dressThor(loadSave()?.thorLook)

      /* Changing outfits means loading new art from the network, while changing the shirt color
       * only recolors frames already in memory. The check on both keys matters, because writeSave
       * fires on every position save and would otherwise rebuild 48 textures several times a second
       * while the player walks. */
      let wornNow = wornKey(loadSave())
      const redress = async () => {
        const s2 = loadSave()
        const key = wornKey(s2)
        if (key === wornNow) return
        const outfitChanged = key.split(':')[0] !== wornNow.split(':')[0]
        wornNow = key
        if (outfitChanged) {
          /* A new outfit is different art, so the frames are fetched again and the trim that finds
           * the feet is redone on the new pixels. */
          const fresh: Record<string, Texture[]> = {}
          await Promise.all(DIRS8.map(async (d) => {
            const got = await Promise.all([0, 1, 2, 3, 4, 5]
              .map((i) => Assets.load(req(walkFrame(s2, d, i)))))
            fresh[d] = got.map((t) => {
              t.source.scaleMode = 'nearest'
              const r = scanRows(t)
              return r ? new Texture({ source: t.source, frame: new Rectangle(0, 0, t.source.pixelWidth, r.feet + 1) }) : t
            })
          }))
          if (destroyed) return
          for (const d of DIRS8) walkT[d] = fresh[d]
          /* A held pose is art too, so the cache is cleared and poses reload when they're next
           * needed. */
          poseTex.clear()
          poseSrc.clear()
        }
        /* Then put the shirt color on whichever set is now loaded. */
        drawnLook = null
        dressThor(s2?.thorLook)
      }
      offLook = subscribeSave(() => { void redress() })

      /* The camera follows the close camera switch. The toggle writes a setting instead of the
       * save, so it has its own event. Only the walking shot moves, because a student flipping the
       * switch during a cutscene doesn't want to leave it. */
      offCamera = onSettings(() => {
        if (movieOn || lastShot === 'island' || hull) return
        zoomTo(walkZ())
      })

      /* Where the middle of the player's drawn body is for each heading, so the YOU marker sits
       * right over the player. */
      const pinDx: Record<string, number> = {}
      /* The same scan kept as edge positions, so a test harness can check that the marker is really
       * centered. */
      const pinInk: Record<string, { l: number; r: number }> = {}
      for (const d of DIRS8) {
        const t0 = walkT[d][0]
        const band = scanCols(t0, 0, t0.source.pixelHeight - 1)
        const half = t0.source.pixelWidth / 2
        pinDx[d] = band ? ((band.left + band.right + 1) / 2 - half) * thorScale : 0
        pinInk[d] = band
          ? { l: (band.left - half) * thorScale, r: (band.right + 1 - half) * thorScale }
          : { l: 0, r: 0 }
      }
      const shadTex = radial(64, [[0, 'rgba(6,10,14,0.85)'], [0.65, 'rgba(6,10,14,0.35)'], [1, 'rgba(6,10,14,0)']])
      const sh = new Sprite(shadTex)
      sh.anchor.set(0.5); sh.width = 30 * thorScale; sh.height = 11 * thorScale; sh.alpha = 0.35
      world.addChild(sh)
      const thorSp = new Sprite(walkT.south[0])
      thorSp.anchor.set(0.5, 1)
      thorSp.scale.set(thorScale)
      world.addChild(thorSp)
      // The player's heading and stride live on the Walker, because the code that moves the player
      // decides both.
      const thor = { sp: thorSp, sh }

      /* The poses the player can hold, as a named table a member can call pose("sit") with. */
      const POSE_ART: Record<string, string | null> = {
        stand: null, idle: null, up: null,
        sleep: 'lie', lie: 'lie', asleep: 'lie',
        sit: 'sit', seated: 'sit',
      }
      const loadPose = async (file: string): Promise<Texture> => {
        const had = poseTex.get(file)
        if (had) return had
        const t: Texture = await Assets.load(req(poseFrame(loadSave(), file)))
        t.source.scaleMode = 'nearest'
        const r = scanRows(t)
        const cut = r ? new Texture({ source: t.source, frame: new Rectangle(0, 0, t.source.pixelWidth, r.feet + 1) }) : t
        poseSrc.set(file, cut)
        const worn = lookHue(drawnLook ?? undefined) === null ? cut : dye(cut)
        poseTex.set(file, worn)
        return worn
      }
      /* What pose the player is holding, or null for the walk frames. The ticker reads it, and
       * that's the only place the player's texture gets picked, so a pose can't fight the walk
       * animation. */
      let posed: { name: string; tex: Texture } | null = null
      /* Where the player was when the pose was set. Comparing positions tells whether the player
       * really moved, since a player pushing into a wall is holding a key without going anywhere. */
      const poseAt = { x: 0, y: 0 }

      // Check the spawn point, because a mask edit can cover the exported point. If it isn't
      // standable, spiral outward to the nearest ground that is.
      const findGround = (sx: number, sy: number): [number, number] => {
        if (canStand(sx, sy)) return [sx, sy]
        for (let r = 8; r <= 400; r += 8)
          for (let a = 0; a < 16; a++) {
            const x = sx + Math.cos(a / 16 * 6.283) * r, y = sy + Math.sin(a / 16 * 6.283) * r
            if (canStand(x, y)) return [x, y]
          }
        return [sx, sy]
      }
      /* Where the player starts: the arrival anchor a door named, then a spawn anchor, then
       * map.spawn. */
      /* Where resuming a save puts the player. Saved pixel positions are trusted only on the same
       * published bundle. */
      const stamp: WorldStamp = { map: mapId, mapVersion, worldVersion: comp?.version }
      const back = resumeFor(loadSave(), stamp)
      let arrive = anchors.arrival(target.at, map.spawn)
      if (!target.at) {
        if (back.kind === 'exact') arrive = { ...arrive, x: back.x, y: back.y }
        else if (back.kind === 'anchor') {
          const a = anchors.get(back.anchor)
          if (a) arrive = anchors.standAt(a)
        }
        if (back.kind !== 'spawn' || back.why !== RESUME_REASONS.fresh)
          console.log(`[pmap] resume: ${back.kind} (${back.why})`)
      }
      const [spx, spy] = findGround(arrive.x, arrive.y)
      /* The walking code owns the player's position. Walker is MAPVIS's own class, used here under
       * the name pos. */
      const walker = new Walker([spx, spy])
      const pos = walker
      /* Also take the direction to face on arrival from the anchor. */
      if (arrive.facing && DIRS8.includes(arrive.facing)) walker.facing = arrive.facing

      /* Drop at= from the address once the player has arrived, so a refresh resumes where they are. */
      if (target.at) setMapUrl({ map: mapId, aboard: target.aboard })

      /** The ink color a plaque's words are written in. */
      const plaqueStyle = (t: Text, ink: number) => { t.style.fill = ink }

      // The YOU marker: a map pin holding the player's face, drawn at screen scale instead of world
      // scale.
      const pin = new Container()
      /* The font size for text drawn inside the world. It follows the same text size setting as the
       * rest of the game. */
      const promptSize = (): number => {
        const v = typeof document === 'undefined' ? '' : document.documentElement.dataset.textsize
        return Math.round(16 * (v === 's' ? 0.86 : v === 'l' ? 1.22 : 1))
      }

      /* How the marker is made easy to spot: a pale background, a bigger opening for the face, and
       * a round shape. */

      /* The parchment, the carved brown and the highlight colors, taken from tokens.css. */
      const PIN_FIELD = 0xf0e0bd
      const PIN_RIM = 0x4a3524
      const PIN_LIGHT = 0xf5efdd

      /* Small enough that the marker doesn't outweigh the character it points at. */
      /* The disc is sized to fit the face. The head halves cleanly to 26, so the radius is 14. */
      const PR = 14       // Pin circle radius in screen pixels.
      const PCY = -PR - 10                 // Circle center. The tail tip is the origin.

      // The player's face: the head rows of the south idle frame, masked into the circle.
      const drawnH = rig ? rig.feet - rig.top + 1 : 67
      /* A head crop tall enough to fill the opening instead of floating in it. */
      const headH = Math.max(6, Math.round(drawnH * 0.58))
      const headSrc = walkT.south[0].source
      const headTop = rig ? rig.top : 0
      const band = scanCols(walkT.south[0], headTop, headTop + headH - 1)
      let headX = band ? band.left : 0
      let headW = band ? band.right - band.left + 1 : headSrc.pixelWidth
      /* An even-width crop centered on the drawn pixels, so halving it is exact and the face is
       * centered. */
      if (headW % 2) headW += 1
      if (band) {
        const mid = (band.left + band.right + 1) / 2
        headX = Math.round(mid - headW / 2)
      }
      headX = Math.max(0, Math.min(headX, headSrc.pixelWidth - headW))
      const headTex = new Texture({ source: headSrc, frame: new Rectangle(headX, headTop, headW, headH) })
      const head = new Sprite(headTex)
      head.anchor.set(0.5, 0.5)
      /* Use a clean scale for the head if one fits: 1, then a half, then a third. The exact ratio
       * is the last choice. */
      const aperture = PR * 2 - 2
      const fits = (k: number) => headW * k <= aperture && headH * k <= aperture
      const hs = fits(1) ? 1 : fits(0.5) ? 0.5 : fits(1 / 3) ? 1 / 3 : Math.min(aperture / headW, aperture / headH)
      head.scale.set(hs)
      head.position.set(0, PCY)
      const headMask = new Graphics().circle(0, PCY, PR - 1).fill(0xffffff)
      head.mask = headMask
      head.visible = true

      /* The marker as one object: the word, ribbon, disc and tail under one outline. */
      const youTxt = new Text({
        text: 'YOU',
        style: new TextStyle({
          fontFamily: ['Deckhand', 'monospace'],
          fontSize: promptSize(),
          fontWeight: 'bold',
          /* Set below, once the pin's two colors exist. */
          fill: 0xffffff,
        }),
      })

      /* The word matches the marker's colors instead of sitting in its own box. */
      /* Parchment letters with a dark outline, so the word doesn't get lost on warm sand. */
      youTxt.style.fill = PIN_FIELD
      youTxt.style.stroke = { color: 0x2c2620, width: 2 }
      youTxt.anchor.set(0.5, 1)
      youTxt.position.set(0, PCY - PR - 1)

      const pinG = new Graphics()
      /* Drawn in this order so the whole marker ends up with one outline. */
      /* The tail is wide enough to keep the parchment color all the way down to its tip. */
      pinG.moveTo(-PR * 0.55, PCY + PR * 0.86).lineTo(0, 1).lineTo(PR * 0.55, PCY + PR * 0.86)
        .closePath().fill(PIN_FIELD).stroke({ color: PIN_RIM, width: 1 })
      /* A solid light edge outside the dark one, so the disc stands out on both water and stone. */
      /* The light edge is an arc with a gap, so no light line crosses where the disc meets the
       * tail. */
      const gap = Math.asin(Math.min(1, (PR * 0.55) / PR))
      pinG.arc(0, PCY, PR + 2, Math.PI / 2 + gap, Math.PI / 2 - gap + Math.PI * 2)
        .stroke({ color: PIN_LIGHT, width: 1 })
      pinG.circle(0, PCY, PR).fill(PIN_FIELD).stroke({ color: PIN_RIM, width: 2 })

      pin.addChild(pinG, headMask, head, youTxt)
      pin.scale.set(1 / Z)
      pin.zIndex = 9e9
      world.addChild(pin)
      /* Whether the marker should be on screen at all, kept separate from whether it's drawn right
       * now. */
      let pinWanted = pin.visible

      /* The prompt in the world: a drawn plaque, the game's custom font, and a mark for each state. */

      /* The text color for each state, from tokens.css. The objective is teal, never gold. */
      const PROMPT_INK: Record<PromptState, number> = {
        plain: 0x3b2a1a,
        objective: 0x234c40,
        barred: 0x8a7a60,
        done: 0x5a4a34,
      }
      /* The icon each state shows, from sheets the platform publishes. */
      const PROMPT_FACE: Record<PromptState, string | null> = {
        plain: null,
        objective: null,
        barred: 'lock',
        done: 'tick',
      }

      const prompt = new Container()
      prompt.zIndex = 9e9 - 1
      prompt.visible = false
      prompt.sortableChildren = true
      world.addChild(prompt)

      /* The plaque art may load late or not at all, so the text has its own outline until it
       * arrives. */
      let promptPlate: NineSliceSprite | null = null
      let promptPlateH = 104
      const promptMark = new Sprite()
      promptMark.visible = false
      promptMark.anchor.set(0, 0.5)
      const doorTxt = new Text({
        text: '',
        style: new TextStyle({
          /* The game's custom body font, which main.tsx loads into document.fonts before anything
           * renders. Monospace is the backup for the first frame, before the font is cached. */
          fontFamily: ['Deckhand', 'monospace'],
          fontSize: promptSize(),
          fontWeight: 'bold',
          fill: 0xbaf3ea,
          stroke: { color: 0x06282c, width: 3 },
        }),
      })
      doorTxt.anchor.set(0, 0.5)
      /* The E keycap, drawn from shapes instead of typed as a letter, in whole screen pixels. */
      /* The key face is lighter than the plaque under it, so the key looks like an object sitting
       * on it. */
      const CAP_FACE = 0xfdf6e3
      const CAP_RIM = 0x2c2015
      const CAP_WALL = 0x9a7448
      const CAP_INK = 0x2c2015
      const capG = new Graphics()
      const capBox = { w: 0, h: 0 }
      /** Draws the key at a given side length, starting from its own top left corner. */
      const drawKeycap = (side: number) => {
        const s = Math.max(12, side % 2 ? side + 1 : side)   // Even, so the E is centered.
        const d = 2                                          // The visible side wall.
        capBox.w = s
        capBox.h = s + d
        capG.clear()
        // The whole key, rim included.
        capG.rect(0, 0, s, s + d).fill(CAP_RIM)
        // The wall under the face, which makes it look pressable.
        capG.rect(1, 1, s - 2, s + d - 2).fill(CAP_WALL)
        // The face.
        capG.rect(1, 1, s - 2, s - 2).fill(CAP_FACE)
        // One lit row along the top of the face. Every drawn edge in this kit is lit the same way:
        // light, then dark, then the fill.
        capG.rect(2, 2, s - 4, 1).fill(0xfdf3dc)
        /* The E: a stem and three arms inside the face, with a shorter middle arm. */
        const m = Math.max(3, Math.round(s * 0.26))
        const x0 = m, y0 = m
        const lw = s - m * 2, lh = s - m * 2
        const th = Math.max(2, Math.round(lh / 5))
        capG.rect(x0, y0, th, lh).fill(CAP_INK)                       // The stem.
        capG.rect(x0, y0, lw, th).fill(CAP_INK)                       // Top arm.
        capG.rect(x0, y0 + Math.round((lh - th) / 2), Math.round(lw * 0.76), th).fill(CAP_INK)
        capG.rect(x0, y0 + lh - th, lw, th).fill(CAP_INK)             // Bottom arm.
      }
      drawKeycap(Math.round(promptSize() * 1.15))

      /* What a press looks like: a grey line that wraps once around the plaque, drawn as its own
       * object. */
      const WRAP_MS = 250
      /* The line runs just outside the plate, with only the painting behind it. */
      const WRAP_PAD = 3
      const WRAP_INK = 0xdcdcdc
      const wrapG = new Graphics()
      wrapG.zIndex = 9e9 - 1
      wrapG.visible = false
      world.addChild(wrapG)
      const wrapBox = { w: 0, h: 0 }
      const wrapAt2 = { x: 0, y: 0, w: 0, h: 0 }
      let wrapAt = 0
      const drawWrap = (p: number) => {
        const w = wrapAt2.w + WRAP_PAD * 2, h = wrapAt2.h + WRAP_PAD * 2
        if (!(wrapAt2.w > 4 && wrapAt2.h > 4)) { wrapG.visible = false; return }
        const x0 = -Math.round(w / 2), y0 = -Math.round(h / 2)
        const x1 = x0 + Math.round(w), y1 = y0 + Math.round(h)
        wrapG.clear()
        // Walk the four edges in order, drawing each one as far as the elapsed time allows.
        const legs: [number, number, number, number][] = [
          [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0],
        ]
        const total = 2 * (w + h)
        let left = total * Math.max(0, Math.min(1, p))
        for (const [ax, ay, bx, by] of legs) {
          if (left <= 0) break
          const len = Math.hypot(bx - ax, by - ay)
          const k = Math.min(1, left / len)
          wrapG.moveTo(ax, ay).lineTo(ax + (bx - ax) * k, ay + (by - ay) * k)
          left -= len
        }
        wrapG.stroke({ color: WRAP_INK, width: 2, cap: 'square' })
        wrapG.visible = true
      }
      /** Shows once that the press was heard, on the plaque the press was for. */
      const startWrap = () => {
        if (!prompt.visible || !(wrapBox.w > 4)) return
        wrapAt = performance.now()
        wrapAt2.x = prompt.x; wrapAt2.y = prompt.y
        wrapAt2.w = wrapBox.w; wrapAt2.h = wrapBox.h
      }
      const tickWrap = () => {
        if (!wrapAt) return
        const p = (performance.now() - wrapAt) / WRAP_MS
        if (p >= 1) { wrapAt = 0; wrapG.visible = false; wrapG.clear(); return }
        /* Keep the sign where it was pressed until its line finishes. */
        prompt.visible = true
        prompt.position.set(wrapAt2.x, wrapAt2.y)
        wrapG.position.set(wrapAt2.x, wrapAt2.y)
        wrapG.scale.set(prompt.scale.x)
        drawWrap(prefersReducedMotion() ? 1 : p)
      }

      prompt.addChild(capG, promptMark, doorTxt)
      prompt.scale.set(1 / Z)

      /* What the prompt is saying now, so the layout only reruns when it changes. */
      let promptSaid = ''
      let promptWas: PromptState = 'plain'

      /* The plaque is sized to fit its text. That's what the nine-slice is for. */
      const layoutPrompt = () => {
        const markW = promptMark.visible ? promptMark.texture.width : 0
        const gap = markW ? 8 : 0
        /* The key comes first because it's the thing being named, and a student reads left to
         * right: press this, and this happens. */
        const capGap = 9
        const bodyW = capBox.w + capGap + markW + gap + doorTxt.width
        const plateH = Math.max(doorTxt.height + 14, capBox.h + 10)
        /* The line runs around the plate's own edge, so it's measured from the carved socket the
         * platform published. */
        wrapBox.w = bodyW + 28
        wrapBox.h = plateH
        if (promptPlate) {
          /* The art is drawn 104 pixels tall and scaled down as a whole, so every corner keeps its
           * painted shape. The padding is in the plate's own units. */
          const k = plateH / promptPlateH
          const padX = 30
          promptPlate.width = bodyW / k + padX * 2
          promptPlate.scale.set(k)
          promptPlate.x = -(promptPlate.width * k) / 2
          promptPlate.y = -(promptPlateH * k) / 2
          wrapBox.w = promptPlate.width * k
          wrapBox.h = plateH
        }
        const left = -bodyW / 2
        capG.x = Math.round(left)
        capG.y = -Math.round(capBox.h / 2)
        promptMark.x = left + capBox.w + capGap
        promptMark.y = 0
        doorTxt.x = left + capBox.w + capGap + markW + gap
        doorTxt.y = 0
      }

      void (async () => {
        promptPlate = await kitNineSlice('socket', 300)
        if (!promptPlate) return
        promptPlateH = kitPieceHeight('socket') ?? 104
        promptPlate.zIndex = -1
        prompt.addChild(promptPlate)
        /* The outline was standing in for a background. Now that there's a real one, the outline
         * only adds noise around the letters. */
        doorTxt.style.stroke = { color: 0x000000, width: 0 }
        doorTxt.style.fill = PROMPT_INK[promptWas]
        layoutPrompt()
      })()

      /** Shows text over an anchor in one of the five prompt states. */
      const setPrompt = (text: string, state: PromptState) => {
        if (!text) { prompt.visible = false; promptSaid = ''; return }
        prompt.visible = true
        if (text === promptSaid && state === promptWas) return
        promptSaid = text
        promptWas = state

        doorTxt.text = text
        doorTxt.style.fontSize = promptSize()
        /* The key is sized from the same setting as the words, so the S/M/L setting resizes the key
         * and the sentence together. */
        drawKeycap(Math.round(promptSize() * 1.15))
        plaqueStyle(doorTxt, promptPlate ? PROMPT_INK[state] : 0xbaf3ea)
        /* Screen readers and keyboard users get the same sentence that's shown on screen. */
        prompt.accessibleTitle = text

        const face = PROMPT_FACE[state]
        if (!face) { promptMark.visible = false; layoutPrompt(); return }
        void (async () => {
          const t = await kitTexture('icon_set', face)
          promptMark.visible = !!t
          if (t) promptMark.texture = t
          layoutPrompt()
        })()
        layoutPrompt()
      }

      /* The objective line is drawn in the DOM. This scene only tells it when the player is at sea. */

      /* A pointer and keyboard way to use the prompt, through Pixi's accessibility layer. */
      prompt.eventMode = 'static'
      prompt.cursor = 'pointer'
      prompt.accessible = true
      prompt.accessibleType = 'button'

      /* The plaque can be tapped as well as opened with E, so a trackpad can open a station. */
      let promptAnchor: Anchor | null = null
      /* The same plaque works at sea. A berth isn't an anchor because it's off the painting, so it
       * passes a function instead of a name, and both the tap and the key call it. */
      let seaTap: (() => void) | null = null
      prompt.on('pointertap', (e) => {
        /* Stop the tap from also reaching the walking surface under the plaque. */
        e.stopPropagation()
        /* A tap over another station's lit ring goes to that station instead of this plaque. */
        const w = world.toLocal(e.global)
        if (litAnchor && insideLit(w.x, w.y) && litAnchor.name !== promptAnchor?.name) {
          if (walkTap(w.x, w.y) !== 'busy') return
        }
        /* A tap gets the same visual response as the key, because a trackpad is the only pointer on
         * the school Chromebooks and a tap has no physical feel to it. */
        if (seaTap) { startWrap(); seaTap(); return }
        if (promptAnchor) { startWrap(); void fire(promptAnchor) }
      })

      /* The objective marker: a small chevron over the station the year is sending the player to. */
      /* A chevron drawn from the kit's pointer sheet, with a drawn triangle as the fallback. */
      /* No arrow follows the player around. A chevron ahead of the player looks stuck to the
       * character and repeats what the trail arrows and the ring already say. marksOn is the one
       * switch for whether wayfinding shows at all. */

      /* The big pointer over the target itself, showing which thing instead of which way. */
      const bigMark = new Container()
      bigMark.zIndex = 9e9 - 2
      bigMark.visible = false
      world.addChild(bigMark)
      {
        const CW = 26, CH = 20
        const glyph = new Graphics()
        glyph.moveTo(-CW / 2, -CH).lineTo(CW / 2, -CH).lineTo(0, 0).closePath()
          .fill(0xffd98a).stroke({ color: 0x3a2410, width: 3 })
        bigMark.addChild(glyph)
        void kitSprite('pointer', 'chevron').then((drawn) => {
          if (destroyed || !drawn) return
          drawn.anchor.set(0.5, 1)
          /* Small enough to sit on the thing instead of being read from across the room. */
          const want = Math.max(14, Math.round(map.character.heightPx * 0.8))
          drawn.scale.set(want / drawn.texture.height)
          bigMark.removeChild(glyph)
          glyph.destroy()
          bigMark.addChild(drawn)
        })
      }
      bigMark.scale.set(1 / Z)

      /* A teal ring of light on the ground under the current objective. */
      const lit = new Graphics()
      lit.visible = false
      world.addChild(lit)
      /* The pulse that spreads out from the pool. It's redrawn every frame because it moves. */
      const litRing = new Graphics()
      litRing.visible = false
      world.addChild(litRing)
      /* The ring's shape is rebuilt only when the target or its size changes. */
      let litKey = ''
      let litR = 0
      let litRy = 0
      /* Which anchor the light is on, so the plaque can tell the thing under the pointer apart from
       * the thing the year wants. It's set where the ring is drawn. */
      let litAnchor: Anchor | null = null
      /* Checks whether a point in the world is inside the lit pool on the floor. */
      const insideLit = (wx: number, wy: number): boolean =>
        lit.visible && !!litAnchor && litR > 0
        && Math.hypot((wx - lit.x) / (litR + 2), (wy - lit.y) / (litRy + 2)) <= 1

      /* The sailing part of the scene: the same world seen from further out, with a ship the player
       * steers. Sailing only works when the map has a coast cut, a berth and a sea. */
      const berth = slot?.berth
      const canSail = !!(coastCut && berth && sea)

      let hull: HullState | null = null
      let hullSp: Sprite | null = null
      let hullViews: Texture[] = []
      const wakeG = new Graphics()
      wakeG.zIndex = OVER_PLACED - 2
      world.addChild(wakeG)
      /* One marker on the water for each island slot. Each state has its own color and its own
       * symbol, so the player can tell them apart without relying on color. */
      const slotMarks = new Container()
      slotMarks.zIndex = OVER_PLACED - 3
      world.addChild(slotMarks)

      if (canSail) {
        /* Load the 16 views of the ship. When the player boards, Thor turns into the ship instead
         * of standing on it. */
        hullViews = await Promise.all(
          Array.from({ length: 16 }, (_, i) => Assets.load(req(`/art/intro/port/ship16/v${i}.png`)) as Promise<Texture>),
        ).catch(() => [] as Texture[])
        if (hullViews.length) {
          hullSp = new Sprite(hullViews[0])
          hullSp.anchor.set(0.5, 0.72)
          /* Draw the player's boat name onto the ship art with the world text kit. */
          const boat = (loadSave()?.boatName ?? '').trim()
          const img = boat ? composeWorldText(boat, WORLD_TEXT.sternName) : null
          if (img) {
            const t = Texture.from(img.canvas)
            t.source.scaleMode = 'nearest'
            const name = new Sprite(t)
            name.anchor.set(0.5, 0.5)
            /* Put the name low on the stern, behind the mast. The spot is a fraction of the ship's
             * height, not a pixel count, so it works on any ship art. */
            name.position.set(0, hullViews[0].height * 0.16)
            hullSp.addChild(name)
            if (img.truncated) console.info(`[pmap] the stern is not wide enough for "${boat}", so it reads "${img.lines[0]}"`)
          }
          /* Size the ship from the painting's character height, so the ship is about four people
           * long. */
          const want = map.character.heightPx * 4
          hullSp.scale.set(want / Math.max(1, hullViews[0].width))
          hullSp.visible = false
          hullSp.zIndex = OVER_PLACED
          world.addChild(hullSp)
        }
      }

      /* How far a point on the sea is from the nearest painting in the world. This lets all the
       * water work as one piece. */
      const depthAt = (px: number, py: number): number => {
        let d = paintDistPx(px, py)
        if (comp) {
          const p = toSea(px, py)
          for (const s of comp.slots) {
            if (s.map === mapId || !s.map) continue
            /* Skip the room that sits at the same spot as its island. It has no water around it and
             * never shows up on the sea. */
            if (s.at.x === (slot?.at.x ?? 0) && s.at.y === (slot?.at.y ?? 0)) continue
            const dx = Math.max(Math.abs(p.x - s.at.x) - s.footprint.w / 2, 0)
            const dy = Math.max(Math.abs(p.y - s.at.y) - s.footprint.h / 2, 0)
            d = Math.min(d, Math.hypot(dx, dy))
          }
        }
        return d
      }

      /* Asks the world layout which islands are close enough to keep loaded in memory. */
      const residentNow = (px: number, py: number): string[] =>
        comp ? residentSlots(comp, toSea(px, py)).map((s) => s.map!).filter(Boolean) : []

      /* Draws the seven island states as marks on the water. It gets rebuilt whenever the run
       * changes. */
      const drawSlots = () => {
        if (!comp) return
        slotMarks.removeChildren().forEach((c) => c.destroy())
        const sv = loadSave()
        for (const s of seaSlots(comp)) {
          if (s.map === mapId) continue
          const st = stateOf(s, sv)
          const ink = STATE_INK[st]
          const at = fromSea(s.at.x, s.at.y)
          const t = new Text({
            text: `${ink.mark} ${st === 'misty' || st === 'rumour' ? '' : s.title}`.trim(),
            style: new TextStyle({
              fontFamily: 'monospace', fontSize: 13, fontWeight: 'bold',
              fill: ink.tint, stroke: { color: 0x06282c, width: 3 },
            }),
          })
          t.anchor.set(0.5, 0.5)
          t.alpha = ink.dim
          t.position.set(at.x, at.y)
          t.scale.set(1 / camZ)
          slotMarks.addChild(t)
        }
      }
      drawSlots()

      /* Effects: a named one-shot effect played at a spot. The engine draws it out of basic shapes. */
      type FxRun = { g: Graphics; t: number; life: number; kind: string; x: number; y: number; done: () => void }
      const fxRuns: FxRun[] = []
      const FX_LIBRARY: Record<string, number> = {
        /* An island appearing: a ring that shows something is now where there was nothing. It's an
         * effect so it doesn't need its own art. */
        island_rising: 2600,
        /* A mark landing on the chart, and the flash a station uses to show it heard the player. */
        chart_marked: 900,
        spark: 700,
      }
      const playFx = (name: string, at: { x: number; y: number }): Promise<void> => {
        const life = FX_LIBRARY[name]
        if (life === undefined)
          throw new NotBuilt('fx', `"${name}" is not in the effect library. It has: ${Object.keys(FX_LIBRARY).join(', ')}`)
        const g = new Graphics()
        g.zIndex = 9e9 - 4
        world.addChild(g)
        return new Promise<void>((done) => {
          fxRuns.push({ g, t: 0, life: motionMs(life) / 1000, kind: name, x: at.x, y: at.y, done })
        })
      }

      /* Going through a door uses the transition library, so the map the player is going to picks
       * the cover screen. */
      let fade = false
      let releaseExit: (() => void) | null = null
      /* The second argument is one of two things. It's either an occasion the engine handles itself
       * (the graduation, or a map the player only passes through), or the name of a cover picture
       * in the destination's own bundle, which `coverFor` looks up. */
      const beginExit = (to: PmapTarget, occasion?: string) => {
        if (fade) return
        fade = true
        /* If the cinema bars are already up, keep them up through the door. */
        carryCinemaThroughDoor()
        /* Take the controls away for the whole transition. Walking during one would land the player
         * somewhere they didn't aim for. */
        releaseExit = holdWorld(`pmap:exit->${to.map}`)
        /* The end of a year is an occasion, not a destination, so it picks its own cover. A map the
         * player only passes through on the way to the boat gets no title card at all. */
        const choice = occasion === 'ceremony' ? ceremonyCover(titleOfMap(to.map))
          : occasion === 'passing' ? passingCover()
            /* Anything else is the name of a cover the destination carries, and `coverFor` turns it
             * into a candidate from that map's own bundle. */
            : coverFor(to.map, undefined, occasion)
        engine.log('door_taken', {
          from: mapId, to: to.map, at: to.at ?? null,
          cover: choice.spec.kind, occasion: occasion ?? null,
        })
        /* Check what `cover()` returns. It gives back false when a transition is already running,
         * and if that's ignored, `fade` stays true and every door, station and control stops
         * working until a reload. */
        void cover(choice.spec, async () => {
          /* Update the URL with replaceState so nothing outside this component gets lost. */
          setMapUrl(to)
          engine.log('map_entered', { map: to.map, at: to.at ?? null, from: mapId })
          /* The map changed, so save the new map and the anchor the player arrives at. */
          recordPosition({ map: to.map, ...(to.at ? { anchor: to.at } : {}) })
          ;(window as unknown as { __sceneReady?: boolean }).__sceneReady = false
          setSceneDrawn(null)
          /* Changing the target reruns the effect, which tears down this Pixi app and builds the
           * next one. */
          setTarget(to)
          await waitForScene()
        }).then((swapped) => {
          if (swapped) return
          /* The map didn't change, so this scene is still running and has to be handed back. Open
           * the door again, give the controls back, and tell the island the door was refused
           * instead of pretending it worked. */
          fade = false
          engine.log('door_refused', { from: mapId, to: to.map, why: 'a transition was already running' })
          console.warn(`[pmap] refused to open "${to.map}": a transition is already running`)
          exitReject?.(new NotBuilt('enter', `"${to.map}" did not open, because a transition was already running`))
          exitReject = null; exitResolve = null
        }).finally(() => {
          releaseExit?.(); releaseExit = null
          exitResolve?.(); exitResolve = null; exitReject = null
        })
      }

      /* Lift the cover once the new map is ready. After 12 seconds, give up instead of hanging. */
      const waitForScene = () => new Promise<void>((done) => {
        const t0 = performance.now()
        const poll = () => {
          if ((window as unknown as { __sceneReady?: boolean }).__sceneReady) { done(); return }
          if (performance.now() - t0 > 12000) {
            engine.log('map_slow', { map: mapId, waitedMs: Math.round(performance.now() - t0) })
            done(); return
          }
          requestAnimationFrame(poll)
        }
        requestAnimationFrame(poll)
      })
      let ePrev = false
      /* True while a station's code is running and controlling the player. It's checked before
       * showing a prompt, so pressing E can't start the same station twice in the middle of a
       * sentence. */
      let busy = false
      /* The hold a running station owns. It lives here so a cutscene the station starts can pause
       * it (see `suspendStationHold` below). */
      let stationHold: (() => void) | null = null

      /* The club member's Python island for this map. It's only opened when needed, because most
       * maps don't have one. */
      let grape: GrapeSession | null = null
      let grapeHandlers: string[] = []
      /* Whether the room's Python has finished the handler the engine calls on its own every time
       * the map loads. */
      let islandStarted = false
      /* While an island is still loading, its stations aren't ready, so pressing them does nothing. */
      let islandPending = false

      /* What a cutscene controls while it runs: the camera it asked for, its actors, and the walk. */
      /* The cues the stage couldn't perform. At the end the command fails and names each one. */
      let stageMisses: string[] = []
      const stageMissed = (what: string) => { if (!stageMisses.includes(what)) stageMisses.push(what) }

      /* `camZ` is declared up next to `Z`, before anything reads it. Don't move it down here after
       * the ocean is built, or a cutscene camera push slides the coast ring off the coast. */
      let csCam: { x: number; y: number; zoom: number } | null = null
      let csHold: (() => void) | null = null
      let unpublish: (() => void) | null = null

      /* The player is the actor named `thor`. That's the default name for the runtime's
       * `playerActor`, so a script written for the beach uses the same name here. */
      const IS_THOR = (a: string) => a === 'thor'

      /* The world half of the intent vocabulary, meaning the things a member's Python can ask the
       * world to do. */
      /* An actor is an anchor, and the anchor is bound to a placement. That placement's sprite is
       * the actor's body. */
      const actorBody = (name: string, word: string): Sprite => {
        const a = anchors.get(name)
        if (!a) throw new NotBuilt(word, `no anchor named "${name}" on ${mapId}`)
        if (!a.placement)
          throw new NotBuilt(word, `anchor "${name}" is not bound to a placement, so there is no body to drive`)
        const sp = placedById.get(a.placement)
        if (!sp) throw new NotBuilt(word, `no placement "${a.placement}" on ${mapId}`)
        return sp
      }

      /* Letting go of a driven body finishes any move that was still waiting on it. */
      /* A released body keeps facing the way the scene left it. */
      const lastFacing = new Map<Sprite, string>()

      const releaseDriven = (only?: Sprite) => {
        for (const [sp, d] of driven) {
          if (only && sp !== only) continue
          const settle = d.move?.then
          if (d.facing) lastFacing.set(sp, d.facing)
          d.move = null
          driven.delete(sp)
          settle?.()
        }
      }

      /* Promises waiting for something to arrive. The scene's own ticker checks them, so the
       * arrival is noticed on the frame it happens instead of up to a timer interval late. */
      const waiters: { a: Anchor; until: number; done: (v: boolean) => void }[] = []

      /* A route can be traveled three ways: the player walks it, a placement gets carried along it,
       * or the ship sails it. */
      const walkRoute = async (p: Pathway, backwards: boolean): Promise<void> => {
        const pts = legsOf(p, backwards)
        const hold = holdWorld(`route:${p.name}`)
        try {
          for (let i = 1; i < pts.length; i++) {
            /* If the scene was torn down, stop the route instead of starting the next leg. */
            if (destroyed) break
            const last = i === pts.length - 1
            await new Promise<void>((r) => {
              startWalk(pts[i], last ? 3 : 6, last ? p.facing ?? null : null, r, `${p.name}[${i}]`)
            })
          }
        } finally { hold() }
      }

      const actorRoute = async (who: string, p: Pathway, backwards: boolean): Promise<void> => {
        const sp = actorBody(who, 'route')
        const pts = legsOf(p, backwards)
        for (let i = 1; i < pts.length; i++) {
          if (destroyed) return
          /* Look up the driven record on every leg, so releasing the body mid-route can't leave a
           * move hanging. */
          const d = take(sp)
          if (d.move) { const orphan = d.move.then; d.move = null; orphan?.() }
          const dir = dirFrom(pts[i].x - d.x, (pts[i].y - d.y) * map.yScale)
          if (dir) d.facing = dir
          await new Promise<void>((r) => {
            d.move = { tx: pts[i].x, ty: pts[i].y, speed: map.speed, done: false, then: r }
          })
        }
        const end = take(sp)
        if (p.facing) end.facing = p.facing
      }

      /* The voyage: the ship passes every waypoint at speed, and the last one is where it docks. */
      let sailing: {
        path: Pathway
        pts: { x: number; y: number }[]
        i: number
        /* Seconds of slack left. It counts down on the ticker, so a tab sitting in the background
         * can't time it out. */
        left: number
      } | null = null

      /* The crossing lasts longer than the waypoint follower, so it only finishes when the ship
       * actually stops. */
      let voyage: {
        path: Pathway
        done: () => void
        fail: (e: Error) => void
      } | null = null
      const endVoyage = (err?: Error) => {
        const v = voyage
        if (!v) return
        voyage = null
        if (err) v.fail(err); else v.done()
      }
      const sailRoute = (p: Pathway, backwards: boolean): Promise<void> => {
        if (p.kind !== 'sail')
          throw new NotBuilt('route', `"${p.name}" is a ${p.kind} route, so the ship cannot take it`)
        if (!canSail || !berth)
          throw new NotBuilt('route', `${mapId} has no berth on the world, so there is nothing here to sail`)
        if (sailing || voyage) throw new NotBuilt('route', `"${p.name}" cannot start: the ship is already on a route`)

        /* Every check that can refuse the route happens before anyone boards. The water depth is
         * sampled along the whole line. */
        const pts = legsOf(p, backwards)
        /* Measure from where the ship actually is. When arriving by sea, that's the far start, not
         * the berth. Measuring from the dock would refuse a crossing over water the ship never
         * sails. */
        const from = hull ? { x: hull.x, y: hull.y } : fromSea(berth.x, berth.y)
        const line = [from, ...pts]
        for (let i = 1; i < line.length; i++) {
          const a2 = line[i - 1], b2 = line[i]
          const n = Math.max(1, Math.ceil(Math.hypot(b2.x - a2.x, b2.y - a2.y) / 8))
          for (let k = 0; k <= n; k++) {
            const x = a2.x + (b2.x - a2.x) * (k / n), y = a2.y + (b2.y - a2.y) * (k / n)
            if (depthAt(x, y) >= DEFAULT_SAIL.probe) continue
            throw new NotBuilt('route',
              `"${p.name}" runs aground near ${Math.round(x)},${Math.round(y)} on leg ${i}, `
              + `which is inside the hull's own ${DEFAULT_SAIL.probe} pixel probe`)
          }
        }
        /* The berth a route says it ends at has to exist right now, not just by the time the ship
         * arrives. */
        if (p.meta && typeof p.meta.berth === 'string' && !berthNamedBy(p))
          throw new NotBuilt('route', `"${p.name}" ends at a berth called "${String(p.meta.berth)}", `
            + `which the world does not have. It has: ${comp ? markNames(comp).join(', ') || 'none' : 'no world at all'}`)

        /* A route that names no berth still has an end point, so the last waypoint picks the berth. */
        const ends = pts[pts.length - 1] ?? from
        const dest = destBerth(p, ends)
        if (!dest)
          throw new NotBuilt('route', `"${p.name}" ends at ${Math.round(ends.x)},${Math.round(ends.y)}, `
            + `which is not within ${BERTH_REACH} pixels of any berth on the world, so there is `
            + `nowhere for the ship to tie up. `
            + `${comp ? `The world has: ${markNames(comp).join(', ') || 'no berths'}` : 'There is no world at all'}`)

        /* Refuse a crossing that ends where the player is already standing. */
        if (!hull && (!dest.slot?.map || dest.slot.map === mapId))
          throw new NotBuilt('route', `"${p.name}" ends at "${dest.berth.name}" on ${mapId}, `
            + `which is where he is already standing, and he is not aboard`)
        if (!hull) board()
        if (!hull) throw new NotBuilt('route', `the ship could not be boarded on ${mapId}`)
        /* The timeout comes from the route's own length, not from a fixed number. */
        /* Measure from the ship, the same way `dockAt` does. The first leg of any route goes from
         * the ship to the first point, and `lengthOf` doesn't count that gap. */
        const secs = ((Math.hypot(pts[0].x - from.x, pts[0].y - from.y) + lengthOf(p, backwards))
          / DEFAULT_SAIL.cruise) * 3 + 8
        engine.log('voyage_started', {
          map: mapId, path: p.name, legs: pts.length,
          berth: dest.berth.name, to: dest.slot?.map ?? mapId,
        })
        sailing = { path: p, pts, i: 1, left: secs }
        sailingTo = dest
        return new Promise<void>((done, fail) => {
          voyage = { path: p, done, fail }
        })
      }

      /* How close, in pixels, a route has to end to a berth for that berth to count as its end. */
      const BERTH_REACH = 220
      /* Finds which island a berth belongs to. It checks three ways (berth name, map and place),
       * because the world spells island names two different ways. */
      const slotOfBerth = (b: { name?: string; island?: string }): WorldSlot | undefined => {
        if (!comp) return undefined
        return comp.slots.find((q) => b.name && q.berth?.name === b.name)
          ?? comp.slots.find((q) => b.island && (q.map === b.island || q.place === b.island))
      }
      const destBerth = (p: Pathway, ends: { x: number; y: number }):
        { berth: Berth; slot: WorldSlot | undefined } | undefined => {
        const named = berthNamedBy(p)
        if (named) return { berth: named, slot: slotOfBerth(named) }
        if (!comp) return undefined
        /* Look at every berth in the world, in this painting's pixels, skipping repeated names. */
        let best: WorldMark | undefined
        let bestD = Infinity
        const seen = new Set<string>()
        for (const m of marksOf(comp).values()) {
          if (m.kind !== 'berth' || seen.has(m.name)) continue
          seen.add(m.name)
          const at = fromSea(m.x, m.y)
          const d = Math.hypot(at.x - ends.x, at.y - ends.y)
          if (d < bestD) { bestD = d; best = m }
        }
        if (!best || bestD > BERTH_REACH) return undefined
        console.log(`[pmap] ${mapId}: "${p.name}" names no berth, and its last waypoint is `
          + `${Math.round(bestD)}px from "${best.name}", so that is where she is going`)
        const b: Berth = {
          x: best.x, y: best.y, name: best.name,
          ...(best.facing ? { facing: best.facing } : {}),
          ...(best.at ? { at: best.at } : {}),
        }
        const slot = slotOfBerth(best)
        /* An island's own berth has an approach point. A loose mark doesn't. */
        if (slot?.berth?.name === best.name && slot.berth.approach) b.approach = slot.berth.approach
        return { berth: b, slot }
      }
      /* The berth the follower hands the ship to for docking. It's worked out when the command is
       * given, not when the last leg starts. */
      let sailingTo: { berth: Berth; slot: WorldSlot | undefined } | null = null
      /* The berth a sail route ends at is stored in `meta`. MAPVIS drops unknown top-level fields
       * on the way through, but the meta bag survives. */
      const berthNamedBy = (p: Pathway): Berth | undefined => {
        const want = p.meta && typeof p.meta.berth === 'string' ? p.meta.berth : ''
        if (!want || !comp) return undefined
        const b = berthOf(comp, want)
        if (!b) {
          console.warn(`[pmap] path "${p.name}" ends at a berth called "${want}", which the world does not have. `
            + `It has: ${markNames(comp).join(', ') || 'none'}`)
          return undefined
        }
        return b
      }

      /* A berth's name also works as a sail route, built from the world's own marks. */
      const seaRouteNamed = (name: string): Pathway | null => {
        if (!comp) return null
        /* The name the island asked for. berthOfRoute understands it as well as the berth's real
         * name. */
        const berthName = berthOfRoute(comp, name)
        if (!berthName) return null
        const marks = approachTo(comp, berthName)
        /* One mark is just the berth by itself. That's a voyage with no legs, and it would report a
         * crossing that never happened. */
        if (marks.length < 2) return null
        const berth = marks[marks.length - 1]
        return {
          name,
          kind: 'sail',
          points: marks.map((m) => {
            const p = fromSea(m.x, m.y)
            return { x: Math.round(p.x), y: Math.round(p.y) }
          }),
          closed: false,
          twoWay: false,
          ...(berth.facing ? { facing: berth.facing } : {}),
          marks: [],
          meta: { berth: berth.name },
        }
      }

      /** The reserved id a member or a station uses to make the player speak. */
      const PLAYER_ID = 'thor'

      /**
       * Turns an anchor name, a station name or the reserved player id into the name the player
       * sees on the name plate.
       */
      const speakerLabel = (who: string | undefined): string | undefined => {
        if (!who) return undefined
        if (who === PLAYER_ID) return loadSave()?.handle || 'You'
        const a = anchors.get(who)
        if (a?.label) return a.label
        if (a || ownerOf(who, grapeHandlers)) return who
        /* If nobody on this map has that name, the line still gets said and the plate shows the
         * name that didn't match. */
        console.warn(`[pmap] ${mapId}: nobody called "${who}" is on this map, so the plate says so`)
        return who
      }

      const intentWorld: IntentWorld = {
        mapId: () => mapId,
        hasAnchor: (n) => anchors.has(n),

        /* Show who is speaking the way the player knows them: the anchor's label first, never the
         * Python name. */
        say: (who, text, portrait) => say({ who: speakerLabel(who), text, portrait }),
        choose: (prompt, options) => choose({ prompt, options }),

        /* Every map this game can actually open: the ones the world document names and the ones the
         * doors here lead to. It's read fresh each time because the world can load after the scene
         * does. */
        knownMaps() {
          const out = new Set<string>()
          const c = comp
          for (const q of c?.slots ?? []) if (q.map) out.add(q.map)
          for (const d of doors) if (d.to) out.add(d.to)
          out.add(mapId)
          return [...out]
        },

        guideTo(name) {
          guideTarget = name ? anchors.get(name) ?? null : null
          markQuiet = false
        },

        /* `highlight` shows only the pool of light. `guide_to` turns on the arrow, the trail of
         * marks and the light all together, so `highlight` is for an island that wants to point at
         * one thing without drawing a whole route. */
        highlight(name, on) {
          guideTarget = on && name ? anchors.get(name) ?? null : null
          markQuiet = !!guideTarget
        },

        /* Auto-walk. It finds a path around walls first, then steers along it. */
        walkTo(name, off) {
          const a = anchors.get(name)
          if (!a) return Promise.resolve()
          const { goal, reach } = walkGoal(a)
          /* An offset is a spot the author placed on purpose, so it uses the tight 3 pixel
           * tolerance. */
          const mark = off
            ? { ...asideFrom(a, goal.x, goal.y, off), facing: goal.facing }
            : goal
          return new Promise<void>((resolve) => {
            startWalk(mark, off ? 3 : reach, mark.facing ?? null, resolve, name)
          })
        },

        /* `look_at` uses the map's own framing for that anchor, so an author only has to set the
         * offset once. */
        lookAt(name, ms = 500) {
          const a = name ? anchors.get(name) : null
          if (a) {
            const shot = shotOf({ x: a.x, y: a.y }, framingOf(a.meta))
            lookAtTarget = { x: shot.x, y: shot.y, until: performance.now() + ms }
          } else lookAtTarget = null
          return new Promise<void>((r) => setTimeout(r, a ? ms : 0))
        },

        /* The world shows the state of the run. Showing or hiding a placement is how a trophy wall
         * turns into a display of progress. */
        show(name, visible) {
          const a = anchors.get(name)
          const id = a?.placement
          /* An anchor with no placement bound to it is an authoring mistake, so throw an error
           * instead of only warning. */
          if (!id) {
            /* Warn once per anchor in plain words, naming the map and how to fix it. */
            if (!saidUnbound.has(name)) {
              saidUnbound.add(name)
              console.warn(`[pmap] ${mapId} has an anchor called "${name}" with no placement bound to it, `
                + 'so nothing in the world can be shown or hidden by that name. Bind a placement to it in '
                + 'MAPVIS and republish. The island carries on; the student sees the room as it is.')
            }
            throw new NotBuilt('show', `anchor "${name}" is not bound to a placement`)
          }
          const sp = placedById.get(id)
          if (!sp) throw new NotBuilt('show', `no placement "${id}" on ${mapId}`)
          sp.visible = visible
          /* Pass it to the driver too, so a body a script is holding really stays hidden. */
          const d = driven.get(sp)
          if (d) d.visible = visible
        },

        /* `fx` plays effects from the library. A name that isn't there gets refused, with a list of
         * the ones that are. */
        fx(name, anchorName2, data) {
          const a = anchorName2 ? anchors.get(anchorName2) : null
          if (anchorName2 && !a)
            throw new NotBuilt('fx', `no anchor named "${anchorName2}" on ${mapId}`)
          /* An effect plays at an anchor, at a world point given in the data bag, or at the player. */
          const pt = data && typeof data === 'object'
            ? (data as { x?: unknown; y?: unknown }) : null
          const at = a ? { x: a.x, y: a.y }
            : pt && isFinite(Number(pt.x)) && isFinite(Number(pt.y))
              ? { x: Number(pt.x), y: Number(pt.y) }
              : { x: pos.x, y: pos.y }
          /* Return the promise so the script waits for the effect to finish. Otherwise the next
           * line of the script runs over the top of it. */
          return playFx(name, at)
        },

        /* The run is over. The world goes behind a cover and the app goes back to the title screen. */
        endRun() {
          engine.log('run_ended', { from: mapId })
          const home = () => {
            /* Take the cinema bars down on the way out. The closing film keeps them up through the
             * door on purpose, and the title screen isn't a film. */
            engine.movie(false)
            /* Don't clear the flag here. The router's fade to the title takes 600ms with this scene
             * still mounted and the ship still on the water, and clearing it now brings the bar
             * back for the last half second. The next world scene that mounts clears it instead. */
            ;(window as unknown as { __sceneReady?: boolean }).__sceneReady = false
            setSceneDrawn(null)
            /* Only one cover at a time, and this one belongs to the router, so don't open a second
             * one here. */
            if (navMaybe) navMaybe.go('title', { kind: 'fade', holdMs: 600 })
            else window.location.href = '/?scene=title'
          }

          /* First the camera moves to the boat and the player is placed on the dock behind it,
           * because boarding on camera looks like a teleport. The heading out comes from `seaward`,
           * not `soundOffshore`, because `berth.approach` is the line a ship comes in on. */
          if (!canSail || !berth) { home(); return new Promise<void>(() => {}) }

          const nap = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
          /* Out to sea: head away from the middle of the painting, then turn toward the direction
           * with the most water, so the ship never leaves aground. */
          const seaward = (from: { x: number; y: number }): number | null => {
            /* Out to sea: head away from the middle of the painting, then turn toward the direction
             * with the most water, so the ship never sets off into shallows. */
            const base = Math.atan2(from.y - pc.y, from.x - pc.x)
            let best: { dir: number; open: number } | null = null
            for (let k = -5; k <= 5; k++) {
              const dir = base + (k * Math.PI) / 12
              let open = 0
              let aground = false
              for (let d = 24; d <= OFFSHORE_MAX; d += 24) {
                const deep = depthAt(from.x + Math.cos(dir) * d, from.y + Math.sin(dir) * d)
                if (deep < DEFAULT_SAIL.probe) { aground = true; break }
                open += deep
              }
              if (aground) continue
              if (!best || open > best.open) best = { dir, open }
            }
            return best ? best.dir : null
          }

          void (async () => {
            /* Keep the cinema bars up for all of this. It's the last shot of the year. */
            engine.movie(true)
            /* Nothing is left to do, so the task line goes quiet. `objective(null)` hands the line
             * back to the year, and the year's line for a finished run would show across the top of
             * the departure, so the bar comes down for this last shot. */
            setRunEnding(true)
            engine.objective(null)
            const b = fromSea(berth.x, berth.y)

            /* 1: The camera leaves the player and moves to the boat. */
            camFree = true
            zoomTo(Z_MIN)
            camTo(b.x, b.y)
            await nap(CAM_TO_DOCK_MS)
            if (destroyed) return

            /* 2: The player is standing on the dock when the camera gets there, at a spot from
             * `dockSide`. `onFloor` with a radius of 44 finds no floor within 44 painting pixels of
             * either berth and gives back the point it was handed, which is on the water, so
             * `board()` would refuse. */
            if (!hull) {
              const at = dockSide() ?? onFloor({ x: b.x, y: b.y }, canStand, cfg.yScale, 96).at
              pos.x = at.x
              pos.y = at.y
              const look = dirFrom(b.x - at.x, (b.y - at.y) * (cfg.yScale || 1))
              if (look) walker.facing = look
            }
            await nap(DOCK_BEAT_MS)
            if (destroyed) return

            /* 3: The player gets in. Only the picture changes, the map stays the same. */
            board()
            void intentWorld.view('ship')
            await nap(BOARD_BEAT_MS)
            if (destroyed) return

            /* 4: The ship sets off from a standstill and heads out. */
            const she = hull as HullState | null
            if (she) {
              /* Steer the ship onto the heading instead of setting it directly. Writing a heading
               * straight onto the ship flips it around in one frame, so the helm below gets a
               * target point instead. */
              const dir = seaward(she) ?? she.heading
              const out = { x: she.x + Math.cos(dir) * 260, y: she.y + Math.sin(dir) * 260 }
              /* Use half the helm, because the ship is leaving, not heading somewhere. At full helm
               * it crosses the shot at 37 px/s, which is too brisk for a departure. */
              castOff = { x: out.x, y: out.y, until: performance.now() + SAIL_OUT_MS + 400, ease: 0.42 }
              she.speed = 0
              sailing = null
              helmOverride = null
              engine.log('sailed_out', { from: mapId })
            }
            await nap(SAIL_OUT_MS)
            if (destroyed) return
            home()
          })()
          return new Promise<void>(() => { /* The scene never comes back. */ })
        },

        /* The whole journey in one command, with the route read from the world instead of named by
         * the island. `enter` tears down this scene and its island, so `world/travel.ts` holds the
         * current leg for the scene that loads next. Nothing after this line in an island runs. */
        sailTo(to) {
          if (!comp) throw new NotBuilt('sail_to', 'there is no world document, so there is nowhere to sail to')
          if (to === mapId) throw new NotBuilt('sail_to', `you are already on "${to}"`)
          const want = berthOfRoute(comp, to)
          if (!want) {
            const have = comp.slots.filter((q) => q.berth).map((q) => q.map ?? q.place).filter(Boolean)
            throw new NotBuilt('sail_to', `"${to}" has no berth on the world, so there is no way to sail to it.`
              + ` What can be sailed to: ${have.join(', ') || '(nothing)'}`)
          }
          /* Every journey starts with the `to-dock` leg, even one that starts on a dock. Skipping
           * straight to the crossing would make a click on the chart look like the boat was already
           * leaving. */
          const leg = 'to-dock' as const
          /* Going home is the same journey with one extra step. The destination is an island either
           * way, and it's home because the home base is a door off that island, so the landing
           * walks up and goes through that door. */
          const home = !!comp && comp.slots.some((q) => q.map === MAW_MAP && q.place === slotOfMap(comp, to)?.place)
          if (!(canSail && berth) && !doorToWater()) {
            throw new NotBuilt('sail_to', `${mapId} has no berth and no door onto a map that has one,`
              + ' so there is no way down to the water from here')
          }
          beginTravel({ to, from: mapId, leg, home })
          /* The whole journey plays with the cinema bars up, from the first step to the far shore.
           * The engine owns the bars, and `settleVoyageFrame` takes them down at the end, so an
           * island never needs to know they were up. */
          setCinema(true, 'voyage')
          /* The task line for the journey isn't written into the island's own slot.
           * `ObjectivePanel` reads the live travel plan and shows it above everything while a
           * journey runs, so clearing it afterward can't delete the island's own line. */
          return runVoyageLeg()
        },

        enter(map, at, cover) {
          beginExit({ map, at }, cover)
          /* Resolves once the fade has really swapped the map. That way a station that walks
           * someone through a door doesn't run its next line on a scene that's being torn down. */
          return new Promise<void>((r, j) => { exitResolve = r; exitReject = j })
        },

        /* `cutscene` plays a script. It refuses an unknown script, or one that needs anchors this
         * map doesn't have. */
        cutscene(script) {
          /* The engine has no list of written scripts, so asking for a cutscene by name is always
           * refused. */
          throw new NotBuilt('cutscene', `no script named "${script}": a film is composed out of the vocabulary now`)
        },

        /* The player's own body: a named pose and a direction. This is how a map shows the player
         * waking up. */
        async pose(name, facing) {
          /* Check both arguments before using either one. */
          if (facing && !walkT[facing])
            throw new NotBuilt('pose', `"${facing}" is not a heading. They are: ${DIRS8.join(', ')}`)
          const key = name === undefined ? '' : String(name).toLowerCase()
          if (key && !(key in POSE_ART))
            throw new NotBuilt('pose', `"${name}" is not a pose. It has: ${Object.keys(POSE_ART).join(', ')}`)
          if (facing) walker.facing = facing
          if (!key) return
          const file = POSE_ART[key]
          /* Standing is the first frame of the walk set, so it's the one pose that can't be
           * missing. */
          if (file === null) { posed = null; return }
          let tex: Texture
          try {
            tex = await loadPose(file)
          } catch {
            /* Refuse and name the missing file, so nobody ships an island where the player never
             * wakes up. */
            throw new NotBuilt('pose', `"${key}" wants /art/characters/thor/pose/${file}.png and nothing answered for it`)
          }
          posed = { name: key, tex }
          poseAt.x = pos.x; poseAt.y = pos.y
        },

        /* ---- SOMEBODY ELSE'S BODY ------------------------------------------ */
        actorMove(actor, to, off, facing, pace) {
          const sp = actorBody(actor, 'actor_move')
          /* `thor` works as a destination. `place` puts a body in front of the player instantly,
           * which looks like it appeared out of nowhere. This does the same thing with a walk, and
           * stops at the clearance distance `place` uses. */
          if (to === PLAYER) {
            const d0 = take(sp)
            const ys0 = map.yScale || 1
            /* Stand closer than the usual push-apart gap. That gap is a body length plus ten
             * percent, which stops two figures overlapping but comes to about 120 screen pixels in
             * a close shot. Someone standing with the player should be closer than that. */
            const clear0 = map.character.heightPx * 0.72
            const ax0 = d0.x - pos.x, ay0 = d0.y - pos.y
            const away0 = Math.hypot(ax0, ay0 * ys0) || 1
            const want = { x: pos.x + (ax0 / away0) * clear0, y: pos.y + (ay0 / away0) * clear0 }
            const { at: spot } = onFloor(want, canStand, ys0, Math.round(clear0))
            const dir0 = dirFrom(spot.x - d0.x, (spot.y - d0.y) * ys0)
            if (dir0) d0.facing = dir0
            if (d0.move) { const orphan = d0.move.then; d0.move = null; orphan?.() }
            return new Promise<void>((resolve) => {
              d0.move = {
                tx: spot.x, ty: spot.y, speed: map.speed * PACE_OF[pace ?? 'walk'], done: false,
                then: () => {
                  /* The body faces the player when it gets there, since that's the whole reason it
                   * walked over. */
                  const at0 = dirFrom(pos.x - d0.x, (pos.y - d0.y) * ys0)
                  d0.facing = facing ?? at0 ?? d0.facing
                  resolve()
                },
              }
            })
          }
          const target = anchors.get(to)
          if (!target) throw new NotBuilt('actor_move', `no anchor named "${to}" on ${mapId}`)
          const home = anchors.standAt(target)
          /* An offset is measured from where a walk to this anchor really ends, which is the
           * snapped goal. */
          const at = off
            ? { ...asideFrom(target, walkGoal(target).goal.x, walkGoal(target).goal.y, off), facing: home.facing }
            : home
          const d = take(sp)
          /* Finish the leg that's already running instead of dropping it, so nothing waits forever. */
          if (d.move) { const orphan = d.move.then; d.move = null; orphan?.() }
          /* Someone walking over to meet the player stops in front of them, not inside them. */
          const ysm = map.yScale || 1
          let gx = at.x, gy = at.y
          /* Giving an offset turns the push off. The push is a guess for when nobody said where to
           * stand, and a typed offset is someone saying exactly where. */
          const clear = map.character.heightPx * 1.1
          if (!off && Math.hypot(gx - pos.x, (gy - pos.y) * ysm) < clear) {
            const ax = d.x - pos.x, ay = d.y - pos.y
            const away = Math.hypot(ax, ay * ysm) || 1
            gx = pos.x + (ax / away) * clear
            gy = pos.y + (ay / away) * clear
          }
          /* Snap the stop onto the floor. An anchor's raw stand point can be inside a wall, and
           * `the_hall`'s own pixel is inside the painted fire. The snap runs last, after the
           * clearance push, because pushing a body away from the player can push it into a wall. */
          const floored = onFloor({ x: gx, y: gy }, canStand, ysm, Math.round(clear)).at
          gx = floored.x; gy = floored.y
          /* Face the direction of travel while walking, so a body drawn in eight directions doesn't
           * moonwalk across the floor. */
          const dir = dirFrom(gx - d.x, (gy - d.y) * map.yScale)
          if (dir) d.facing = dir
          return new Promise<void>((resolve) => {
            d.move = {
              /* The pace, as a fraction of the map's own walking speed. */
              tx: gx, ty: gy, speed: map.speed * PACE_OF[pace ?? 'walk'], done: false,
              then: () => {
                /* The caller's direction wins, then the anchor's own, then whichever way the walk
                 * left it facing. */
                if (facing) d.facing = facing
                else if (at.facing) d.facing = at.facing
                resolve()
              },
            }
          })
        },

        /* One actor leads and the player follows, all in one command. When they stop, they turn to
         * face each other. */
        leadTo(actor, to, off, pace) {
          const sp = actorBody(actor, 'lead_to')
          const target = anchors.get(to)
          if (!target) throw new NotBuilt('lead_to', `no anchor named "${to}" on ${mapId}`)
          /* With an offset, the leader stops beside the station and leaves the spot for the player. */
          const { goal: standAt } = walkGoal(target)
          /* With no offset, the spot beside is worked out automatically, so nothing is measured by
           * hand and it still works after the map is republished. It's one body length to the side
           * of the player's own mark, at a right angle to the line they walked in on, on whichever
           * side is floor and further from the station. That way the two look like people talking. */
          const asideAuto = (fromX: number, fromY: number) => {
            const ysA = map.yScale || 1
            const clear = map.character.heightPx * 1.1
            /* The direction of the approach, measured on the ground, and the direction at a right
             * angle to it. */
            const ax = standAt.x - fromX, ay = (standAt.y - fromY) / ysA
            const len = Math.hypot(ax, ay) || 1
            const px = -ay / len, py = ax / len
            const spot = anchors.spotOf(target)
            let best: { x: number; y: number } | null = null
            let bestAway = -1
            for (const sign of [1, -1]) {
              const want = { x: standAt.x + px * clear * sign, y: standAt.y + py * clear * ysA * sign }
              const { at, moved } = onFloor(want, canStand, ysA, Math.round(clear))
              /* If the floor snap had to move the spot a long way, there's no room on that side. */
              if (moved && Math.hypot(at.x - want.x, at.y - want.y) > clear * 0.6) continue
              /* Of the two sides, pick the one further from the thing being talked about, so nobody
               * ends up standing on it. */
              const away = Math.hypot(at.x - spot.x, (at.y - spot.y) / ysA)
              if (away > bestAway) { bestAway = away; best = at }
            }
            return best ?? standAt
          }
          const goal = off
            ? { ...asideFrom(target, standAt.x, standAt.y, off), facing: standAt.facing }
            : { ...asideAuto(take(sp).x, take(sp).y), facing: standAt.facing }
          const ys = map.yScale || 1
          /* Two body lengths, far enough that the leader is never drawn on top of the person
           * following. */
          const gap = Math.max(12, Math.round(map.character.heightPx * 2))
          /* If the leader can't move at all, the player doesn't stand there watching nothing. After
           * this long they set off anyway. */
          const LEAD_CEILING_MS = 2500
          const d = take(sp)
          const speed = map.speed * PACE_OF[pace ?? 'walk']
          const r = findPath(doc, cfg, { x: d.x, y: d.y }, goal, { step: 4, reach: 3 })
          const legs = r.points.length > 1 ? r.points.slice(1) : [{ x: goal.x, y: goal.y }]
          if (!r.reached) {
            console.warn(`[pmap] lead_to: no route for "${actor}" to ${to}, steering straight at it`)
          }

          /* One move carries the whole route, so the walk animation doesn't restart on every leg. */
          const leader = new Promise<void>((settle) => {
            if (d.move) { const orphan = d.move.then; d.move = null; orphan?.() }
            const first = legs[0]
            d.move = { tx: first.x, ty: first.y, via: legs.slice(1), speed, done: false, then: settle }
            /* The first direction comes from a point further along the route, the same as every
             * later one. */
            const look0 = aheadAlong(d.move, d.x, d.y, Math.max(6, map.character.heightPx * 0.9), ys)
            const dir0 = dirFrom(look0.x - d.x, (look0.y - d.y) * ys)
            if (dir0) d.facing = dir0
          })

          const behind = (async () => {
            const t0 = performance.now()
            /* Wait frame by frame until the leader is a couple of body lengths ahead, measured as
             * distance on the ground. */
            while (!destroyed
              && performance.now() - t0 < LEAD_CEILING_MS
              && Math.hypot(d.x - pos.x, (d.y - pos.y) / ys) < gap) {
              await new Promise<void>((r2) => { requestAnimationFrame(() => r2()) })
            }
            if (destroyed) return
            await new Promise<void>((r2) => {
              /* The reach is the gap. The ticker keeps that gap every frame so the leader stays in
               * front. */
              startWalk(goal, gap, goal.facing ?? null, r2, `${to}, behind ${actor}`,
                { follow: { body: sp, gap, speed } })
            })
          })()

          /* When they stop, they turn to look at each other. */
          return Promise.all([leader, behind]).then(() => {
            if (destroyed) return
            const end = take(sp)
            const back = dirFrom(pos.x - end.x, (pos.y - end.y) * ys)
            if (back) end.facing = back
            const at = dirFrom(end.x - pos.x, (end.y - pos.y) * ys)
            if (at) walker.facing = at
          })
        },

        /* `place`: someone is already standing there when the scene opens, out of the player's way. */
        place(actor, at, off, facing) {
          const sp = actorBody(actor, 'place')
          const ysp = map.yScale || 1
          const clearP = map.character.heightPx * 1.1
          /* The player counts as a place. With no offset, the body shows up one body length in
           * front of the player. */
          const AHEAD: Record<string, [number, number]> = {
            east: [1, 0], 'south-east': [0.7071, 0.7071], south: [0, 1], 'south-west': [-0.7071, 0.7071],
            west: [-1, 0], 'north-west': [-0.7071, -0.7071], north: [0, -1], 'north-east': [0.7071, -0.7071],
          }
          const target = at === PLAYER ? null : anchors.get(at)
          if (at !== PLAYER && !target) throw new NotBuilt('place', `no anchor named "${at}" on ${mapId}`)
          if (facing && !DIRS8.includes(facing)) {
            throw new NotBuilt('place', `"${facing}" is not a heading. They are: ${DIRS8.join(', ')}`)
          }
          const home = target
            ? anchors.standAt(target)
            : (() => {
              const [ux, uy] = AHEAD[walker.facing] ?? AHEAD.south
              /* Snap it to the floor, because there might be a wall in front of the player. */
              const want = { x: pos.x + ux * clearP, y: pos.y + uy * clearP * ysp }
              return { ...onFloor(want, canStand, ysp, Math.round(clearP)).at, facing: undefined }
            })()
          const spot = off
            ? target
              /* Use the same base point `lead_to` and `actor_move` use: where the walk rules really
               * put a body at this anchor, not the raw pixel the author placed. */
              ? { ...asideFrom(target, walkGoal(target).goal.x, walkGoal(target).goal.y, off), facing: home.facing }
              /* An offset from the player is measured from the player's feet, not from the spot in
               * front. */
              : { ...onFloor({ x: pos.x + off[0], y: pos.y + off[1] }, canStand, ysp, 24).at, facing: undefined }
            : home
          const d = take(sp)
          if (d.move) { const orphan = d.move.then; d.move = null; orphan?.() }
          let px = spot.x, py = spot.y
          /* The clearance push is only a fallback, so giving an offset turns it off. */
          if (!off && at !== PLAYER && Math.hypot(px - pos.x, (py - pos.y) * ysp) < clearP) {
            /* The body steps back along the line it was already on. If it was standing right on the
             * player, it steps off to one side. */
            const ax = d.x - pos.x, ay = d.y - pos.y
            const away = Math.hypot(ax, ay * ysp) || 1
            const ux = away > 1 ? ax / away : 1
            const uy = away > 1 ? ay / away : 0
            px = pos.x + ux * clearP
            py = pos.y + uy * clearP
          }
          d.x = px; d.y = py
          if (facing) d.facing = facing
          else {
            /* With no direction given, they end up looking at each other. */
            d.facing = dirFrom(pos.x - px, (pos.y - py) * ysp) ?? d.facing
            const back = dirFrom(px - pos.x, (py - pos.y) * ysp)
            if (back) walker.facing = back
          }
          sp.position.set(d.x, d.y)
          sp.zIndex = d.y
        },

        /* Every check runs before the body is taken over, so a refusal leaves nothing being driven. */
        actorFace(actor, facing) {
          /* `player` is the only heading that gets worked out instead of typed, because the
           * direction toward the player depends on where both of them ended up, and only the scene
           * knows that. `actor_face(x, "thor")` turns someone toward the player and
           * `actor_face("thor", x)` turns the player toward someone, so an island never has to type
           * a compass direction. */
          if (actor === PLAYER) {
            const a2 = anchors.get(facing)
            if (!a2)
              throw new NotBuilt('actor_face', `"thor" can be turned to look at a place, and `
                + `there is nothing called "${facing}" on ${mapId}. `
                + 'To point him at a compass heading, walk him there instead.')
            const at2 = anchors.spotOf(a2)
            const turn = dirFrom(at2.x - pos.x, (at2.y - pos.y) * (map.yScale || 1))
            /* Standing exactly on the thing gives no direction. Leaving the heading alone is better
             * than guessing. */
            if (turn) walker.facing = turn
            return
          }
          const sp = actorBody(actor, 'actor_face')
          if (facing === PLAYER) {
            const d0 = take(sp)
            const at = dirFrom(pos.x - d0.x, (pos.y - d0.y) * (map.yScale || 1))
            if (at) d0.facing = at
            return
          }
          const set = looksOf.get(sp)
          const look = set && (set[driven.get(sp)?.look ?? 0] ?? set[0])
          /* Something drawn facing only one way can't turn, and the error says so. */
          if (!look?.views || !Object.keys(look.views).length)
            throw new NotBuilt('actor_face', `"${actor}" was drawn one way and has no heading to turn to`)
          /* Anyone can be turned to a compass heading or to look at a place. A name the map doesn't
           * have is refused. */
          if (DIRS8.includes(facing)) { take(sp).facing = facing; return }
          const place = anchors.get(facing)
          if (!place)
            throw new NotBuilt('actor_face', `"${facing}" is neither a heading nor a place on ${mapId}. `
              + `Headings are ${DIRS8.join(', ')}, and a place is any anchor on this map.`)
          const d1 = take(sp)
          const spot = anchors.spotOf(place)
          const turn = dirFrom(spot.x - d1.x, (spot.y - d1.y) * (map.yScale || 1))
          /* Standing on the thing gives no direction. A guess would be worse than the heading they
           * already had. */
          if (turn) d1.facing = turn
        },

        actorLook(actor, look) {
          const sp = actorBody(actor, 'actor_look')
          const set = looksOf.get(sp)
          const names = lookNamesOf.get(sp) ?? []
          const index = (): number => {
            /* The placement's own picture is always index 0 and can always be asked for, whatever
             * it was named, so a script can put a thing back the way it found it. */
            if (look === 'idle' || look === 'default') return 0
            const named = names.indexOf(look)
            if (named >= 0) return named
            /* A number still works as a look. Bundles made before looks had names can only use
             * numbers, and those bundles are still on the platform. */
            const i = Number(look)
            if (Number.isInteger(i) && i >= 0 && i < (set?.length ?? 0)) return i
            const have = names.filter(Boolean)
            throw new NotBuilt('actor_look',
              `"${actor}" has no face called "${look}". It has: ${have.length ? have.join(', ') : `nothing named, and ${set?.length ?? 0} unnamed`}`)
          }
          const want = index()
          take(sp).look = want
        },

        actorRelease(actor) {
          if (!actor) { releaseDriven(); return }
          releaseDriven(actorBody(actor, 'actor_release'))
        },

        /* `route` follows the polylines MAPVIS publishes. The route's kind is checked, not trusted. */
        route(pathName, who, backwards) {
          /* Check the map's own paths first. A line drawn on the painting is the more specific
           * answer, so a map that names a route after a berth gets its own drawing instead of the
           * world's. */
          const p = paths.find((q) => q.name === pathName) ?? seaRouteNamed(pathName)
          if (!p) {
            const sea = comp ? approachNames(comp) : []
            throw new NotBuilt('route', `no path named "${pathName}" on ${mapId}. `
              + `It has: ${pathNames(paths).join(', ') || 'none'}`
              + (sea.length
                ? `; and the ocean can be sailed to: ${sea.join(', ')}, by that name or as "<island>_approach"`
                : ''))
          }
          if (backwards && !p.twoWay)
            throw new NotBuilt('route', `"${pathName}" is one-way, so it cannot be run backwards`)
          if (who === 'ship') return sailRoute(p, backwards)
          if (p.kind === 'sail')
            throw new NotBuilt('route', `"${pathName}" is a sail route, so only the ship can take it`)
          /* Check the ground before anyone sets off. The error names the pixel where the route goes
           * wrong. */
          if (p.kind === 'walk') {
            const bad = walkFaults(p, (x, y) => canStand(x, y))
            if (bad.length)
              throw new NotBuilt('route',
                `"${pathName}" crosses ground nobody can stand on, first at ${bad[0].at.x},${bad[0].at.y} on leg ${bad[0].leg}`)
          }
          return who === 'player' ? walkRoute(p, backwards) : actorRoute(who, p, backwards)
        },

        /* A named shot someone dragged into place. Its zoom is a multiple of the opening view. */
        framing(shot, ms) {
          /* Every shot bumps the serial number, so a timed release that fires later can tell
           * whether its shot is still the current one. */
          shotSerial++
          if (shot === null) {
            lookAtTarget = null
            lastShot = null
            setShotUp(false)
            zoomTo(walkZ())
            return Promise.resolve()
          }
          const s = shots.get(shot)
          if (!s)
            throw new NotBuilt('framing', `no shot named "${shot}" on ${mapId}. It has: ${[...shots.keys()].join(', ') || 'none'}`)
          const spot = anchors.spotOf(s.anchor as Anchor)
          const at = shotOf(spot, s.framing)
          /* With no time given, the shot holds until it's given back. A scene usually sets up a
           * shot and then has dialogue over it, and a shot that ends in the middle of a line looks
           * like a mistake. */
          lookAtTarget = { x: at.x, y: at.y, until: ms === undefined ? Infinity : performance.now() + ms }
          lastShot = shot
          /* A composed shot hides the HUD. The island has pointed the camera at something on
           * purpose, and the corner buttons aren't part of that picture. It's the same kind of
           * attribute as the cinema bars but separate, because a shot isn't a cutscene and
           * shouldn't letterbox. */
          setShotUp(true)
          if (s.framing.zoom !== undefined) zoomTo(Math.min(Z_SHOT * s.framing.zoom, SHOT_ZOOM_MAX()))
          engine.log('framing', { map: mapId, shot, zoom: s.framing.zoom ?? null })
          /* Resolve only when the camera has really arrived, position as well as zoom, or a panel
           * can open over a camera that's still moving. There's a time limit like `view` has, so a
           * camera that can't arrive doesn't hold the island up. */
          const settled = new Promise<void>((r) => {
            const t0 = performance.now()
            const tick = () => {
              if (destroyed) { r(); return }
              const zoomThere = Math.abs(camZ - camZWant) < 0.01
              /* Measure in painting pixels, not screen pixels. In a close shot a pan can cover
               * three thousand screen pixels, and a screen-pixel tolerance would never be met in
               * time. */
              /* A third of a painting pixel. A whole pixel of slack shows up as visible sliding
               * after the panel has already opened, because the player sees the camera drift. */
              const slack = Math.max(1.5, camZ * 0.34)
              const panThere = Math.abs(camFX - camAim.x) < slack && Math.abs(camFY - camAim.y) < slack
              if ((zoomThere && panThere) || performance.now() - t0 > SHOT_CEILING_MS) { r(); return }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          if (ms === undefined) return settled
          /* Restart the hold timer once the camera arrives. `until` above was set when the command
           * was given, so a long pan could use up the whole hold before the camera even got there. */
          const held = shotSerial
          return settled.then(() => {
            if (destroyed || shotSerial !== held) return undefined
            if (lookAtTarget) lookAtTarget = { ...lookAtTarget, until: performance.now() + ms }
            return new Promise<void>((r) => setTimeout(() => {
              /* If a newer shot has started, it keeps the camera and this old one does nothing. */
              if (destroyed || shotSerial !== held) { r(); return }
              lookAtTarget = null
              setShotUp(false)
              lastShot = null
              zoomTo(walkZ())
              r()
            }, ms))
          })
        },

        /* The three shots nobody authors. They're built from the painting and the window size, and
         * a script can await them. */
        /* The player steps off the ship when the island says so, using the same stepAshore the
         * berth prompt uses. */
        ashore() {
          stepAshore(true)
          return Promise.resolve()
        },

        view(shot, ms) {
          shotSerial++
          const to = shot === 'island' ? Z_ISLAND
            : shot === 'ship' ? Z_SHIP
              : shot === 'close' ? Z_CLOSE
                : shot === 'sail' ? Z_MIN : walkZ()
          /* The wide shot centers on the painting instead of the player, and it holds. */
          if (shot === 'island') {
            lookAtTarget = { x: pc.x, y: pc.y, until: ms === undefined ? Infinity : performance.now() + ms }
            lastShot = 'island'
            /* Keep the camera fenced inside the painting while the wide shot holds. */
            camFree = false
          } else {
            lookAtTarget = null
            setShotUp(false)
            lastShot = null
          }
          /* Never zoom out past the painting's own cover fit. Going under `zoomTo`'s floor would
           * show the player the empty void around the painting. */
          camZWant = Math.max(Z_MIN, to)
          engine.log('view', { map: mapId, shot, zoom: +to.toFixed(3) })
          const arrived = new Promise<void>((r) => {
            const t0 = performance.now()
            const tick = () => {
              if (destroyed) { r(); return }
              if (Math.abs(camZ - camZWant) < 0.01 || performance.now() - t0 > VIEW_CEILING_MS) { r(); return }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          /* If an arrival card is waiting to show, show it on the wide shot once the camera has
           * settled. */
          if (shot === 'island') return arrived.then(() => {
            arrivalCard()
            if (ms === undefined) return undefined
            /* A timed wide shot gives back the whole camera, because `lookAtTarget` expiring only
             * stops the centering, and the fence and the zoom are kept separately. It only lowers
             * the shot it raised. The serial is checked on the way out, so a late release can't
             * tear down a closer shot that started after it. */
            const mine = shotSerial
            return new Promise<void>((r) => setTimeout(() => {
              if (destroyed || shotSerial !== mine) { r(); return }
              lookAtTarget = null
              setShotUp(false)
              lastShot = null
              /* Set it to false, which is the value for a body on land. `camFree` true means the
               * camera is at sea and isn't kept inside the painting, so setting it true here would
               * let the ocean show past the painting's edge. */
              camFree = false
              camZWant = walkZ()
              r()
            }, ms))
          })
          if (ms === undefined) return arrived
          return arrived.then(() => new Promise<void>((r) => setTimeout(r, ms)))
        },

        /* `wait_for` waits until the player reaches an anchor, and returns whether that happened. */
        waitFor(name, ms) {
          const a = anchors.get(name)
          if (!a) throw new NotBuilt('wait_for', `no anchor named "${name}" on ${mapId}`)
          if (anchors.contains(a, pos.x, pos.y)) return Promise.resolve(true)
          /* The station's hold steps aside, or the player could never walk to the thing being
           * waited for. */
          const resume = suspendStationHold()
          return new Promise<boolean>((done) => {
            waiters.push({
              a,
              /* It can't wait forever, so a member gets a time window and a False to check for. */
              until: performance.now() + Math.min(ms ?? WAIT_FOR_CEILING_MS, WAIT_FOR_CEILING_MS),
              done: (v) => { resume(); done(v) },
            })
          })
        },
      }
      const intentHost: IntentHost = { world: intentWorld, engine }

      /* The thirteen cutscene stage methods. They work in painting pixels, which is this scene's
       * world unit. */
      const stage: CutsceneStage = {
        cameraGet: () => csCam ? { ...csCam } : { x: pos.x, y: pos.y, zoom: camZ / Z },
        cameraSet: (x, y, zoom) => { csCam = { x, y, zoom } },
        /* Handing the camera to the player means handing it back to the normal follow camera, which
         * is the only camera this scene has. */
        cameraFollow: (actor) => {
          if (actor === null || IS_THOR(actor)) { csCam = null; return }
          /* This scene's camera only follows the player. Asking it to follow anyone else warns and
           * counts as a missed cue, instead of quietly leaving the camera wherever the last shot
           * put it. */
          console.warn(`[pmap] cameraFollow("${actor}"): this scene's camera can only follow the player`)
          stageMissed(`cameraFollow("${actor}")`)
        },

        /* A state is another look of a placement, which MAPVIS stores as an index. */
        actorState: (actor, state) => {
          if (IS_THOR(actor)) return                       // The player's frames are the walk set.
          const sp = actorSprite(actor)
          if (!sp) { console.warn(`[pmap] actorState: no placement named "${actor}" on ${mapId}`); return }
          const d = take(sp)
          if (state === 'idle' || state === 'default') { d.look = 0; return }
          const i = Number(state)
          if (Number.isFinite(i)) { d.look = i; return }
          console.warn(`[pmap] actorState("${actor}", "${state}"): a look is an index in the bundle and this map carries no name for one`)
        },

        actorPlace: (actor, x, y, face) => {
          if (IS_THOR(actor)) {
            pos.x = x; pos.y = y
            if (face) walker.facing = face
            return
          }
          const sp = actorSprite(actor)
          if (!sp) { console.warn(`[pmap] actorPlace: no placement named "${actor}" on ${mapId}`); return }
          const d = take(sp)
          d.x = x; d.y = y; d.move = null
        },

        /* The caller polls the returned function to see if the move is done. Thor walks by the walk
         * rules, and a placement gets carried. */
        actorMove: (actor, x, y, speed, face) => {
          if (IS_THOR(actor)) {
            const m = { done: false }
            startWalk({ x, y }, 4, null, () => { if (face) walker.facing = face; m.done = true })
            return () => m.done
          }
          const sp = actorSprite(actor)
          /* A move that never happened must not count as a finished move, so it's recorded as a
           * missed cue. */
          if (!sp) {
            console.warn(`[pmap] actorMove: no placement named "${actor}" on ${mapId}`)
            stageMissed(`actorMove("${actor}")`)
            return () => true
          }
          const d = take(sp)
          d.move = { tx: x, ty: y, speed: speed ?? map.speed, done: false }
          const mv = d.move
          return () => !!mv.done
        },

        actorPos: (actor) => {
          if (IS_THOR(actor)) return { x: pos.x, y: pos.y }
          const sp = actorSprite(actor)
          /* (0, 0) isn't a real answer, so an unknown actor falls back to the player's position. */
          if (!sp) {
            console.warn(`[pmap] actorPos: no placement named "${actor}" on ${mapId}`)
            stageMissed(`actorPos("${actor}")`)
            return { x: pos.x, y: pos.y }
          }
          const d = driven.get(sp)
          return d ? { x: d.x, y: d.y } : { x: sp.position.x, y: sp.position.y }
        },

        /* Turns a placement a script has taken over, using the directions it was drawn in. */
        actorFace: (actor, dir) => {
          if (IS_THOR(actor)) { walker.facing = dir; return }
          const sp = actorSprite(actor)
          if (!sp) {
            console.warn(`[pmap] actorFace: no placement named "${actor}" on ${mapId}`)
            stageMissed(`actorFace("${actor}")`)
            return
          }
          const d = take(sp)
          const set = looksOf.get(sp)
          const look = set && (set[d.look ?? 0] ?? set[0])
          const views = look?.views
          if (!views || !Object.keys(views).length) {
            console.warn(`[pmap] actorFace("${actor}", "${dir}"): this placement was drawn one way and has no heading to turn to`)
            stageMissed(`actorFace("${actor}")`)
            return
          }
          d.facing = dir
        },

        actorShow: (actor, visible) => {
          if (IS_THOR(actor)) { thor.sp.visible = visible; thor.sh.visible = visible; pinWanted = visible; return }
          const sp = actorSprite(actor)
          if (!sp) { console.warn(`[pmap] actorShow: no placement named "${actor}" on ${mapId}`); return }
          take(sp).visible = visible
        },

        /* The script's fx and the intent's fx are the same command, with one library and one way of
         * refusing. */
        fx: (name, at) => {
          try {
            void playFx(name, at ?? { x: pos.x, y: pos.y })
          } catch (e) {
            console.warn(`[pmap] ${e instanceof Error ? e.message : String(e)}`)
            engine.log('fx_missing', { map: mapId, name })
            stageMissed(`fx "${name}"`)
          }
        },

        /* `audio` plays a named sound cue and refuses one the library doesn't have. */
        audio: (cue) => {
          try {
            playSfx(cue)
          } catch (e) {
            console.warn(`[pmap] ${e instanceof Error ? e.message : String(e)}`)
            engine.log('audio_missing', { map: mapId, cue })
            stageMissed(`audio "${cue}"`)
          }
        },

        /* The catch-all for calls this scene doesn't have. A `stage` step that names one gets
         * nothing back, so it warns with the call's name and counts it as a missed cue. */
        call: (name) => {
          console.warn(`[pmap] the script asked this scene for "${name}" and it answers no such call`)
          engine.log('stage_call_missing', { map: mapId, call: name })
          stageMissed(`stage call "${name}"`)
        },

        /* The hold is tracked, so a gate that hands control back in the middle of a script doesn't
         * fight the station's hold. */
        playerControl: (on) => {
          if (on) { csHold?.(); csHold = null }
          else csHold ??= holdWorld('cutscene')
        },
      }

      const runtime = new CutsceneRuntime(stage)
      teardownStage = () => {
        unpublish?.(); unpublish = null
        csHold?.(); csHold = null
        stationHold?.(); stationHold = null
        releaseDriven()
        /* Answer every promise this scene still owes before it goes away. */
        while (waiters.length) waiters.pop()!.done(false)
        sailing = null
        sailingTo = null
        endVoyage(new NotBuilt('route', 'the map was left while the ship was still on the route'))
        /* Finish the walk too. Otherwise its world hold would stay taken for as long as the tab is
         * open. */
        if (autoWalk) { const w3 = autoWalk; autoWalk = null; w3.done() }
        /* The player isn't on this map anymore, so clear it from the logging context. */
        setContext({ map: null, place: null })
      }

      /* A station's hold steps aside for the script it started, and gets taken again afterward. */
      const suspendStationHold = (): (() => void) => {
        const held = stationHold
        if (!held) return () => { /* Nothing was holding. */ }
        held()
        stationHold = null
        return () => { stationHold = holdWorld('station:resumed') }
      }

      /* Guide, auto-walk and camera-look state, updated in the loop below. */
      let guideTarget: Anchor | null = null
      type AutoWalk = {
        goal: { x: number; y: number }
        reach: number
        facing: string | null
        route: Pt[]
        ri: number
        /** How long the walker has reported being blocked on the current leg. */
        stuckMs?: number
        until: number
        /* The deadline is based on progress, not time passed, so a slow computer still gets there. */
        /**
         * The time budget, which renews when the walk makes progress, and the hard limit it can
         * never pass.
         */
        budget: number
        ceiling: number
        /** The closest the player has ever been to the goal, in painting pixels. */
        best: number
        label: string
        /* Following means keeping position behind the leader every frame, at the leader's pace,
         * never the player's own. */
        follow?: {
          /** The body being followed, read live from `driven`. */
          body: Sprite
          /** How far behind the leader the player walks, in painting pixels of ground. */
          gap: number
          /** The pace for closing the last bit of the gap once the leader has stopped. */
          speed: number
        }
        /* Whether the walk rules could find any path to the goal when this walk started. */
        routed: boolean
        /* `done` is called on every way out. `arrive` only runs when the player really got there. */
        done: () => void
        arrive?: () => void
        /* Who started the walk, which decides whether opening a panel cancels it. */
        byPlayer?: boolean
      }
      let autoWalk: AutoWalk | null = null
      /* The hold hook is set up outside `start()`, above `autoWalk`, so it reaches this through a
       * box instead of through the variable directly. */
      cancelPlayerWalk = () => {
        if (!autoWalk?.byPlayer) return
        const w = autoWalk
        autoWalk = null
        w.done()
      }
      let lookAtTarget: { x: number; y: number; until: number } | null = null
      /* Which shot is the current one. It counts up every time any shot is set, so a timed release
       * can't lower a shot that has replaced it. */
      let shotSerial = 0
      /* Which named shot the camera is holding, and which berth the last voyage aimed at. */
      let lastShot: string | null = null
      let lastBerth: string | null = null
      /* What the objective marker pointed at on the last frame. */
      let leading: string | null = null
      let exitResolve: (() => void) | null = null
      /* This is how a refused door tells the island, instead of resolving as if it opened. */
      let exitReject: ((e: Error) => void) | null = null

      /* One walk with three callers: `walk_to` from a grape, `actorMove` from a script, and the
       * idle auto-walk that a `walkTo` gate falls back to when the player stands still. */
      /* Steers a body toward a point using the eight moves the walker can make. */
      const OCTANTS: { ux: number; uy: number; keys: Record<string, boolean> }[] = [
        { ux: 1, uy: 0, keys: { arrowright: true } },
        { ux: 1, uy: 1, keys: { arrowright: true, arrowdown: true } },
        { ux: 0, uy: 1, keys: { arrowdown: true } },
        { ux: -1, uy: 1, keys: { arrowleft: true, arrowdown: true } },
        { ux: -1, uy: 0, keys: { arrowleft: true } },
        { ux: -1, uy: -1, keys: { arrowleft: true, arrowup: true } },
        { ux: 0, uy: -1, keys: { arrowup: true } },
        { ux: 1, uy: -1, keys: { arrowright: true, arrowup: true } },
      ]
      const steerToward = (dx: number, dy: number, dt: number): Record<string, boolean> => {
        if (Math.hypot(dx, dy) < 0.5) return {}
        const ys = map.yScale || 1
        const o = ((Math.round(Math.atan2(dy / ys, dx) / (Math.PI / 4)) % 8) + 8) % 8
        const cur = lvlAt(pos.x, pos.y)
        const sp = cfg.speed * TEST_SPEED * dt
        for (const off of [0, 1, -1, 2, -2]) {
          const c = OCTANTS[(o + off + 8) % 8]
          const m = Math.hypot(c.ux, c.uy)
          const nx = pos.x + (c.ux / m) * sp
          const ny = pos.y + (c.uy / m) * sp * ys
          if (lawCanStandFrom(doc, cfg, nx, ny, cur)) return c.keys
        }
        return OCTANTS[o].keys
      }

      /* Where a walk to an anchor really ends, and how close counts as arrived. */
      const walkGoal = (a: Anchor) => {
        const g = anchors.standAt(a)
        /* Nobody stands on top of the thing they came to look at. If an anchor has no stand point,
         * the fallback is the floor one body length back along the approach. `onFloor` still has
         * the final say, and a stand point the author placed isn't touched. */
        /* Only for posts, not doors. A post is something to stand beside and a door is somewhere to
         * walk into, so stepping back a body length from a door would stop short of where it leads. */
        if (!a.stand && a.kind === 'post') {
          const ys0 = cfg.yScale || 1
          const back = map.character.heightPx * 1.1
          const dx = pos.x - g.x, dy = (pos.y - g.y) / ys0
          const len = Math.hypot(dx, dy)
          if (len > 1) {
            g.x += (dx / len) * back
            g.y += (dy / len) * back * ys0
          }
        }
        /* A stand point the author placed gets checked too, because one off the floor can never be
         * reached. */
        const { at, moved } = onFloor(g, canStand, cfg.yScale, Math.max(24, a.r))
        if (moved) {
          console.info(`[pmap] ${mapId}: "${a.name}"'s ${a.stand ? 'stand point' : 'own pixel'} `
            + `is ground nobody can stand on, so a walk to it ends at ${at.x},${at.y} instead`)
        }
        return {
          goal: { ...at, facing: g.facing },
          /* An exact spot, placed by the author or found by the floor snap, gets the tight 3 pixel
           * tolerance. Only a raw anchor center falls back to a radius around itself. */
          reach: a.stand || moved ? 3 : Math.max(4, a.r * 0.5),
        }
      }

      /* A second spot next to the authored one, snapped to the floor. If the snap moves it, the
       * console says so. */
      const asideFrom = (a: Anchor, x: number, y: number, off: Offset) => {
        const want = { x: x + off[0], y: y + off[1] }
        const { at, moved } = onFloor(want, canStand, cfg.yScale, Math.max(24, a.r))
        if (moved) {
          console.info(`[pmap] ${mapId}: "${a.name}" plus off ${off[0]},${off[1]} is ${Math.round(want.x)},`
            + `${Math.round(want.y)}, which is ground nobody can stand on, so the body goes to `
            + `${Math.round(at.x)},${Math.round(at.y)} instead`)
        }
        return at
      }

      const startWalk = (
        goal: { x: number; y: number }, reach: number, facing: string | null,
        done: () => void, label = 'a point',
        opts: { byPlayer?: boolean; arrive?: () => void; follow?: AutoWalk['follow'] } = {},
      ) => {
        /* Finish the walk that's already running instead of dropping it, so nothing waits forever. */
        if (autoWalk) {
          console.warn(`[pmap] the walk to ${autoWalk.label} was replaced by one to ${label}`)
          const orphan = autoWalk
          autoWalk = null
          orphan.done()
        }
        const r = findPath(doc, cfg, { x: pos.x, y: pos.y }, goal, { step: 4, reach })
        if (!r.reached) console.warn(`[pmap] walk to ${label}: no route from here, steering straight at it`)
        /* A walk with no route gets 3 seconds instead of 20, and the console says it has no route. */
        const budget = r.reached ? 20000 : 3000
        autoWalk = {
          goal, reach, facing, route: r.points, ri: 0,
          until: performance.now() + budget, budget,
          /* Two minutes. That's longer than any walk on any map in this game, and short enough that
           * a body stuck on scenery still gives an answer. */
          ceiling: performance.now() + 120000,
          best: Math.hypot(goal.x - pos.x, goal.y - pos.y),
          label, done,
          routed: r.reached, byPlayer: opts.byPlayer, arrive: opts.arrive,
          follow: opts.follow,
        }
      }

      /* A click is a destination: first an anchor that wants a press, then the floor. */
      /* What pressing E would do at sea. It's kept up here so a click and a key press can't do
       * different things. */
      let seaFire: (() => void) | null = null
      /* Where a click asked the boat to go. It's steered with the same maneuver the voyage uses. */
      let sailTap: { x: number; y: number; until: number } | null = null
      /* The farthest one click on the water moves the ship, in painting pixels. That's about a
       * third of the hub's width, enough to feel like steering but never enough to lose the island
       * off the edge of the screen at sailing zoom. */
      const SAIL_TAP_LEG = 220

      /* Handles a click on an anchor, wherever the click came from. Returns true when a walk to it
       * has started. */
      const tapAnchor = (a: Anchor): boolean => {
        if (!offerOf(a).canFire) return false
        const { goal: g, reach } = walkGoal(a)
        /* Use the name the player has been reading, not the one the author typed. */
        const shown = labelFor(a.label, a.name)
        /* Use the same reach `walk_to` uses, so a click and a member's code end up in the same
         * spot. A stand point the author placed is exact, and without one the ring's radius is the
         * tolerance. */
        startWalk(g, reach, g.facing ?? null,
          () => { /* Nothing is waiting on it. */ }, shown,
          { byPlayer: true, arrive: () => { void fire(a) } })
        engine.log('click_walk', { map: mapId, anchor: a.name })
        return true
      }

      const walkTap = (px: number, py: number): 'fired' | 'walking' | 'busy' | 'nothing' => {
        /* On board, a click near the berth docks the ship and a click on water sets a heading. */
        /* While the arrival card is up, a tap goes to the card and doesn't walk the player
         * anywhere. */
        if (placeCardUp()) return 'busy'
        if (hull) {
          if (berthing || worldHeld() || busy || fade) return 'busy'
          if (seaFire) { seaFire(); return 'fired' }
          /* Water means a heading, and land means a request to dock. */
          if (depthAt(px, py) >= DEFAULT_SAIL.probe) {
            /* A click is a nudge. The ship sails one leg toward it and stops, so the island stays
             * on screen. */
            const far = Math.hypot(px - hull.x, py - hull.y)
            const leg = Math.min(far, SAIL_TAP_LEG)
            const tx = far > 0 ? hull.x + ((px - hull.x) * leg) / far : px
            const ty = far > 0 ? hull.y + ((py - hull.y) * leg) / far : py
            sailTap = { x: tx, y: ty, until: performance.now() + 30000 }
            engine.log('sail_tap', { map: mapId, to: [Math.round(px), Math.round(py)], leg: Math.round(leg) })
            return 'walking'
          }
          if (slot?.berth) {
            sailTap = null
            dockAt(slot)
            engine.log('sail_tap_ashore', { map: mapId, place: slot.place ?? null })
            return 'fired'
          }
          note('There is nowhere to tie up here.')
          return 'nothing'
        }

        /* One gate, the same one pressing E uses. Being on board is handled separately above. */
        if (hull || berthing || worldHeld() || busy || fade) return 'busy'

        const a = anchors.nearestInteractive(px, py)
        if (a && tapAnchor(a)) return 'fired'

        /* The floor: the player walks as far as the path search says they can really get. */
        const r = findPath(doc, cfg, { x: pos.x, y: pos.y }, { x: px, y: py }, { step: 4 })
        const end = r.reached ? { x: px, y: py } : r.points[r.points.length - 1]
        if (!end || (Math.hypot(end.x - pos.x, end.y - pos.y) < 6 && !r.reached)) {
          /* Tell the player, because this is the one case where a tap does nothing at all. */
          note('You cannot get there from here.')
          engine.log('click_nowhere', { map: mapId, to: [Math.round(px), Math.round(py)] })
          return 'nothing'
        }
        /* Click to move is a setting, and it's checked here instead of in the tap handler. Every
         * tap above this line is on a thing (a station, the boat, the arrival card, a berth) and
         * those always work, so the setting only controls walking to bare floor. */
        if (!loadSettings().clickToMove) return 'nothing'
        startWalk(end, 6, null, () => { /* Nothing to do on arrival. */ }, 'a point he clicked', { byPlayer: true })
        engine.log('click_walk', { map: mapId, to: [Math.round(end.x), Math.round(end.y)], reached: r.reached })
        return 'walking'
      }

      /* A drag isn't a tap, so a pointer that moved more than the slop is ignored. */
      const TAP_SLOP = 6
      let tapDown: { x: number; y: number } | null = null
      /* Only the main mouse button counts, so a right-click doesn't send the player walking. */
      app.stage.on('pointerdown', (e) => {
        tapDown = e.button === 0 ? { x: e.global.x, y: e.global.y } : null
      })
      app.stage.on('pointertap', (e) => {
        if (e.button !== 0 || !tapDown) return
        if (Math.hypot(e.global.x - tapDown.x, e.global.y - tapDown.y) > TAP_SLOP) return
        const p = world.toLocal(e.global)
        walkTap(p.x, p.y)
      })

      /* The guide's route, kept between frames. A path search costs time, and the answer only
       * changes when the player or the target moves. */
      let guide: { key: string; route: Pt[]; from: Pt; reached: boolean; at: number } | null = null
      /* The trail is drawn with marks from a pool, never shapes built in code. */
      const trailSprites: Sprite[] = []
      const trailLayer = new Container()
      trailLayer.zIndex = 9e9 - 3
      world.addChild(trailLayer)
      /* The eight drawn arrow directions, squashed onto the painting's ground. */
      const TRAIL_DIRS = ['east', 'south-east', 'south', 'south-west',
        'west', 'north-west', 'north', 'north-east'] as const
      const trailArt = new Map<string, Texture>()
      let trailTex: Texture | null = null
      void kitTexture('pointer', 'trail_dot').then((t) => { if (!destroyed) trailTex = t })
      for (const d of TRAIL_DIRS) {
        void Assets.load(`/art/world/trail/${d}.png`)
          .then((t: Texture) => { if (!destroyed && t) trailArt.set(d, t) })
          .catch(() => { /* The dot is used instead. */ })
      }
      /* How many arrow marks are on the ground this frame. */
      let trailMarks = 0
      /* The light without the arrow. `highlight` turns this on and `guide_to` turns it off. */
      let markQuiet = false
      /* The bottom edge of the objective panel in window pixels, or zero when there's no panel. */
      let panelBand = 0
      let panelBandAt = -99

      /* Which regions and triggers the player's feet were inside on the last frame. */
      const inZones = new Set<string>()
      const firedTriggers = new Set<string>()

      /* What the player has used this sitting. It lasts as long as the page is open and is never
       * saved. */
      const usedThisSitting = new Set<string>()

      /* What one anchor is offering. Both the plaque and a click ask this. */
      const actionFor = (a: Anchor, label: string): string => {
        /* The trophy shelf says what's on it without new art. Drawing each trophy would need art
         * for every one, so the plaque shows the badge count for the whole run instead, matching
         * the panel in `run/wall.ts`. */
        if (a.name === 'trophy_wall') {
          const badges = wallAll(loadSave()).filter((w) => w.earned).length
          return badges === 0 ? label : `${label} · ${badges} ${badges === 1 ? 'badge' : 'badges'}`
        }
        /* A door leads somewhere, so its plaque always says "Go to" and the place. */
        if (a.kind === 'door') return `Go to ${label.replace(/^The\s+/, 'the ')}`
        /* A label the author wrote is used as it is. Without one, a body (or a dock_ post) gets
         * "Talk to" in front of its name, because a plaque next to a person that only says their
         * name makes them look like furniture. */
        if (a.label) return a.label
        return a.placement || /^dock_/.test(a.name) ? `Talk to ${label}` : `Go to ${label}`
      }

      const offerOf = (a: Anchor): { text: string; state: PromptState; canFire: boolean } => {
        /* Use the same lookup that pressing E uses. If the prompt didn't know about an anchor a
         * grape owns, no key or tap could ever reach that handler. */
        const owner = ownerOf(a.name, grapeHandlers)
        const label = labelFor(a.label, a.name)
        let text = ''
        let canFire = false
        /* The state shown on the plaque: plain, barred, done or objective. */
        let state: PromptState = 'plain'
        if (a.kind === 'door') {
          checkDoor(a.to || '')
          const built = doorState.get(a.to || '')
          /* A door with nothing behind it says "not open yet", and says nothing while it's still
           * being checked. */
          if (built === 'ok') { text = actionFor(a, label); canFire = true }
          else if (built === 'missing') { text = `${label} · not open yet`; state = 'barred' }
        } else if (islandPending) {
          /* While the island is still loading, the plaque only names the thing. */
          text = label
        } else if (!owner) {
          /* In debug mode, an anchor that nothing answers to gets named on the plaque instead of
           * being quietly ignored. */
          if (DBG) { text = `${label} · nothing answers to ${a.name}`; state = 'barred' }
        } else {
          text = actionFor(a, label); canFire = true
          /* Already used this sitting. It's still open and can still be pressed, but it says
           * "again" so it doesn't look the same as the one thing in the room the player hasn't
           * touched. */
          if (usedThisSitting.has(a.name)) { text = `${actionFor(a, label)} again`; state = 'done' }
        }
        /* The objective state wins over any other state on the plaque, because showing the
         * objective is the whole point of the plaque. */
        if (canFire) {
          const sv = loadSave()
          if (sv && isObjective(sv, mapId, a.name)) state = 'objective'
        }
        return { text, state, canFire }
      }

      /* Pressing E: an anchor name becomes a running station or a member's own Python handler. */
      const fire = async (a: Anchor) => {
        if (busy || fade) return
        /* If the room's island hasn't loaded yet, nothing can be pressed except doors. */
        if (islandPending && a.kind !== 'door') return
        if (a.kind === 'door') {
          if (a.to) beginExit({ map: a.to, at: a.toAnchor })
          return
        }
        const owner = ownerOf(a.name, grapeHandlers)
        const sv = loadSave()
        if (!owner) {
          /* An anchor nothing answers to gets a warning instead of being skipped silently. */
          console.warn(`[pmap] ${mapId}: nothing answers to the anchor "${a.name}"`)
          engine.log('anchor_unclaimed', { map: mapId, anchor: a.name })
          return
        }
        /* If the island is already running something, the press is ignored and nothing is said. */
        if (grape?.busy()) return
        busy = true
        usedThisSitting.add(a.name)
        stationHold = holdWorld(`station:${a.name}`)
        engine.log('station_used', {
          map: mapId, anchor: a.name, by: 'grape',
          objective: sv ? isObjective(sv, mapId, a.name) : false,
        })
        try {
          const report = await grape!.call(owner.handler)
          /* Log a crash or a refusal. If one part fails quietly, it looks like the island meant it. */
          if (report.error) {
            console.warn(`[pmap] station ${a.name}: ${report.error}`)
            engine.log('island_failed', {
              map: mapId, anchor: a.name, error: report.error,
              refused: report.refused.map((r) => `${r.intent}: ${r.why}`),
            })
            /* Show a crash in a member's handler on screen, not only in the console. Otherwise the
             * press does nothing and the map looks like it has nothing in it. The loading code does
             * the same. */
            void say({ text: `This island is under construction. ${report.error}` })
            /* If the island crashed during its own cutscene, take the cinema bars down. Nothing
             * else is going to. */
            if (cinemaOn() && cinemaBy() === 'island') setCinema(false)
          } else if (report.refused.length) {
            engine.log('intent_refused', {
              map: mapId, anchor: a.name,
              refused: report.refused.map((r) => `${r.intent}: ${r.why}`),
            })
          }
        } finally {
          liftMovieAfterHandler(a.name)
          stationHold?.(); stationHold = null
          busy = false
          /* The E key that opened this is probably still held down. Forget it, or the station fires
           * again as soon as the lock lifts. */
          ePrev = true
          keys['e'] = false
        }
      }

      /* The engine takes down its own cinema bars. A voyage puts them up and carries them through
       * the door, and an island shouldn't have to lower bars it never raised. So this lowers them
       * only while they still belong to the voyage, and only once the whole journey is over, since
       * a crossing can be more than one leg. */
      const settleVoyageFrame = (why: string) => {
        if (!cinemaOn() || cinemaBy() !== 'voyage' || travelPlan()) return
        setCinema(false)
        engine.log('voyage_frame_settled', { map: mapId, why })
      }

      /* When the handler that started movie mode finishes, give the player's controls back. */
      const liftMovieAfterHandler = (who: string) => {
        if (!cinemaOn() || !movieHold) return
        /* The controls come back, but the bars stay up until the island lowers them or the map
         * changes. */
        movieHold(); movieHold = null
        engine.log('movie_hold_released', { map: mapId, handler: who })
      }

      /* Opens this map's island. It comes from a member's entry, the vine's own list, or
       * ?grape=<url>. */
      const openIsland = async () => {
        const asked = params.get('grape')
        const ours = asked ? undefined : vineIslandOfMap(mapId)
        const bound = ours ? undefined : islandOfMap(mapId)
        if (!asked && !ours && !bound) {
          /* A map with no island has nobody to lower the cinema bars, so lower them here. */
          settleVoyageFrame('this map has no island')
          return
        }
        /* Put the bars up as soon as an island is known to be coming, so no empty frames show. */
        if (target.aboard) setCinema(true, 'voyage')
        const ref: GrapeRef = asked
          ? { at: 'url', base: asked }
          : { at: 'origin', island: (ours ?? bound)!.folder }
        /* Set from here until the `finally`. That's the whole time this map's anchors belong to an
         * island that hasn't loaded yet. */
        islandPending = true
        try {
          const pkg = await fetchGrape(ref)
          if (destroyed) return
          const s = openGrape(pkg, intentHost, { unscoped: !!ours })
          grape = s
          stopIsland = () => { s.stop(); grape = null; grapeHandlers = [] }
          const ready = await s.ready
          if (destroyed) { s.stop(); return }
          if (ready.error) {
            /* The island failed to load but the map is fine. Tell the player and let them keep
             * walking around. */
            console.warn(`[pmap] ${mapId}: island did not load: ${ready.error}`)
            engine.log('island_failed', { map: mapId, error: ready.error, when: 'load' })
            /* Show it on screen too. Someone testing an island usually isn't watching the console. */
            note(`This island is under construction. ${ready.error}`)
            grape = null
            setCinema(false)
            return
          }
          grapeHandlers = ready.handlers

          /* If a handler claims an anchor this map doesn't have, warn about it as soon as the
           * island loads. */
          const has = new Set(anchors.all.map((a) => a.name))
          const missing = ready.handlers
            .filter((h) => h.startsWith('talk:'))
            .map((h) => h.slice(5))
            .filter((n) => !has.has(n))
          if (missing.length) {
            console.warn(
              `[pmap] ${mapId}: this island claims ${missing.map((n) => `"${n}"`).join(', ')}, `
              + `which ${missing.length > 1 ? 'are not anchors' : 'is not an anchor'} on this map. `
              + `It has: ${anchors.all.map((a) => a.name).join(', ') || '(none)'}`)
            engine.log('anchor_missing', { map: mapId, claimed: missing })
          }
          if (DBG) console.info(`[pmap] ${mapId}: island claims ${ready.handlers.join(', ')}`)
          /* Don't start an island the ship is only passing through. Only the last leg of a voyage,
           * the landing, runs the island's `@on_start`. */
          const through = travelPlan()
          const passing = !!through && through.leg !== 'landing'
          if (passing) {
            console.log(`[pmap] ${mapId}: a voyage to ${through!.to} is passing through, so this island does not open`)
          }
          /* The engine calls the island's opening handler on its own, and reads its report. */
          if (passing || !ready.handlers.includes('start')) islandStarted = true
          if (!passing && ready.handlers.includes('start')) {
            const report = await s.call('start')
            /* Mark the room as done setting itself up, once, for anything waiting on it. */
            islandStarted = true
            /* End movie mode when the opening is over, whether or not the island remembered to. */
            liftMovieAfterHandler('start')
            if (report.error) {
              console.warn(`[pmap] ${mapId}: the island's opening stopped: ${report.error}`)
              if (report.traceback) console.warn(report.traceback)
              engine.log('island_failed', {
                map: mapId, error: report.error, when: 'start',
                refused: report.refused.map((r) => `${r.intent}: ${r.why}`),
              })
            } else if (report.refused.length) {
              console.warn(`[pmap] ${mapId}: the island's opening was refused: `
                + report.refused.map((r) => `${r.intent}: ${r.why}`).join(' · '))
              engine.log('intent_refused', {
                map: mapId, when: 'start',
                refused: report.refused.map((r) => `${r.intent}: ${r.why}`),
              })
            }
          }
        } catch (e) {
          /* The island failed to load, so stop waiting for it. */
          islandStarted = true
          console.warn(`[pmap] ${mapId}: island did not load: ${e instanceof Error ? e.message : e}`)
          /* Take the black bars down too. An island that didn't load can't turn them off itself. */
          setCinema(false)
        } finally {
          /* Whether the island loaded or crashed, the stations open again. */
          islandPending = false
          /* Take down the voyage's cinema bars too, unless the island has taken them over. */
          settleVoyageFrame('the island has had its say')
        }
      }
      void openIsland()

      // ---- input ----
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)

      // Camera: follow the player, kept inside the painting. A painting smaller than the screen
      // sits centered on that axis instead.
      /* The clamp uses camZ, not Z, because a cutscene can zoom. Clamping at the wrong scale shows
       * the void past the painting's edge. */
      /* The camera clamp depends on what is being driven: a walking body gets clamped, a ship at
       * sea doesn't. */
      /* Sets the root attribute for a composed shot, so the HUD can hide for it the way it does for
       * the cinema bars. Only this function writes it. */
      const setShotUp = (on: boolean) => {
        const el = document.documentElement
        if (on) el.setAttribute('data-shot', '1')
        else el.removeAttribute('data-shot')
      }

      let camFree = false
      /* The usable frame is the window minus whatever the dialogue box takes up, up to half of it. */
      const freeH = (vh: number) => vh - Math.min(uiBand(), vh * 0.5)
      /* The painting's own edges are the fence. One expression handles both big and small maps. */
      /* The fence is the painted area, not the canvas. A painting rarely fills the canvas it was
       * saved on, so clamping to the canvas would let a close shot show the transparent margin with
       * ocean behind it. */
      /* The fence is the painting plus a margin of sea, and a room gets no margin. A berth is
       * placed in the ocean off the dock, so a fence at the painting's edge could never show the
       * boat. On a 410 pixel wide painting in a 1366 wide window, the painting fills exactly the
       * window width, so the camera would have no room to move sideways. */
      const fence = {
        ox: painted.ox - SEA_EDGE,
        oy: painted.oy - SEA_EDGE,
        w: fenceW,
        h: fenceH,
      }
      const fencePainted = (want: number, z: number, view: number) => {
        const top = -fence.oy * z
        const bottom = view - (fence.oy + fence.h) * z
        return bottom >= top ? Math.min(bottom, Math.max(top, want)) : Math.min(top, Math.max(bottom, want))
      }
      /* A room stays still on each axis unless the painting is more than 1.25 times the view on
       * that axis, which is enough to walk around in. */
      const ROOM_DRIFT = 1.25
      let holdStill = !coastCut
      /* The longest a view waits for its zoom to arrive before letting the island carry on. */
      const VIEW_CEILING_MS = 1500
      /* A shot waits longer because it waits for the pan too. Both easings share one time constant,
       * so three of them covers the move plus some margin. */
      const SHOT_CEILING_MS = 4200

      /* A shot's zoom is stored as a multiple of the opening view, but MAPVIS divides the author's
       * zoom notch by an assumed pull of 1.18. At the real pull of 3.31 that's off by 2.8, so a
       * high notch zooms in much too far. The limit is 2.5 times the walking view. */
      const SHOT_ZOOM_MAX = () => walkZ() * 2.5
      /* Where the camera really is, in fractions of a pixel, so the rounding below never eats the
       * easing. The first snap sets it. */
      let camFX = 0, camFY = 0
      /* Where the camera is trying to get to. It's shared so a command can wait for it. Without it,
       * `framing` could only wait for the zoom, which settles in about a second while the pan can
       * still have thousands of screen pixels to go. */
      let camAim = { x: 0, y: 0 }
      /* How long the pan takes. It uses the same number as the zoom so the two arrive together.
       * Don't switch to moving a fixed percent per frame, because that depends on framerate and
       * makes a push-in look like two moves fighting. */
      const CAM_TAU = 0.42
      const camTo = (cx: number, cy: number, snap = false, dt = 1 / 60) => {
        const vw = app.screen.width, vh = app.screen.height
        const fh = freeH(vh)
        if (holdStill && !camFree) {
          if (W * camZ <= vw * ROOM_DRIFT) cx = W / 2
          if (H * camZ <= vh * ROOM_DRIFT) cy = H / 2
        }
        /* Whether the painting fits or not, the fence is the painting's own edge and never the
         * canvas it was saved on. Otherwise a 410 wide painting on a 512 canvas shows open ocean in
         * the corner. */
        const tx = camFree ? vw / 2 - cx * camZ
          : fence.w * camZ <= vw ? (vw - fence.w * camZ) / 2 - fence.ox * camZ
            : Math.min(-fence.ox * camZ,
              Math.max(vw - (fence.ox + fence.w) * camZ, vw / 2 - cx * camZ))
        /* Vertically, the picture is centered in the free part of the window and fenced against the
         * whole window. That way it can run on under the dialogue box covering it without being
         * pulled off its own bottom edge. */
        const ty = camFree ? fh / 2 - cy * camZ
          : fence.h * camZ <= fh ? (fh - fence.h * camZ) / 2 - fence.oy * camZ
            : fencePainted(fh / 2 - cy * camZ, camZ, vh)
        /* Draw at whole pixels on screen, and keep the easing on a separate number that never gets
         * drawn. */
        camAim = { x: tx, y: ty }
        if (snap) { camFX = tx; camFY = ty }
        else {
          const k = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / CAM_TAU)
          camFX += (tx - camFX) * k
          camFY += (ty - camFY) * k
        }
        world.x = Math.round(camFX); world.y = Math.round(camFY)
      }
      camTo(pos.x, pos.y, true)

      /* A smooth zoom path, so the camera can glide between zoom levels instead of cutting. */
      let camZWant = walkZ()
      const zoomTo = (z: number) => { camZWant = Math.max(Z_MIN, z) }
      const stepZoom = (dt: number) => {
        if (Math.abs(camZ - camZWant) < 1e-4) { if (camZ !== camZWant) { camZ = camZWant; world.scale.set(camZ) } return false }
        /* An exponential approach that doesn't depend on framerate, so a Chromebook at 30 fps and a
         * laptop at 60 fps make the same move in the same time. */
        const tau = prefersReducedMotion() ? 0.06 : 0.42
        camZ += (camZWant - camZ) * (1 - Math.exp(-dt / tau))
        if (Math.abs(camZ - camZWant) < 1e-3) camZ = camZWant
        world.scale.set(camZ)
        return true
      }

      /* Boarding and stepping off happen at exact moments, with only one body driven at a time,
       * never two. */
      let berthing: Berthing | null = null
      let docking: WorldSlot | null = null
      /* Where the ship is tied up once it's just scenery, lying along the dock's own line. */
      let moored: { x: number; y: number; heading: number } | null = null
      /* The ship is tied up and the player hasn't stepped off yet, so no sea plaque is offered. */
      let tiedUp = false

      /* The test harness drives the same helm the player uses, for a set number of milliseconds.
       * That way a test sails with the real physics instead of teleporting the boat to a spot. */
      let helmOverride: { until: number; helm: Helm } | null = null
      /* Where the ship is steered while it gets clear of the dock it just left. `ease` caps the
       * helm: a voyage pulls away under its own power, and the last shot of the year leaves gently. */
      let castOff: { x: number; y: number; until: number; ease?: number } | null = null

      /* A berth's heading is one shared value, read the same way when arriving and leaving. */
      /* The direction the dock runs near a point, worked out from the walkable pixels around it. */
      const dockAxis = (bx: number, by: number, near: number): number => {
        const R = 52, STEP = 3
        let n = 0, mx = 0, my = 0
        const pts: [number, number][] = []
        for (let y = by - R; y <= by + R; y += STEP) {
          for (let x = bx - R; x <= bx + R; x += STEP) {
            if (Math.hypot(x - bx, y - by) > R || !canStand(x, y)) continue
            pts.push([x, y]); mx += x; my += y; n++
          }
        }
        if (n < 12) return near
        mx /= n; my /= n
        let xx = 0, xy = 0, yy = 0
        for (const [x, y] of pts) {
          const dx = x - mx, dy = y - my
          xx += dx * dx; xy += dx * dy; yy += dy * dy
        }
        /* The main axis of the covariance, meaning the direction the points spread out the most. It
         * takes one atan2 instead of an eigen solver: 0.5 * atan2(2b, a - c). */
        const ang = 0.5 * Math.atan2(2 * xy, xx - yy)
        /* Then pick the end of that line the ship is already pointing toward. */
        const flip = Math.cos(ang - near) < 0 ? Math.PI : 0
        return ang + flip
      }

      /* A berth heading for all eight directions. Every direction needs an entry, or shores facing
       * that way can't be moored at. This is screen space, with x going right and y going down, so
       * east is 0, south is a quarter turn, north is a quarter turn back and west is half a turn.
       * An unknown word still gives west. */
      const RADS: Record<string, number> = {
        east: 0,
        'south-east': Math.PI / 4,
        south: Math.PI / 2,
        'south-west': (Math.PI * 3) / 4,
        west: Math.PI,
        'north-west': (-Math.PI * 3) / 4,
        north: -Math.PI / 2,
        'north-east': -Math.PI / 4,
      }
      /* An angle beats a word when the author set one, because a coastline doesn't run at a
       * multiple of 45 degrees. Degrees are clockwise from north and screen y points down, so north
       * is -cos and east is +sin. */
      const radOf = (f: string | undefined, deg?: number): number => {
        if (Number.isFinite(Number(deg))) {
          const t = (Number(deg) * Math.PI) / 180
          return Math.atan2(-Math.cos(t), Math.sin(t))
        }
        const r = RADS[String(f || '').toLowerCase()]
        return r === undefined ? Math.PI : r
      }

      /* Show the arrival card every time the player arrives on a map, not only the first time they
       * visit it. */
      /* The exception is the ending. When the year is over, the ending arrives on the hub to show
       * the player leaving, so no landing card belongs there. The save already knows the year is
       * finished. */
      /* A world scene mounting means the run isn't in its final shot, whatever the scene before was
       * doing. `hud/objective-bus.ts` explains why this happens here. */
      setRunEnding(false)

      let cardOwed = !sessionOver(loadSave())
      const arrivalCard = () => {
        if (!cardOwed) return
        /* Skip the card on a map the player is only passing through. A voyage out of the Maw goes
         * through the hub, so only show the card on the map where the journey ends. */
        const going = travelPlan()
        if (going && going.to !== mapId) {
          /* The card is still owed, so the place still gets named when the player really arrives
           * later. */
          engine.log('card_held', { map: mapId, passingTo: going.to })
          return
        }
        cardOwed = false
        /* Check this before markSeen, because markSeen is what makes it true. */
        const beenHere = seenThisSession(mapId)
        markSeen(mapId)
        const place = placeOfMap(mapId)
        showPlaceCard({
          title: titleOfMap(mapId, typeof map.title === 'string' ? map.title : undefined),
          /* On a repeat visit the place is already named, so skip the line about what it's for. */
          line: beenHere ? undefined : slot?.place && place ? place.recognise : undefined,
          brief: beenHere,
        })
      }

      /* A berth is in the water, so the dock is found three ways: the world's arrival anchor, then
       * a post with a dock-like name, then a wide search. If all three fail it returns null.
       * `onFloor` gives back the same point when nothing nearby is standable, and neither berth has
       * floor within 44 painting pixels. */
      const dockSide = (): { x: number; y: number } | null => {
        if (!berth) return null
        const named = berth.at ? anchors.get(berth.at) : undefined
        if (named) return anchors.standAt(named)
        const quay = anchors.all.find((a2) => a2.kind === 'post' && /dock|quay|jetty|pier|harbou?r/i.test(a2.name))
        if (quay) return anchors.standAt(quay)
        const sea = fromSea(berth.x, berth.y)
        /* Search 96 pixels instead of 44. A berth sits in the water off the end of a quay, so the
         * quay can be more than a body's length away in the squashed y scale. */
        const tried = onFloor(sea, canStand, cfg.yScale, 96)
        if (tried.moved) return tried.at
        /* One last look further out, in case the floor is beyond the radius onFloor searched. */
        for (let r = 104; r <= 260; r += 8) {
          for (let i = 0; i < 24; i++) {
            const a2 = (i / 24) * Math.PI * 2
            const x = sea.x + Math.cos(a2) * r
            const y = sea.y + Math.sin(a2) * r * (cfg.yScale || 1)
            if (x < 0 || y < 0 || x >= W || y >= H) continue
            if (canStand(x, y)) return { x, y }
          }
        }
        return null
      }

      /* Put the moored ship at the dock however the player arrived, whether through a door, a
       * reload or anything else. The save's `vessel.berthedAt` says which dock the ship is tied up
       * at. */
      {
        const v = loadSave()?.vessel
        const here = slot?.place ?? slot?.map ?? mapId
        if (berth && v?.berthedAt && v.berthedAt === here) {
          const at = fromSea(berth.x, berth.y)
          const drawn = berth.facing || berth.bearing !== undefined
            ? radOf(berth.facing, berth.bearing) : null
          moored = { x: at.x, y: at.y, heading: drawn ?? dockAxis(at.x, at.y, 0) }
        }
      }

      const board = () => {
        if (!canSail || !berth || hull) return
        const at = fromSea(berth.x, berth.y)
        /* Once the player boards, the ship isn't parked scenery anymore. */
        moored = null
        hull = newHull(at.x, at.y, radOf(berth.facing, berth.bearing))
        if (hullSp) hullSp.visible = true
        thor.sp.visible = false; thor.sh.visible = false; pinWanted = false
        setAfloat(true)
        camFree = true
        /* The ship shot uses Z_SHIP, the walking zoom (3.0 on the hub), not `Z_MIN` at 2.04.
         * Boarding at `Z_MIN` makes two camera moves fight over one moment. `Z_MIN` stays the zoom
         * limit for a player steering the ship. */
        zoomTo(Z_SHIP)
        engine.log('boarded', { map: mapId, place: slot?.place ?? null })
      }

      /* keepShot lets a script decide where the camera goes, so the arrival is one camera move
       * instead of two. */
      const stepAshore = (keepShot = false) => {
        if (!hull) return
        /* Stepping ashore is the one place a hull goes away. If a voyage is still running, it gets
         * ended here as interrupted. */
        if (voyage) {
          const at = sailing ? `waypoint ${sailing.i}` : 'the final approach'
          engine.log('voyage_interrupted', { map: mapId, path: voyage.path.name, at })
          endVoyage(new NotBuilt('route',
            `the crossing on "${voyage.path.name}" ended at ${at}, when the ship was put ashore`))
        }
        /* Save the heading before the hull is gone. It breaks the tie on which way along the dock
         * the ship lies. */
        const cameInOn = hull.heading
        sailing = null
        sailingTo = null
        hull = null
        berthing = null
        castOff = null
        if (hullSp) hullSp.visible = !!berth
        wakeG.clear()
        tiedUp = false
        /* The moored ship faces the way its berth was drawn, because an authored facing always
         * wins. `dockAxis` is only a fallback for berths nobody aimed, since it can disagree with
         * the heading the ship came in on and make it snap around as the player steps off. */
        if (berth) {
          const at = fromSea(berth.x, berth.y)
          const drawn = berth.facing || berth.bearing !== undefined
            ? radOf(berth.facing, berth.bearing)
            : null
          moored = { x: at.x, y: at.y, heading: drawn ?? dockAxis(at.x, at.y, cameInOn) }
        }
        thor.sp.visible = true; thor.sh.visible = true; pinWanted = true
        setAfloat(false)
        camFree = false
        if (!keepShot) zoomTo(walkZ())
        /* Take aboard out of the address too, so a refresh doesn't put the player back at sea. */
        if (target.aboard) setMapUrl({ map: mapId, at: target.at })
        /* Show the arrival card, unless a script is directing the camera. */
        if (!keepShot) arrivalCard()
        engine.log('disembarked', { map: mapId })
      }

      /* Find the way in over water before sailing it. Aiming straight at the berth runs the ship
       * aground, because `stepHull` slides it along any coast in the way. `berthing` waits until
       * the legs are done. */

      /* Approach a berth at a fixed docking speed. Braking late doesn't work: the ship overshoots
       * and circles, or wobbles its way in. */
      const DOCK_APPROACH = DEFAULT_SAIL.cruise * 0.45
      const dockingSpeed = (helm: Helm, left: number, speed: number) => {
        if (left > 180) return
        helm.throttle = speed > DOCK_APPROACH ? 0 : 0.45
      }

      /* Docking slows the ship down and then goes through a door. It never teleports. */
      /* There's one follower for moving a ship. `dockAt` finds the way in over water and hands it
       * to `sailing` as a named line, the same follower a scripted route uses. */
      const dockAt = (s: WorldSlot) => {
        if (!hull || !s.berth || berthing || sailing) return
        const t = fromSea(s.berth.x, s.berth.y)
        const ap = s.berth.approach ? fromSea(s.berth.approach.x, s.berth.approach.y) : undefined
        /* Route to where the docking maneuver starts, not to the berth itself. That's the authored
         * approach point, or else the spot behind the berth that `berthHelm` would line up from.
         * Routing to the berth makes the ship creep along the coast to line up. */
        const water = (x: number, y: number) => depthAt(x, y) >= DEFAULT_SAIL.probe
        const face = s.berth.facing || s.berth.bearing !== undefined
          ? radOf(s.berth.facing, s.berth.bearing) : undefined
        const head = ap
          ?? (face !== undefined ? lineUpPoint(t, face, DEFAULT_SAIL, water) ?? t : t)
        /* This check has to come before routing. A route is always followed to its end before the
         * docking maneuver takes over, so routing out to the mark would commit the ship to that
         * turn even when it's already lined up. */
        /* A berth with no heading has no line to be on, so the check can't run and the ship takes
         * the route. */
        const onHerRun = face !== undefined
          && insideTheApproach({ x: hull.x, y: hull.y }, t, face, head, hull.heading)
        const legs = onHerRun ? null : seaRoute({ x: hull.x, y: hull.y }, head, water, { step: 24 })
        if (onHerRun) {
          console.log(`[sail] ${mapId}: she is already on her run in, so she keeps coming `
            + 'rather than standing back out to the mark')
        }
        if (legs && legs.length) {
          /* The way in, written as a Pathway so the same follower can read it. It carries the
           * berth's heading for `berthHelm` to use at the handover. */
          const line: Pathway = {
            name: `the way in to ${s.berth.name ?? s.map ?? mapId}`,
            kind: 'sail',
            points: legs,
            closed: false,
            twoWay: false,
            facing: s.berth.facing,
            bearing: s.berth.bearing,
            marks: [],
          }
          /* Measure from where the ship is, then add the line's length. `lengthOf` only adds up the
           * gaps between points, so a one-point line measures zero and the time limit would run out
           * halfway. */
          const far = Math.hypot(legs[0].x - hull.x, legs[0].y - hull.y) + lengthOf(line)
          sailing = { path: line, pts: legs, i: 0, left: (far / DEFAULT_SAIL.cruise) * 3 + 8 }
          sailingTo = { berth: s.berth, slot: s }
          console.log(`[sail] ${mapId}: the way in is ${legs.length} leg`
            + `${legs.length > 1 ? 's' : ''} over ${Math.round(far)}px`)
          engine.log('docking', { map: mapId, to: s.map ?? null, place: s.place ?? null, legs: legs.length })
          return
        }
        /* Finding no route is fine here. The ship is already beside its berth, or the water is too
         * tight for the search, so the docking maneuver starts from where it is. */
        docking = s
        berthing = { target: t, facing: face, approach: ap, stage: 'approach' }
        engine.log('docking', { map: mapId, to: s.map ?? null, place: s.place ?? null, legs: 0 })
      }

      const docked = () => {
        const s = docking
        berthing = null
        docking = null
        /* Clear the voyage before stepping ashore, so stepAshore doesn't count it as interrupted.
         * Arriving is success. */
        const v = voyage
        voyage = null
        /* Clear the follower too, or the next crossing gets refused even though nothing is running. */
        sailing = null
        sailingTo = null
        if (!s) {
          /* No slot was named for this stop. `sailRoute` refuses a line that ends nowhere, but
           * `dockAt` can also be reached from the player's own prompt, so step ashore here and
           * finish up. */
          stepAshore()
          v?.done()
          settleVoyageFrame('she tied up nowhere in particular')
          return
        }
        /* Whoever owns the crossing decides when the player steps off. That's either a Python route
         * (`voyage`) or the engine's own voyage in `world/travel.ts`, which sets no `voyage`
         * object, so the landing leg is checked too. Without that the player lands too early and
         * the landing leg's beats get skipped. */
        if (v || travelPlan()?.leg === 'landing') tiedUp = true; else stepAshore()
        /* Tell the chart where the ship is tied up, so the boat marker moves. */
        recordVessel({ berthedAt: s.place ?? s.map ?? mapId, legs: (loadSave()?.vessel?.legs ?? 0) + 1 })
        engine.log('voyage_arrived', { map: mapId, to: s.map ?? mapId, place: s.place ?? null })
        if (!s.map || s.map === mapId) {
          v?.done()
          /* The player is ashore on the map they sailed to, so the journey is over and the black
           * bars come down. The island already ran its `start` while the ship was on the water, so
           * nothing else would lower them. */
          settleVoyageFrame('the crossing is over')
          return
        }
        /* On another map, finish the crossing before the door tears this scene down. */
        v?.done()
        beginExit({ map: s.map, at: s.berth?.at })
      }

      /* A whole journey asked for by a panel goes through `sail_to`. The year sheet's buttons and
       * the chart's pins come through here. It's offered from any map because the first leg is the
       * walk out of the room, and `sail_to` decides what to refuse. */
      /* When a voyage is called off at the dock, React drops the plan in `SkipVoyage`, where the
       * key is handled. This part lowers the black bars and gives the year its objective line back,
       * which a button can't reach. */
      offTravel = onTravel((p) => {
        if (p || !cinemaOn() || cinemaBy() !== 'voyage') return
        setCinema(false)
        /* Only clear the objective when the journey was called off. A plan going null means either
         * an escape at the dock or an arrival, and on arrival the island's `start` has already set
         * its first line, so clearing it would wipe that out. */
        if (voyageCalledOff()) engine.objective(null)
        engine.log('voyage_ended', { map: mapId, calledOff: voyageCalledOff() })
      })

      offVoyage = onVoyageRequest(mapId, (want, answer) => {
        if (fade || busy || runtime.running) {
          answer({ ok: false, why: 'Not while something else is happening.' }); return
        }
        if (travelPlan()) { answer({ ok: false, why: 'You are already on your way.' }); return }
        try {
          void intentWorld.sailTo(want)
          answer({ ok: true })
        } catch (e) {
          answer({ ok: false, why: e instanceof Error ? e.message : 'There is no way to sail there.' })
        }
      })

      /* The head back button walks the player instead of cutting to the dock, because the dock is
       * on the island they're already standing on. It's only registered where there's a dock, so
       * the button can check whether anybody answers before it draws. */
      if (canSail && berth) offHome = onHeadBack((answer) => {
        if (fade || busy || runtime.running || hull || berthing || voyage) {
          answer({ ok: false, why: 'Not while something else is happening.' }); return
        }
        if (travelPlan()) { answer({ ok: false, why: 'You are already on your way.' }); return }
        /* This is the same journey pointed the other way. It hands everything to `sail_to`, the one
         * system every journey goes through, so heading back gets the bars, the ship and the
         * crossing like any other trip. */
        const here = comp
        const wantHome = here?.home?.slot
        const home = here && wantHome
          ? here.slots.find((q) => q.berth && q.map && q.map !== mapId && (q.place ?? q.map) === wantHome)
          : undefined
        if (!home?.map) {
          engine.log('head_back_refused', { map: mapId, why: 'the world names no home island with a dock' })
          answer({ ok: false, why: 'There is nowhere to head back to yet.' })
          return
        }
        engine.log('head_back', { map: mapId, to: home.map })
        /* Answer now, not when the cover is done. The bus answers the request itself as soon as the
         * dispatch returns, so a late answer gets thrown away. Here ok: true only means the scene
         * took the request. */
        guideTarget = null
        try {
          void intentWorld.sailTo(home.map)
          answer({ ok: true })
        } catch (e) {
          const why = e instanceof Error ? e.message : 'There is no way to sail home from here.'
          engine.log('head_back_refused', { map: mapId, why })
          answer({ ok: false, why })
        }
      })

      /* The chart can send the ship. A click picks a destination, and the straight line there is
       * checked first. */
      /* It's only offered where there's water, so a room never shows a Sail button. */
      if (canSail && berth) offSail = onSailRequest(mapId, (want, answer) => {
        if (!comp) {
          answer({ ok: false, why: 'The chart has not come back yet.' }); return
        }
        if (!want.berth) {
          answer({ ok: false, why: `${want.title} has no dock yet.` }); return
        }
        if (want.map && want.map === mapId) {
          answer({ ok: false, why: 'You are already there.' }); return
        }
        if (berthing || voyage) {
          answer({ ok: false, why: 'The boat is already sailing somewhere.' }); return
        }
        /* Only refuse when something is driving the world. An open panel is fine. */
        if (fade || busy || runtime.running) {
          answer({ ok: false, why: 'Not while something else is happening.' }); return
        }

        /* Where the ship leaves from, worked out before boarding so a refusal doesn't leave the
         * player stuck in the boat. */
        const from = hull ? { x: hull.x, y: hull.y } : fromSea(berth.x, berth.y)
        const to = fromSea(want.berth.x, want.berth.y)
        const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8))
        for (let k = 0; k <= n; k++) {
          const x = from.x + (to.x - from.x) * (k / n), y = from.y + (to.y - from.y) * (k / n)
          if (depthAt(x, y) >= DEFAULT_SAIL.probe) continue
          console.warn(`[pmap] ${mapId}: the straight line to ${want.title} runs aground `
            + `near ${Math.round(x)},${Math.round(y)}; a sail path wants drawing in MAPVIS`)
          engine.log('sail_refused', { map: mapId, to: want.map ?? null, why: 'aground' })
          answer({ ok: false, why: `There is land in the way between here and ${want.title}.` })
          return
        }

        if (!hull) board()
        if (!hull) { answer({ ok: false, why: 'You could not get in the boat.' }); return }
        dockAt(want)
        engine.log('sail_clicked', { map: mapId, to: want.map ?? null, place: want.place ?? null })
        answer({ ok: true })
      })

      /* Arriving on the water. The offshore start point is found by sounding out along the berth's
       * seaward line. */
      const OFFSHORE_DEPTH = DEFAULT_SAIL.probe * 3   // Three boat-widths of water under the keel.
      const OFFSHORE_MIN = 140                        // Far enough out to count as open water.
      const OFFSHORE_MAX = 420                        // Any farther and the island is out of sight.
      const arriveAboard = () => {
        if (!canSail || !berth) {
          /* A map with no berth can't be reached by sea, so the player arrives on foot and the
           * console says so. */
          console.warn(`[pmap] ${mapId} was asked for by sea and has no berth on the world; arriving on foot`)
          return
        }
        board()
        if (!hull) return
        const b = fromSea(berth.x, berth.y)
        let dir = berth.approach
          ? Math.atan2(fromSea(berth.approach.x, berth.approach.y).y - b.y, fromSea(berth.approach.x, berth.approach.y).x - b.x)
          : berth.facing || berth.bearing !== undefined ? radOf(berth.facing, berth.bearing) + Math.PI
            : Math.atan2(b.y - pc.y, b.x - pc.x)
        if (!isFinite(dir)) dir = Math.PI / 2
        let out = { x: b.x, y: b.y }
        let best = -1
        let found = false
        /* The far start belongs to one island, not the whole world. A mark that names another
         * island, or sits far from this berth, gets ignored, or the ship would start off a
         * different island's coast. */
        /* The world spells an island three ways: `the_hub` on a mark, `hub` with a place of
         * `home-island` on the slot, and `hub` in the bundle. So names are compared in a plain
         * form, with underscores turned into hyphens and a leading "the-" dropped. `slotOfBerth`
         * does the same thing. */
        const plain = (v: string) => v.replace(/_/g, '-').replace(/^the-/, '')
        const names = new Set([slot?.place, slot?.map, mapId]
          .filter((v): v is string => !!v).map(plain))
        const mine = (m: { island?: string }) => !m.island || names.has(plain(m.island))
        /* A skipped crossing starts close in. The far map opens with the ship on the last stretch,
         * and it still sails in, ties up and lets the player off. Only the run across is skipped. */
        const raw = comp && !voyageSkipped() ? farStart(comp) : undefined
        const fs = raw && mine(raw) ? raw : undefined
        if (raw && !fs) {
          console.log(`[pmap] ${mapId}: ${raw.name} belongs to "${raw.island}", not to this island,`
            + ' so the hull is born off the berth on this island instead')
        }
        if (fs) {
          const at = fromSea(fs.x, fs.y)
          const deep = depthAt(at.x, at.y)
          /* Only use the mark if it's within FAR_START_REACH of this berth. A mark with no island
           * named is trusted only that close, because farther out it's some other island's water. */
          const far = Math.hypot(at.x - b.x, at.y - b.y)
          if (deep >= DEFAULT_SAIL.probe && far <= FAR_START_REACH) {
            out = at; best = deep; found = true
            console.log(`[pmap] ${mapId}: the hull is born at ${fs.name} (${Math.round(at.x)},${Math.round(at.y)}), ${Math.round(deep)}px of water`)
          } else if (far > FAR_START_REACH) {
            console.warn(`[pmap] ${mapId}: ${fs.name} is ${Math.round(far)}px from this island's berth, `
              + `further than ${FAR_START_REACH}, so it is not this island's start line and the hull is born off the berth instead.`)
          } else {
            console.warn(`[pmap] ${mapId}: ${fs.name} at ${Math.round(at.x)},${Math.round(at.y)} has ${Math.round(deep)}px of water, `
              + `inside the hull's ${DEFAULT_SAIL.probe}px probe, so the hull is born off the berth instead. It wants moving on the ocean page.`)
          }
        }
        /* Keep the deepest spot found, not the last one tried. */
        for (let d = 16; !found && d <= OFFSHORE_MAX; d += 16) {
          const p = { x: b.x + Math.cos(dir) * d, y: b.y + Math.sin(dir) * d }
          const deep = depthAt(p.x, p.y)
          if (deep > best) { best = deep; out = p }
          if (d >= OFFSHORE_MIN && deep >= OFFSHORE_DEPTH) { out = p; found = true; break }
        }
        if (!found) {
          console.warn(`[pmap] ${mapId}: no water ${OFFSHORE_DEPTH}px deep within ${OFFSHORE_MAX}px`
            + ` of the berth on its seaward line; putting her in the best of it (${Math.round(best)}px).`
            + ' The berth or its approach wants moving in MAPVIS.')
        }
        hull.x = out.x; hull.y = out.y
        /* Point the bow at the island, because that's what arriving looks like. The heading is the
         * line toward the berth. */
        hull.heading = Math.atan2(b.y - out.y, b.x - out.x)
        /* The ship starts at cruising speed, so it's already moving when the cover lifts. */
        hull.speed = DEFAULT_SAIL.cruise
        if (hullSp) { hullSp.position.set(hull.x, hull.y); hullSp.zIndex = OVER_PLACED + hull.y }
        /* Set the camera before the cover lifts, so the arrival snaps into place instead of easing. */
        /* A scripted crossing opens zoomed in close. A player boarding gets the wider sailing zoom. */
        camZ = camZWant = Z_SHIP
        world.scale.set(camZ)
        camTo(hull.x, hull.y, true)
        console.log(`[pmap] ${mapId}: arrived by sea at ${Math.round(out.x)},${Math.round(out.y)}`
          + ` · ${Math.round(Math.hypot(out.x - b.x, out.y - b.y))}px off the berth`
          + ` · ${Math.round(depthAt(out.x, out.y))}px of water`)
      }
      if (target.aboard) arriveAboard()

      /* Leaving works like arriving in reverse. A berth is the shallowest water an island has (24px
       * on the hub, under the 26px probe), so a hull made there is aground before it moves. So the
       * way out looks for deeper water out from the berth. */
      /* Leaving works like arriving in reverse. A berth is the shallowest water an island has (24px
       * on the hub, under the 26px probe), so a hull made there is aground before it moves. That's
       * why the way out looks for deeper water out from the berth. */
      const soundOffshore = (): { x: number; y: number; deep: number } | null => {
        if (!berth) return null
        const b = fromSea(berth.x, berth.y)
        /* A drawn approach wins if it has enough water, because it says where the safe water is. */
        if (berth.approach) {
          const ap = fromSea(berth.approach.x, berth.approach.y)
          const deep = depthAt(ap.x, ap.y)
          if (deep >= DEFAULT_SAIL.probe) return { ...ap, deep }
        }
        const lying = berth.facing || berth.bearing !== undefined
          ? radOf(berth.facing, berth.bearing)
          : Math.atan2(b.y - pc.y, b.x - pc.x)
        const from = hull ? hull.heading : lying
        let pick: { x: number; y: number; deep: number; score: number } | null = null
        for (let i = 0; i < 16; i++) {
          const dir = from + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (Math.PI / 8)
          /* How far the ship can run on this bearing before the water gets too shallow. */
          let reach = 0
          let deep = 0
          for (let d = 16; d <= OFFSHORE_MAX; d += 16) {
            const p = { x: b.x + Math.cos(dir) * d, y: b.y + Math.sin(dir) * d }
            const here = depthAt(p.x, p.y)
            if (here < DEFAULT_SAIL.probe) break
            reach = d
            deep = here
          }
          if (reach < OFFSHORE_MIN) continue
          let turn = dir - from
          while (turn > Math.PI) turn -= 2 * Math.PI
          while (turn < -Math.PI) turn += 2 * Math.PI
          /* Deep water adds to the score and turning takes away from it, in the same units. A
           * quarter turn costs about as much as forty pixels of depth. */
          const score = Math.min(deep, OFFSHORE_DEPTH * 1.5) - Math.abs(turn) * 52
          if (!pick || score > pick.score) {
            pick = { x: b.x + Math.cos(dir) * reach, y: b.y + Math.sin(dir) * reach, deep, score }
          }
        }
        if (!pick) return null
        return { x: pick.x, y: pick.y, deep: pick.deep }
      }

      /* The way out of a room: the door onto a map that has water. */
      const doorToWater = (): Anchor | null => {
        if (!comp) return null
        for (const a of anchors.all) {
          if (a.kind !== 'door' || !a.to) continue
          if (slotOfMap(comp, a.to)?.berth) return a
        }
        return null
      }

      /* How long the player watches the ship leave before the cover takes over the rest of the
       * crossing. It's long enough to look like sailing and short enough that nobody sits through
       * open water. */
      /* The last shot of year one has four beats. The camera goes to the boat, the player is put on
       * the dock behind it, there's a pause, then the player gets in and the ship sails slowly
       * away. */
/** How long the camera takes to travel from wherever the player is standing to the boat. */
const CAM_TO_DOCK_MS = 1100
/** The player stands at the dock looking at the ship before moving. */
const DOCK_BEAT_MS = 900
/** Aboard and settled, before casting off. */
const BOARD_BEAT_MS = 700
/** The departure itself. The title fades in over this shot. */
/* Long enough to look like a departure at the speed the ship really goes. */
const SAIL_OUT_MS = 5200
/* There's no special throttle for this shot. `steerTo` eases the ship up to speed through the turn
 * and then holds it, the same as every other departure. */

/* How long the player stands on the quay, with the camera already on the ship, before stepping in.
 * It matches the opening's boarding pause. */
const BOARD_HOLD_MS = 850

const CAST_OFF_SHOW_MS = 3200

      /* Runs one leg of a voyage on whichever scene is alive. `sail_to` calls it on the map where
       * it was said, and every map the voyage lands on calls it again, so the journey doesn't
       * depend on the island that started it. */
      const runVoyageLeg = async (): Promise<void> => {
        const v = travelPlan()
        if (!v) return
        /* Wait for the cover to come off first. `waitForScene` resolves when the map is drawn,
         * before the transition finishes lifting, so otherwise the ship would already be at sea
         * under the loading card. */
        const t0 = performance.now()
        while (transitionBusy() && !destroyed && performance.now() - t0 < LEG_CEILING_MS) {
          await new Promise<void>((r) => setTimeout(r, 100))
        }
        if (destroyed) return
        /* A skip lands the player at the dock instead of canceling the voyage, so they don't stay
         * stuck where they were. The far map opens on foot at the berth's anchor and the card
         * plays. This is checked at the start of every leg and again after the walk. */
        const skipToShore = (): boolean => {
          if (!voyageSkipped()) return false
          /* Once the far map is open there's nothing left to skip. The skipped flag stays set. */
          if (v.leg === 'landing') return false
          /* A skip never re-enters the map it's already on, whatever the leg. */
          if (v.to === mapId) { endTravel('already there'); return false }
          const to = comp ? slotOfMap(comp, v.to) : undefined
          /* The player's ship comes along, the same way docked() records where the boat ended up. */
          recordVessel({
            berthedAt: to?.place ?? to?.map ?? v.to,
            legs: (loadSave()?.vessel?.legs ?? 0) + 1,
          })
          /* A skip still counts as arriving, not canceling. Ending the plan would kill the landing
           * leg, which is the only thing that sets up an arrival, and without `aboard` no hull gets
           * made. So these two lines match the end of a crossing that wasn't skipped. */
          console.log(`[travel] skipped, arriving at ${v.to} the short way`)
          setTravelLeg('landing')
          /* A skip keeps the titled loading screen. A watched crossing uses a quiet fade, but a
           * skipped one can say where it's taking the player. */
          beginExit({ map: v.to, aboard: true })
          return true
        }
        if (skipToShore()) return
        try {
          if (v.leg === 'to-dock') {
            /* This leg ends at the dock, not at a door. Its job is what its name says: get the
             * player to the dock of the island they're on, so the player still presses to board. A
             * room with no water takes the door and stays on this leg. */
            if (canSail && berth) {
              const at = dockSide()
              if (!at) {
                /* If the journey can't start, say so on screen and not only in the console. */
                endTravel(`there is nowhere to stand at ${mapId}'s berth`)
                setCinema(false)
                engine.objective(null)
                void say({ text: 'There is no way down to the water from here.' })
                return
              }
              setTravelLeg('boarding')
              const ship = fromSea(berth.x, berth.y)
              /* Use a short quiet fade. A hard cut across ground the player can see looks like a
               * bug, and the titled card would look like a second journey. That card is only for a
               * skip. */
              void cover(passingCover().spec, () => {
                pos.x = at.x
                pos.y = at.y
                /* Face the player toward the ship. Standing on a quay with their back to the water
                 * looks wrong. */
                walker.facing = dirFrom(ship.x - at.x, (ship.y - at.y) * cfg.yScale)
                recordPosition({ map: mapId })
                camTo(pos.x, pos.y, true)
                zoomTo(walkZ())
              })
              return
            }
            const door = doorToWater()
            if (!door) {
              endTravel('there is no way down to the water from here')
              setCinema(false)
              engine.objective(null)
              void say({ text: 'There is no way down to the water from here.' })
              return
            }
            if (skipToShore()) return
            /* The way out might be the destination itself. The hub is one door from the Maw, so
             * picking it on the chart from inside the mountain means arriving as soon as the player
             * walks through the tunnel, with no water to cross. */
            if (door.to === v.to) {
              endTravel('the door was the destination')
              setCinema(false)
              beginExit({ map: door.to!, at: door.toAnchor })
              return
            }
            /* Only passing through, so no arrival card, because two loading screens for one press
             * look like two journeys. The leg doesn't advance either: the map beyond this door has
             * the quay and runs `to-dock` again. */
            beginExit({ map: door.to!, at: door.toAnchor }, 'passing')
            return
          }

          if (v.leg === 'boarding') {
            /* Nothing happens on this leg, and that's on purpose. The prompt is drawn by the
             * ticker, the press is handled in `seaFire` and backing out is `SkipVoyage`, so this
             * leg only sits and waits. */
            if (!canSail || !berth) { endTravel(`${mapId} has no berth`); setCinema(false); return }
            if (!hull) engine.objective(`Press E to board. Sailing to ${titleOfMap(v.to)}.`)
            return
          }

          if (v.leg === 'crossing') {
            if (!canSail || !berth) { endTravel(`${mapId} has no berth`); setCinema(false); return }
            /* Show the player getting in. Hiding the player and making a boat appear in the same
             * frame looks like a swap, so the camera goes to the ship first while the player is
             * still on the quay, then they step in. These are the same three beats `end_run` uses. */
            if (!hull) {
              void intentWorld.view('ship')
              try { playSfx('board') } catch { /* The beat still works without its sound. */ }
              await new Promise<void>((r) => setTimeout(r, BOARD_HOLD_MS))
              if (destroyed) return
              board()
            }
            if (!hull) { endTravel('he could not get in the boat'); setCinema(false); return }
            if (skipToShore()) return
            /* Move off the berth into water the ship can really sail, found the same way the
             * arrival does it. A berth is the shallowest water there is. */
            const out = soundOffshore()
            if (out) {
              /* The ship pulls away from rest instead of snapping around. Turning the bow to the
               * new heading in one frame looks like flicking, and starting at cruise speed means
               * the first frame anyone sees is already flat out. */
              hull.speed = 0
              sailing = null
              castOff = { x: out.x, y: out.y, until: performance.now() + CAST_OFF_SHOW_MS }
              helmOverride = null
            }
            engine.log('cast_off', { from: mapId, to: v.to })
            await new Promise<void>((r) => setTimeout(r, CAST_OFF_SHOW_MS))
            if (skipToShore()) return
            setTravelLeg('landing')
            /* The rest of the crossing happens under the cover. `aboard` makes the far map open on
             * the water with the ship already moving. The cover is the quiet one, because the
             * island's card is for arriving and the player is still mid crossing. */
            beginExit({ map: v.to, aboard: true }, 'passing')
            return
          }

          if (v.leg === 'landing') {
            /* The far shore. `arriveAboard` already put the ship offshore and moving, so all that's
             * left is the run in, the tie up and the card. If `sailing` or `berthing` is already
             * running, the island is directing its own arrival. */
            if (!canSail || !berth) { endTravel(`${v.to} has no berth`); setCinema(false); return }
            if (!hull) { endTravel('there is no ship on the water here'); setCinema(false); return }
            if (sailing || berthing) { endTravel('the island is sailing herself in'); return }
            void intentWorld.view('ship')
            dockAt(slot!)
            /* The ticker does the tie-up, so wait for it here instead of racing it. */
            const t0 = performance.now()
            while (hull && performance.now() - t0 < LEG_CEILING_MS) {
              await new Promise<void>((r) => setTimeout(r, 120))
              if (!berthing && !hull) break
              if (tiedUp) break
            }
            await new Promise<void>((r) => setTimeout(r, 700))
            stepAshore(true)
            /* The wide shot only lasts ARRIVAL_LOOK_MS. Calling `view` with no length pins the
             * camera on the painting's middle forever, and nothing later gives the camera back, so
             * the player could walk off the screen. */
            void intentWorld.view('island', ARRIVAL_LOOK_MS)
            /* Don't clear the objective here. The destination's `start` runs while the ship is
             * still on the water, so clearing it would wipe what the island just said.
             * `ObjectivePanel` draws the voyage line from the live travel plan anyway. */
            /* Coming home ends at the tunnel, not on the dock. The player walks up the quay
             * following the marks on the ground and goes in, which is the familiar arrival played
             * backwards. */
            const back = v.home ? anchors.all.find((a) => a.kind === 'door' && a.to === MAW_MAP) : null
            if (back) {
              await new Promise<void>((r) => setTimeout(r, 900))
              void intentWorld.view('close')
              guideTarget = back
              await new Promise<void>((r) => {
                const { goal, reach } = walkGoal(back)
                startWalk(goal, reach, goal.facing ?? null, r, back.name)
              })
              guideTarget = null
              endTravel()
              beginExit({ map: back.to!, at: back.toAnchor })
              return
            }
            endTravel()
            return
          }
        } catch (e) {
          console.warn(`[travel] the leg failed: ${e instanceof Error ? e.message : e}`)
          endTravel('the leg failed')
          setCinema(false)
        }
      }

      /* A voyage in progress picks itself back up here, because the journey outlives the island
       * that started it. Every map that loads checks whether someone is traveling through it. It
       * waits for the island to start first, so an island directing its own arrival gets to go
       * before the engine's default. */
      void (async () => {
        if (!travelPlan()) return
        const t0 = performance.now()
        while (!islandStarted && !destroyed && performance.now() - t0 < 12000) {
          await new Promise<void>((r) => setTimeout(r, 120))
        }
        if (destroyed || !travelPlan()) return
        setCinema(true, 'voyage')
        await runVoyageLeg()
        /* Run this once more for when the leg ended the journey without docking: a refusal, a skip,
         * or a last leg that was only a walk. */
        if (!destroyed) settleVoyageFrame('the last leg finished')
      })()

      // Fill the sea after the camera snaps, so the pool sees the real viewport. If the viewport
      // grows later, it needs more pooled ocean under it.
      if (sea) { sea.position.copyFrom(world.position); refreshSea() }
      let seaFX = world.x, seaFY = world.y
      let swellSkip = false
      /* The world's own timers, for which places have been seen and which water the ship is on.
       * Both run on a throttle. */
      let lastSeaCheck = 0
      let lastRegion = ''
      /* The player's position, saved about once a second while they move, and never while a hull is
       * out. */
      let lastWhere = 0
      const seenPlaces = new Set<string>((loadSave()?.exposure ?? []).map((e) => e.place))
      /* Golden hour light over the painting, on islands only. It's a stage layer, so it doesn't
       * zoom. */
      let atmos: ReturnType<typeof goldenHour> | null = null
      if (coastCut) {
        atmos = goldenHour()
        app.stage.addChild(atmos.layer)
        atmos.resize(app.screen.width, app.screen.height)
      }
      app.renderer.on('resize', () => {
        refreshSea()
        atmos?.resize(app.screen.width, app.screen.height)
      })

      // Debug hooks for the proof harness, with the same names PaintedScene uses.
      ;(window as any).__app = app
      ;(window as any).__probe = (x: number, y: number) => JSON.stringify({ stand: canStand(x, y), lvl: lvlAt(x, y) })
      ;(window as any).__warp = (x: number, y: number) => {
        if (!canStand(x, y)) return 'unwalkable'
        pos.x = x; pos.y = y
        return 'ok ' + x + ',' + y
      }
      ;(window as any).__step = (x: number, y: number, tx2: number, ty2: number) =>
        JSON.stringify({ from: lvlAt(x, y), to: lvlAt(tx2, ty2), legal: canStandFrom(tx2, ty2, lvlAt(x, y)) })
      /* Console handles for the stage. Each one drives the same code a station or a grape uses, so
       * a proof run tests the real game code and not a separate copy. */
      ;(window as any).__anchors = () => JSON.stringify(anchors.all.map((a) => ({ name: a.name, kind: a.kind, x: a.x, y: a.y, r: a.r })))
      /* The same path search the walk uses, starting from where the player stands. A probe can ask
       * if a route exists on the served mask instead of guessing from a body that stopped. */
      ;(window as any).__findPath = (x: number, y: number, step = 4) => {
        const r = findPath(doc, cfg, { x: pos.x, y: pos.y }, { x, y }, { step })
        return JSON.stringify({ reached: r.reached, nodes: r.nodes, points: r.points.map((p) => [Math.round(p.x), Math.round(p.y)]) })
      }
      /* Where a placed body is right now, by placement id or name, read off the sprite. */
      ;(window as any).__placed = (id: string) => {
        const sp = placedById.get(id)
        return sp ? JSON.stringify({ x: Math.round(sp.position.x), y: Math.round(sp.position.y), visible: sp.visible }) : null
      }
      ;(window as any).__intent = (i: unknown) => performIntent(i as Intent, intentHost)
      /* Fire and forget. The returned promise only settles when the whole station body has
       * finished, and a body waiting on a click can't settle from inside the call that started it,
       * so a harness polls the state instead. */
      /* Clicks at a point in painting pixels, so a proof doesn't have to fake a pointer event. */
      ;(window as any).__click = (x: number, y: number) => walkTap(x, y)
      ;(window as any).__station = (name: string) => {
        const a = anchors.get(name)
        if (!a) return `no anchor named ${name}`
        if (busy) return 'busy'
        if (islandPending && a.kind !== 'door') return 'busy'
        if (fade) return 'a door is closing'
        /* Fire a door before checking who owns it, since nothing claims doors. */
        if (a.kind === 'door') { void fire(a); return 'fired' }
        const owner = ownerOf(a.name, grapeHandlers)
        if (!owner) return `nothing answers to ${a.name}`
        /* Give the same answer the scene gives itself. Otherwise a probe would say fired for a
         * press the room ignored and report a working station as broken. */
        if (grape?.busy()) return 'busy'
        void fire(a)
        return 'fired'
      }
      ;(window as any).__guide = () => JSON.stringify({
        target: guideTarget?.name ?? null,
        route: guide?.route.length ?? 0,
        reached: guide?.reached ?? null,
        lead: null,
      })
      ;(window as any).__zones = () => JSON.stringify({ inside: [...inZones], fired: [...firedTriggers] })
      ;(window as any).__cs = () => JSON.stringify({
        running: runtime.running,
        letterbox: runtime.ui.letterbox,
        vignette: runtime.ui.vignette,
        line: runtime.ui.dialogue ? runtime.ui.dialogue.text.slice(0, runtime.ui.dialogue.shown) : null,
        cam: csCam,
      })
      ;(window as any).__advance = () => { runtime.advance(); return 'ok' }
      /* Console handles for the world, set up the same way. They point at the real game code and
       * never a copy of it, so a proof run tests what the player actually plays. */
      ;(window as any).__sea = () => JSON.stringify({
        map: mapId,
        placed: !!slot,
        canSail,
        aboard: !!hull,
        at: hull ? toSea(hull.x, hull.y) : toSea(pos.x, pos.y),
        speed: hull ? Math.round(hull.speed) : 0,
        headingRad: hull ? +hull.heading.toFixed(4) : 0,
        aground: hull?.aground ?? false,
        wake: hull?.wake.length ?? 0,
        region: comp ? regionAt(comp, toSea(hull ? hull.x : pos.x, hull ? hull.y : pos.y))?.name ?? null : null,
        zoom: +(camZ / Z).toFixed(3),
        want: +(camZWant / Z).toFixed(3),
        free: camFree,
        /* How much of the window the conversation took, and where the body ended up on screen. */
        band: Math.round(uiBand()),
        you: {
          x: Math.round(world.x + pos.x * camZ),
          y: Math.round(world.y + pos.y * camZ),
          h: Math.round(charH * camZ),
        },
        berthing: berthing?.stage ?? null,
        resident: residentNow(hull ? hull.x : pos.x, hull ? hull.y : pos.y),
        seen: [...seenPlaces],
        states: comp ? seaSlots(comp).map((s) => `${s.title}=${stateOf(s, loadSave())}`) : [],
      })
      /* How deep the water is at a painting pixel, read from the union field. */
      ;(window as any).__depth = (x: number, y: number) => Math.round(depthAt(x, y))
      ;(window as any).__board = () => { board(); return hull ? 'aboard' : 'no berth here' }
      ;(window as any).__helm = (throttle: number, turn: number, ms: number) => {
        if (!hull) return 'not aboard'
        const until = performance.now() + ms
        helmOverride = { until, helm: { throttle, turn, fullSail: false } }
        return 'ok'
      }
      /* Dock at the nearest berth from anywhere, since the maneuver has no range limit. */
      ;(window as any).__dock = () => {
        if (!hull || !comp) return 'not aboard'
        const at = toSea(hull.x, hull.y)
        const berths = comp.slots.filter((s) => s.berth)
        if (!berths.length) return 'nothing on this composition has a berth'
        const home = berths.sort((a, b) =>
          Math.hypot(a.berth!.x - at.x, a.berth!.y - at.y) - Math.hypot(b.berth!.x - at.x, b.berth!.y - at.y))[0]
        dockAt(home)
        return 'docking'
      }
      /* A refusal comes back as a string instead of a throw, so a harness can't misread it. */
      ;(window as any).__fx = (name: string) => {
        try { return playFx(name, { x: pos.x, y: pos.y }).then(() => 'played') }
        catch (e) { return Promise.resolve(e instanceof Error ? e.message : String(e)) }
      }
      /* One debug handle that reads the scene's own state instead of a copy of it. */
      /* The last place the you marker really was, so `pinAt` can still answer during a teardown
       * instead of throwing. */
      let lastPinAt = { x: 0, y: 0 }
      ;(window as any).__pmap = {
        get map() { return mapId },
        get x() { return pos.x },
        get y() { return pos.y },
        get facing() { return walker.facing },
        get pose() { return posed?.name ?? null },
        get camZ() { return camZ },
        get Z() { return Z },
        get framing() { return lookAtTarget ? lastShot : null },
        get lastBerth() { return lastBerth },
        /* Where the marker is on screen, in window pixels, so a harness can crop to it. */
        /* A torn-down scene answers with the last position it had instead of throwing. */
        get pinAt() {
          if (!pin.parent) return lastPinAt
          const g = pin.getGlobalPosition()
          lastPinAt = { x: Math.round(g.x), y: Math.round(g.y) }
          return lastPinAt
        },
        /* The box the marker should sit over, measured on the drawn body and not the whole sprite
         * frame. */
        get thorBox() {
          const ink = pinInk[walker.facing] ?? { l: 0, r: 0 }
          const g = world.toGlobal({ x: pos.x, y: pos.y })
          const l = g.x + ink.l * camZ
          const r = g.x + ink.r * camZ
          return { left: Math.round(l), right: Math.round(r), mid: Math.round((l + r) / 2) }
        },
        /* What the arrow is really leading to, including when the year is doing the pointing. */
        get guide() { return guideTarget?.name ?? leading ?? null },
        get guideAsked() { return guideTarget?.name ?? null },
        get walkLabel() { return autoWalk?.label ?? null },
        /* What the in-world plaque says. It's the only way to check whether the boat is being
         * offered. */
        get prompt() { return prompt.visible ? promptSaid : null },
        /* Where the player's ship lies, in painting pixels, so a proof can check which way the
         * player should face when standing next to it. */
        get berthAt() { return berth ? fromSea(berth.x, berth.y) : null },
        /* Whether a pixel is ground a body can stand on, using the same rule the walk uses. That
         * way walking through the trophies can be measured. */
        standsAt(x: number, y: number) { return canStand(x, y) },
        /* The zooms the camera rules pick, so Wide and Close can be checked as numbers instead of
         * by eye through whatever shot an island is holding. */
        get zooms() {
          return {
            island: +Z_ISLAND.toFixed(2), wide: +Z.toFixed(2),
            close: +Math.max(Z, zForBody(BODY_ON_GLASS_CLOSE)).toFixed(2),
            floor: +Z_MIN.toFixed(2), coast: coastCut,
          }
        },
        /* Where the engine thinks a body stands to use this island's berth. Every departure and the
         * head back button depend on it. */
        get quay() { return dockSide() },
        /* Which placements the walk thinks it has to go around, so a thing the player walks
         * straight through can be named instead of guessed at. */
        get solids() {
          return {
            standing: standing.map((q) => ({ n: q.name ?? '?', x: Math.round(q.x), y: Math.round(q.y), r: Math.round(q.r) })),
            obstacles: obstacles.map((q) => q.name ?? '?'),
          }
        },
        /* Every placement an island has taken control of, where it put it and which way it turned
         * it. It includes the heading kept after the island let go, since facing can't be read from
         * outside any other way. */
        get actors() {
          const out: Record<string, unknown> = {}
          /* Keyed by anchor, including bodies nobody is holding. `driven` is emptied on release, so
           * it says nothing about a body a cutscene just let go of, and that's the state the player
           * walks in on. */
          for (const a of anchors.all) {
            if (!a.placement) continue
            const sp = placedById.get(a.placement)
            if (!sp) continue
            const d = driven.get(sp)
            const spot = anchors.spotOf(a)
            out[a.name] = {
              x: Math.round(sp.position.x), y: Math.round(sp.position.y),
              /* The point a body turns toward when a script names this anchor. It's the stand
               * point, not the middle of the picture. */
              spot: { x: Math.round(spot.x), y: Math.round(spot.y) },
              visible: sp.visible,
              facing: d?.facing ?? lastFacing.get(sp) ?? null,
              held: !!d,
            }
          }
          return out
        },
        /* Whether the player's ship is on this map at all, and whether it's drawn. */
        get ship() {
          return {
            moored: moored ? { x: Math.round(moored.x), y: Math.round(moored.y) } : null,
            hull: !!hull,
            sprite: hullSp ? { visible: hullSp.visible, views: hullViews.length } : null,
            berthedAt: loadSave()?.vessel?.berthedAt ?? null,
            here: slot?.place ?? slot?.map ?? mapId,
          }
        },
        /* The line the ship is following and how far it still is from the mark it's aiming at, so a
         * boat going in circles can be watched instead of guessed about. */
        get line() {
          if (!sailing) return null
          const aim = sailing.pts[sailing.i]
          return {
            path: sailing.path.name, i: sailing.i, of: sailing.pts.length,
            d: hull ? Math.round(Math.hypot(aim.x - hull.x, aim.y - hull.y)) : null,
            aim: { x: Math.round(aim.x), y: Math.round(aim.y) },
            left: Math.round(sailing.left),
          }
        },
        /* Which leg of the journey the player is on, which is the whole sailing state machine.
         * Without the leg, a proof can only watch the end of a voyage and guess at the rest. */
        get travel() {
          const v = travelPlan()
          return v ? { to: v.to, from: v.from, leg: v.leg, home: v.home, bars: cinemaOn() } : null
        },
        /* Where the plaque is, in window pixels, for the same reason `pinAt` exists. A capture
         * harness can't crop to a canvas object it can't find, and the plaque moves with the
         * player, the anchor and the camera. */
        get promptAt() {
          if (!prompt.visible) return null
          const b = prompt.getBounds()
          return {
            x: Math.round(b.minX + b.width / 2), y: Math.round(b.minY + b.height / 2),
            w: Math.round(b.width), h: Math.round(b.height),
          }
        },
        /* What the year wants next, as the sequencer answers it, with the phase. */
        get objective() {
          const o = nextObjective(loadSave())
          return o ? { role: o.role, anchor: anchors.byRole(o.role)?.name ?? null, map: o.map, phase: o.phase } : null
        },
        /* The big pointer over the thing, in window pixels. */
        get pointer() {
          if (!bigMark.visible) return null
          const b = bigMark.getBounds()
          /* Also how far the pointer is from the thing it names, in body lengths on the ground. A
           * mark two bodies above a table points at whatever is drawn behind it, so a check should
           * test how close it is, not how big it is. */
          const over = litAnchor ? anchors.spotOf(litAnchor) : null
          const bodies = over
            ? Math.hypot(bigMark.x - over.x, (bigMark.y - over.y) * (map.yScale || 1))
              / Math.max(1, map.character.heightPx)
            : null
          return {
            x: Math.round(b.x + b.width / 2), y: Math.round(b.y),
            w: Math.round(b.width), h: Math.round(b.height),
            bodies: bodies === null ? null : +bodies.toFixed(2),
          }
        },
        /** How many arrow marks are drawn along the route right now. */
        get trail() { return trailMarks },
        /* Where a named place really is on screen, in window pixels, so a shot can be checked
         * against the thing it names instead of a zoom number. The painting's opaque rectangle
         * comes with it, because a camera can be in the right place and still be pointing at
         * transparent canvas. */
        spotOnGlass(name: string) {
          const a2 = anchors.get(name)
          if (!a2) return null
          const at = anchors.spotOf(a2)
          return {
            x: Math.round(world.x + at.x * camZ), y: Math.round(world.y + at.y * camZ),
            world: { x: Math.round(at.x), y: Math.round(at.y) },
            camZ: +camZ.toFixed(2),
            canvas: { w: W, h: H },
            painted: { x: painted.ox, y: painted.oy, w: painted.w, h: painted.h },
            screen: { w: app.screen.width, h: app.screen.height },
          }
        },
        /** Whether the movie frame is up, read from the same switch that sets it. */
        get movie() { return cinemaOn() },
        /* The glow on the thing the player should walk to, in window pixels. */
        get lit() {
          /* A torn-down scene answers null instead of throwing. */
          if (!lit.visible || destroyed || !lit.parent) return null
          const g = lit.getGlobalPosition()
          const bb = lit.getBounds()
          return {
            at: { x: Math.round(g.x), y: Math.round(g.y) },
            w: Math.round(bb.width), h: Math.round(bb.height),
            alpha: +lit.alpha.toFixed(2),
          }
        },
        get hull() { return hull ? { x: hull.x, y: hull.y, speed: hull.speed, heading: hull.heading, aground: hull.aground } : null },
        /* The drawn ship's box on screen, so a proof can tell whether a plaque is covering the ship
         * instead of guessing from a texture name. */
        get hullBox() {
          if (!hullSp || !hullSp.visible || !hull) return null
          const b = hullSp.getBounds()
          return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
        },
        /* The whole berthing state, not just its stage. A berthing that will never finish looks the
         * same from outside as one halfway through. What tells them apart is how far the ship is
         * off the mark and off the authored heading. */
        get berthing() {
          if (!berthing) return null
          const t = berthing.target
          return {
            stage: berthing.stage,
            target: { x: Math.round(t.x), y: Math.round(t.y) },
            gap: hull ? +Math.hypot(t.x - hull.x, t.y - hull.y).toFixed(1) : null,
            facing: berthing.facing === undefined ? null : +berthing.facing.toFixed(3),
            offBy: hull && berthing.facing !== undefined
              ? +Math.abs(((berthing.facing - hull.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI).toFixed(3)
              : null,
            best: berthing.best === undefined ? null : +berthing.best.toFixed(1),
            stuckMs: Math.round(berthing.stuckMs ?? 0),
            approach: berthing.approach
              ? { x: Math.round(berthing.approach.x), y: Math.round(berthing.approach.y) }
              : null,
          }
        },
        get sailing() { return sailing ? { path: sailing.path.name, leg: sailing.i } : null },
        /* The whole crossing. The waypoint follower is only the first half of it. */
        get voyage() { return voyage ? { path: voyage.path.name, to: sailingTo?.berth.name ?? null } : null },
        get waiting() { return waiters.map((w2) => w2.a.name) },
        get driven() { return [...driven.keys()].length },
        /* What each driven body is doing, by the name its placement carries. */
        get drivenNow() {
          const out: Record<string, {
            x: number; y: number; frame: number; moving: boolean; facing: string | null
            tex: string
          }> = {}
          for (const [sp, d] of driven) {
            let name = '?'
            for (const [id, s2] of placedById) if (s2 === sp) { name = id; break }
            out[name] = {
              /* Not rounded, so a harness measuring smoothness isn't measuring its own rounding. */
              x: +d.x.toFixed(2), y: +d.y.toFixed(2),
              frame: Math.floor(d.animT), moving: !!d.move,
              /* The texture frame too, so a harness can check that the legs are really animating. */
              tex: (() => {
                const t = sp.texture
                const f = t?.frame
                return f ? `${t.source?.label ?? ''}#${f.x},${f.y},${f.width},${f.height}` : String(t?.uid ?? '')
              })(),
              /* And which way the body faces. A heading that flips between two neighbors on
               * alternate frames is a body twitching, and no screenshot can catch it. */
              facing: d.facing,
            }
          }
          return out
        },
        /* Which bound placements are visible, by the name their author typed, so a harness can
         * check that a thing really appeared. */
        get shown() {
          const out: Record<string, boolean> = {}
          for (const a of anchors.all) {
            if (!a.placement) continue
            const sp = placedById.get(a.placement)
            if (sp) out[a.placement] = sp.visible
          }
          return out
        },
        /* What's on this map to be clicked, by the names their author typed. */
        get anchors() {
          return anchors.all.map((a) => {
            const p2 = anchors.spotOf(a)
            return { name: a.name, kind: a.kind, x: Math.round(p2.x), y: Math.round(p2.y), r: a.r }
          })
        },
        get paths() { return pathNames(paths) },
        get shots() { return [...shots.keys()] },
        /* Whether the room's Python is in the middle of a handler, and whether it has finished
         * setting up the room. */
        get island() {
          return { handlers: grapeHandlers, busy: !!grape?.busy(), started: islandStarted }
        },
        perform: (i: unknown) => performIntent(i as Intent, intentHost),
      }

      app.ticker.add((tk) => {
        const dt = Math.min(tk.deltaMS, 50) / 1000
        const t = performance.now() / 1000

        /* The script runs on this same clock, so the runtime moves forward on game ticks instead of
         * timers. */
        runtime.tick(tk.deltaMS)
        /* The walking step is MAPVIS's own Walker.step, so sliding along walls and the stuck escape
         * behave the same in both. */
        /* Who has the controls right now: a door fade, a panel or cutscene, or an auto-walk. */
        const locked = worldHeld()
        let input: Record<string, boolean> = fade || locked ? {} : keys
        /* How much of this frame's time the walk gets. Changing it is how a walking pace is set. */
        let walkDt = dt

        /* Auto-walk steers using the player's own walking rules, and gives up after a time limit. */
        /* A door exit has control of the character, so a fade is never overridden here. */
        /* The player can change their mind. Pressing a movement key cancels a walk they started by
         * clicking. */
        if (autoWalk?.byPlayer && (input['w'] || input['a'] || input['s'] || input['d']
          || input['arrowup'] || input['arrowdown'] || input['arrowleft'] || input['arrowright'])) {
          const w = autoWalk
          autoWalk = null
          w.done()
        }
        if (autoWalk && !fade) {
          /* Aim at the stand-at point beside the thing, not at the middle of it. */
          const A = autoWalk
          const gap = Math.hypot(A.goal.x - pos.x, A.goal.y - pos.y)
          const arrived = gap <= A.reach
          /* Getting closer earns more time. Nothing else does. */
          if (A.routed && gap < A.best - 1) {
            A.best = gap
            A.until = performance.now() + A.budget
          }
          if (arrived || performance.now() > Math.min(A.until, A.ceiling)) {
            if (!arrived) console.warn(`[pmap] the walk to ${A.label} gave up; no route from here`)
            /* Tell the player on screen too, but only for a walk they asked for. */
            if (!arrived && !A.routed && A.byPlayer) note(`You cannot get to ${A.label} from here.`)
            /* Face the side the thing is used from, which is the heading the author put on the
             * anchor. */
            if (A.facing && walkT[A.facing]) walker.facing = A.facing
            autoWalk = null
            A.done()
            /* Only call this after autoWalk is null, so whatever it does can't cancel this walk. */
            if (arrived) A.arrive?.()
          } else {
            /* Follow the route one waypoint at a time. Steering straight at the goal gets stuck in
             * a maze, but steering at the next point of a route the walk already approved doesn't. */
            while (A.ri < A.route.length && Math.hypot(A.route[A.ri].x - pos.x, A.route[A.ri].y - pos.y) <= 4) A.ri++
            /* If the player has been stuck on a leg for half a second, skip to the next one. */
            if (walker.blocked) A.stuckMs = (A.stuckMs ?? 0) + dt * 1000
            else A.stuckMs = 0
            if (A.stuckMs > 500 && A.ri < A.route.length) { A.ri++; A.stuckMs = 0 }
            const wp = A.ri < A.route.length ? A.route[A.ri] : A.goal
            input = steerToward(wp.x - pos.x, wp.y - pos.y, dt)
            /* When following someone, walk at the leader's pace and stop inside the gap. */
            if (A.follow) {
              const lead = driven.get(A.follow.body)
              if (lead) {
                const step = followStep({
                  leader: lead, leaderSpeed: lead.move ? lead.move.speed : null,
                  me: pos, gap: A.follow.gap, restSpeed: A.follow.speed,
                  /* The player's own speed is SPD, which is twice the map's number. */
                  ownSpeed: SPD, yScale: map.yScale || 1,
                })
                if (step.hold) {
                  input = {}
                  /* Waiting here isn't being stuck. The time limit is for a walk that can't arrive,
                   * and this one is waiting on purpose. */
                  A.until = performance.now() + A.budget
                  A.stuckMs = 0
                }
                walkDt = dt * step.paceScale
              }
            }
          }
        }

        /* Whatever is being driven decides what the camera follows and how far out it sits. */
        if (hull) {
          /* The docking line gets handed to the sailing follower below. */
          if (berthing) {
            /* The docking maneuver drives the same hull with the same physics as the player's helm. */
            /* The maneuver gets a depth check so it only ever aims at water. */
            const r = berthHelm(hull, berthing, DEFAULT_SAIL, dt,
              (x, y) => depthAt(x, y) >= DEFAULT_SAIL.probe)
            berthing = r.next
            hull = stepHull(hull, r.helm, dt, depthAt)
            if (berthing.stage === 'done') docked()
            /* A maneuver that can't finish gives the helm back and doesn't put anybody ashore. */
            else if (berthing.stage === 'given_up') {
              const s = docking
              berthing = null
              docking = null
              engine.log('berthing_gave_up', {
                map: mapId, to: s?.map ?? null, aground: hull.aground,
                shortBy: Math.round(Math.hypot(fromSea(s?.berth?.x ?? 0, s?.berth?.y ?? 0).x - hull.x,
                  fromSea(s?.berth?.x ?? 0, s?.berth?.y ?? 0).y - hull.y)),
              })
              void say({ text: 'The boat cannot dock from here. Back away and try again.' })
              /* Tell the route that asked for it. */
              sailing = null
              sailingTo = null
              endVoyage(new NotBuilt('route', 'the ship could not come alongside at the end of the route'))
            }
          } else if (sailing) {
            /* Steering along a route. The ship passes waypoints at speed, and the last one becomes
             * a berthing. */
            const s2 = sailing
            const aim = s2.pts[s2.i]
            const dx = aim.x - hull.x, dy = aim.y - hull.y
            const d = Math.hypot(dx, dy)
            const ahead = Math.cos(hull.heading) * dx + Math.sin(hull.heading) * dy
            s2.left -= dt
            if (s2.left <= 0) {
              /* If a sailing line runs out of time, hand the hull to the berthing maneuver. */
              const b2 = sailingTo?.berth
              sailing = null
              if (b2 && !berthing) {
                docking = sailingTo?.slot ?? null
                lastBerth = b2.name ?? null
                berthing = {
                  target: fromSea(b2.x, b2.y),
                  facing: b2.facing || b2.bearing !== undefined
                    ? radOf(b2.facing, b2.bearing) : undefined,
                  approach: b2.approach ? fromSea(b2.approach.x, b2.approach.y) : undefined,
                  stage: 'approach',
                }
                console.warn(`[sail] ${mapId}: the way in ran long, so she comes alongside from here`)
                engine.log('voyage_slow', { map: mapId, at: s2.i, of: s2.pts.length })
              } else {
                sailingTo = null
                engine.log('voyage_gave_up', { map: mapId, at: s2.i, of: s2.pts.length })
                endVoyage(new NotBuilt('route', `the ship did not reach waypoint ${s2.i} of ${s2.pts.length - 1} in time`))
              }
            } else if (s2.i < s2.pts.length - 1 && (d < 40 || (ahead < 0 && d < DEFAULT_SAIL.cruise))) {
              s2.i++
              hull = stepHull(hull, { throttle: 1, turn: 0, fullSail: false }, dt, depthAt)
            } else if (s2.i >= s2.pts.length - 1
              && (d < RUN_IN_CORRIDOR_PX || (ahead < 0 && d < DEFAULT_SAIL.cruise))) {
              /* The handover happens wherever the ship gets close, measured by distance and not by
               * reaching the last waypoint index. */
              /* The berth was picked when the sail command was given, so a line with no berth never
               * gets here. */
              const b = sailingTo?.berth
              const end = b ? fromSea(b.x, b.y) : aim
              docking = sailingTo?.slot ?? null
              lastBerth = b?.name ?? null
              berthing = {
                target: end,
                facing:
                  (b?.facing ?? s2.path.facing) || (b?.bearing ?? s2.path.bearing) !== undefined
                    ? radOf(b?.facing ?? s2.path.facing, b?.bearing ?? s2.path.bearing)
                    : undefined,
                approach: b?.approach ? fromSea(b.approach.x, b.approach.y) : undefined,
                stage: 'approach',
              }
              sailing = null
              engine.log('voyage_arriving', { map: mapId, path: s2.path.name, berth: b?.name ?? null })
              /* The promise settles at docked(), the moment the player is standing on the island. */
            } else {
              /* Slow down before the last mark, so the maneuver gets a hull going under half cruise
               * speed. */
              const helm = steerTo(hull, aim)
              if (s2.i >= s2.pts.length - 1) dockingSpeed(helm, d, hull.speed)
              hull = stepHull(hull, helm, dt, depthAt)
            }
          } else if (castOff) {
            /* The two seconds after pressing E. The ship pulls off the berth on its own and turns
             * onto the way out. */
            if (performance.now() > castOff.until) castOff = null
            /* Turn first, then push. There's no throttle until the bow is within a right angle of
             * the way out. */
            let cast: Helm = HELM_IDLE
            if (castOff) {
              let err = Math.atan2(castOff.y - hull.y, castOff.x - hull.x) - hull.heading
              while (err > Math.PI) err -= 2 * Math.PI
              while (err < -Math.PI) err += 2 * Math.PI
              cast = easeHelm(err, Math.abs(err) > Math.PI / 2 ? 0 : (castOff.ease ?? 1))
            }
            hull = stepHull(hull, cast, dt, depthAt)
          } else {
            if (helmOverride && performance.now() > helmOverride.until) helmOverride = null
            /* The keys beat a click, so the click target is dropped as soon as a key is touched. */
            const steering = !!(input['arrowup'] || input['w'] || input['arrowdown'] || input['s']
              || input['arrowleft'] || input['a'] || input['arrowright'] || input['d'])
            if (sailTap && (steering || fade || locked || helmOverride)) sailTap = null
            /* Stop when the ship gets there, runs out of time, or runs aground. */
            if (sailTap && (Math.hypot(sailTap.x - hull.x, sailTap.y - hull.y) < 26
              || performance.now() > sailTap.until || hull.aground)) sailTap = null
            let helm: Helm = helmOverride ? helmOverride.helm : fade || locked ? HELM_IDLE : {
              throttle: (input['arrowup'] || input['w']) ? 1 : 0,
              turn: (input['arrowright'] || input['d']) ? 1 : (input['arrowleft'] || input['a']) ? -1 : 0,
              fullSail: !!input['shift'],
            }
            if (sailTap && !helmOverride && !fade && !locked) {
              /* Cut the throttle in time to stop at the spot, using the same stopping math
               * berthHelm uses. */
              const left = Math.hypot(sailTap.x - hull.x, sailTap.y - hull.y)
              const stopIn = (hull.speed * hull.speed) / (2 * DEFAULT_SAIL.drag)
              if (left <= stopIn + 8) sailTap = null
              else helm = steerTo(hull, sailTap)
            }
            hull = stepHull(hull, helm, dt, depthAt)
          }

          /* The wake: two trails from the hull's corners that spread apart, with an age on each
           * point, drawn from the hull's state. */
          /* The wake is drawn as a band of churned water that widens and fades behind the ship, not
           * as two thin lines. */
          wakeG.clear()
          if (hull) {
            const life = DEFAULT_SAIL.wakeLife
            for (const side of [-1, 1] as const) {
              const pts = hull.wake.filter((p) => p.side === side)
              if (pts.length < 2) continue
              for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1], b = pts[i]
                const ka = 1 - a.age / life
                const kb = 1 - b.age / life
                if (kb <= 0) continue
                const dx = b.x - a.x, dy = b.y - a.y
                const len = Math.hypot(dx, dy)
                /* Skip a near-zero gap between two points, since it would leave a hole in the band.
                 * Skip a huge one too, because that's a teleport. */
                if (len < 0.01 || len > 60) continue
                /* Use the direction of the trail itself, so a turn curls the foam the way the water
                 * goes. */
                const px = -dy / len, py = dx / len
                /* Draw a four-sided shape between each pair of points, so the band stays solid when
                 * the frame rate drops. */
                /* The band opens into a wedge behind the ship as the two sides spread apart. */
                const wa = (1.2 + (1 - ka) * 5.5) / 2
                const wb = (1.2 + (1 - kb) * 5.5) / 2
                const oa = (1 - ka) * 13 * side, ob = (1 - kb) * 13 * side
                const ax = a.x + px * oa, ay = a.y + py * oa
                const bx2 = b.x + px * ob, by2 = b.y + py * ob
                wakeG.poly([
                  ax + px * wa, ay + py * wa,
                  bx2 + px * wb, by2 + py * wb,
                  bx2 - px * wb, by2 - py * wb,
                  ax - px * wa, ay - py * wa,
                ]).fill({ color: 0xdff4f6, alpha: 0.5 * kb * kb * kb })
                /* The white water right behind the stern, only while it's fresh. */
                if (kb > 0.86) {
                  wakeG.poly([
                    a.x + px * 1.1, a.y + py * 1.1,
                    b.x + px * 1.1, b.y + py * 1.1,
                    b.x - px * 1.1, b.y - py * 1.1,
                    a.x - px * 1.1, a.y - py * 1.1,
                  ]).fill({ color: 0xffffff, alpha: 0.5 * (kb - 0.86) / 0.14 })
                }
              }
            }
          }

          /* Discovering places is measured from the painted area and checked twice a second. */
          if (comp && hull && t - lastSeaCheck > 0.5) {
            lastSeaCheck = t
            const at = toSea(hull.x, hull.y)
            for (const s of discoveredSlots(comp, at)) {
              if (!s.place || seenPlaces.has(s.place)) continue
              seenPlaces.add(s.place)
              recordExposure(s.place, false)
              engine.log('place_seen', { place: s.place, map: s.map ?? null, docked: false, via: 'sail' })
              drawSlots()
              void playFx(s.map ? 'island_rising' : 'chart_marked', fromSea(s.at.x, s.at.y)).catch(() => {})
            }
            const reg = regionAt(comp, at)
            if (reg && reg.name !== lastRegion) {
              lastRegion = reg.name
              engine.log('sea_region', { region: reg.name, kind: reg.kind })
            }
          }
        }

        /* The ship gets drawn whether or not anyone is sailing it, so a moored ship still shows on
         * the map. */
          /* One drawing covers both a hull out sailing and a ship tied up. Nobody steers the moored
           * one. */
          const draw = hull ?? moored
          if (hullSp) {
            /* This is the one place that decides whether the ship is drawn, so every part of the
             * scene agrees. */
            hullSp.visible = !!draw
          }
          if (draw && hullSp) {
            hullSp.position.set(draw.x, draw.y)
            hullSp.zIndex = OVER_PLACED + draw.y
            if (hullViews.length) {
              /* The 16 views go counterclockwise from east, so a heading picks a picture by index
               * and the sprite is never rotated. */
              const i = ((Math.round((draw.heading / (Math.PI * 2)) * 16) % 16) + 16) % 16
              const t2 = hullViews[i]
              if (t2 && hullSp.texture !== t2) hullSp.texture = t2
            }
          }

        const moving = !!(
          input['arrowup'] || input['w'] || input['arrowdown'] || input['s'] ||
          input['arrowleft'] || input['a'] || input['arrowright'] || input['d']
        )
        if (!hull) walker.step(doc, cfg, input, walkDt)
        /* A pose ends when the player really moves, so a sleeping body never slides. */
        if (posed && (moving || autoWalk) && (pos.x !== poseAt.x || pos.y !== poseAt.y)) posed = null

        /* Anything waiting for the player to arrive somewhere, checked on the scene's own frames. */
        if (waiters.length) {
          const now2 = performance.now()
          for (let wi = waiters.length - 1; wi >= 0; wi--) {
            const w2 = waiters[wi]
            const there = anchors.contains(w2.a, pos.x, pos.y)
            if (!there && now2 <= w2.until) continue
            waiters.splice(wi, 1)
            w2.done(there)
          }
        }
        const fr = posed ? posed.tex
          : moving ? walkArt[walker.facing][1 + (Math.floor(walker.animT) % 5)] : walkArt[walker.facing][0]
        if (thor.sp.texture !== fr) thor.sp.texture = fr
        thor.sp.position.set(pos.x, pos.y)
        thor.sp.zIndex = OVER_PLACED + pos.y
        thor.sh.position.set(pos.x + 1, pos.y - 2)
        // Draw the shadow just under the player, so it never lands on a figure the player is
        // standing in front of.
        thor.sh.zIndex = OVER_PLACED + pos.y - 1
        /* The marker bobs in whole screen pixels, so it moves cleanly instead of shimmering. */
        const bob = Math.round(Math.sin(t * 2.1) * 2) / camZ
        /* Put it over the middle of the player's body, not the middle of the sprite's canvas. */
        pin.position.set(pos.x + (pinDx[walker.facing] ?? 0), pos.y - charH - 3 + bob)
        /* Snap the whole marker to whole screen pixels, so its edge doesn't crawl. */
        const gp = pin.getGlobalPosition()
        pin.x -= (gp.x - Math.round(gp.x)) / camZ
        pin.y -= (gp.y - Math.round(gp.y)) / camZ
        /* The one objective this scene knows and the year doesn't: the player is steering the ship. */
        {
          /* Not during a cutscene. The scene doesn't add its own objective while a script is in
           * charge. */
          /* Don't offer the tiller in the last shot, where the player is aboard but not steering. */
          const freeAtSea = !!hull && !berthing && !voyage && !helmOverride
            && !tiedUp && !movieOn && !runEnding()
          setWorldObjective(freeAtSea ? 'Click the island to sail there.' : null)
        }
        /* A script's camera beats the follow camera and snaps into place, since the runtime is
         * already easing it. */
        if (csCam) {
          /* The script moves the camera without changing what the follow camera wants. */
          const z = Z_SHOT * (csCam.zoom || 1)
          if (camZ !== z) { camZ = z; world.scale.set(camZ); refreshSea() }
          camTo(csCam.x, csCam.y, true)
        } else {
          /* The zoom follows from what's being driven, and the ocean is rebuilt when the scale
           * changes. */
          if (stepZoom(dt)) refreshSea()
          /* Stop following the body while a shot is held, so two camera eases don't fight. */
          if (!lookAtTarget) {
            if (hull) camTo(hull.x, hull.y, false, dt)
            else camTo(pos.x, pos.y, false, dt)
          }
        }
        /* The screen-space UI cancels out the live zoom, so a camera push leaves the pin the same
         * size. */
        const uiS = 1 / camZ
        if (pin.scale.x !== uiS) {
          pin.scale.set(uiS); prompt.scale.set(uiS); bigMark.scale.set(uiS)
        }
        /* Two things a world hold doesn't reach, so their visibility is set here every frame from
         * the shot and the movie state. */
        /* The marker stays on while a script is walking the player, so it's still clear which body
         * is the player. */
        /* The YOU marker stays up for the whole beat instead of blinking off between stages. */
        /* The pin and the arrow are drawn into the world and follow the same rule the corner does. */
        const shotHeld = !!lookAtTarget && !!lastShot && shots.has(lastShot)
        pin.visible = pinWanted && !shotHeld
        slotMarks.visible = !movieOn
        ;(window as any).__walk = `thor ${pos.x.toFixed(0)},${pos.y.toFixed(0)} lvl${lvlAt(pos.x, pos.y)}`

        /* Save the player's position, stamped with the bundle it was written against. Nothing is
         * saved while the player is in a hull. */
        if (!hull && moving && t - lastWhere > 1) {
          lastWhere = t
          recordPosition(stampOf(stamp, undefined, Math.round(pos.x), Math.round(pos.y)))
        }

        /* The nearest anchor whose ring the player's feet are inside gets the prompt, whether it's
         * a door or a station. */
        /* The prompt on the water is the same prompt, since a berth belongs to the world. */
        /* A sign never sits on top of the player it's talking to, so it hangs below them instead. */
        const hang = (px: number, py: number, up: number, bob: number) => {
          prompt.position.set(px, py - up + bob)
          if (!prompt.visible) return
          /* Overlap is checked on the drawn boxes, not on how far apart the two points are. */
          const b = prompt.getBounds()
          const feet = world.toGlobal({ x: pos.x, y: pos.y })
          const crown = world.toGlobal({ x: pos.x, y: pos.y - charH })
          const halfW = charH * 0.4 * camZ
          const hits = b.maxY > crown.y && b.minY < feet.y
            && b.maxX > feet.x - halfW && b.minX < feet.x + halfW
          /* Placed by its top edge, since prompt.position is the plaque's center. */
          if (hits) {
            const worldH = b.height / camZ
            prompt.position.set(px, pos.y + Math.round(charH * 0.22) + worldH / 2 + bob)
          }
        }
        /* Keep it off the lit ring too. The plaque moves sideways off the light. */
        const clearOfLit = (own: Anchor | null) => {
          if (!prompt.visible || !lit.visible || !litAnchor || own?.name === litAnchor.name) return
          const b = prompt.getBounds()
          const r = lit.getBounds()
          const gap = 6
          if (b.maxX <= r.minX - gap || b.minX >= r.maxX + gap || b.maxY <= r.minY - gap || b.minY >= r.maxY + gap) return
          const right = (r.maxX + gap) - b.minX
          const left = b.maxX - (r.minX - gap)
          let dx = right <= left ? right : -left
          if (b.maxX + dx > app.screen.width - 4) dx = -left
          else if (b.minX + dx < 4) dx = right
          prompt.x += dx / camZ
        }
        seaFire = null
        if (hull && !berthing && !locked && !fade && !tiedUp && comp) {
          const at = toSea(hull.x, hull.y)
          const home = comp.slots.find((s) =>
            s.berth && Math.hypot(s.berth.x - at.x, s.berth.y - at.y) < 90)
          if (home?.berth) {
            const p = fromSea(home.berth.x, home.berth.y)
            setPrompt(home.map === mapId ? 'Dock here' : `Dock at ${home.title}`, 'plain')
            hang(p.x, p.y, 26, Math.sin(t * 2.1) * 1.2)
            /* Keep it off the ship too, so the plaque drops under the ship as it comes alongside. */
            if (hullSp && prompt.visible) {
              const pb = prompt.getBounds()
              const hb = hullSp.getBounds()
              if (pb.maxX > hb.minX && pb.minX < hb.maxX && pb.maxY > hb.minY && pb.minY < hb.maxY)
                prompt.y = hull.y + (hb.height / 2 + pb.height / 2 + 6) / camZ
            }
            promptAnchor = null
            seaFire = () => dockAt(home)
          } else {
            prompt.visible = false
            promptAnchor = null
          }
        }
        /* Pressing E by the ship opens the travel chart, drawn from the real world composition. */
        /* E means board the ship when a journey is waiting on the player. */
        const owed = travelPlan()
        const boardingHere = !!owed && owed.leg === 'boarding' && !hull && canSail && !!berth
        if (boardingHere && berth && !busy && !fade) {
          const p = fromSea(berth.x, berth.y)
          setPrompt('Board the ship', 'plain')
          hang(p.x, p.y, 26, Math.sin(t * 2.1) * 1.2)
          promptAnchor = null
          seaFire = () => {
            if (travelPlan()?.leg !== 'boarding') return
            setTravelLeg('crossing')
            void runVoyageLeg()
          }
        } else if (!hull && canSail && berth && !locked && !busy && !fade) {
          const p = fromSea(berth.x, berth.y)
          if (Math.hypot(p.x - pos.x, p.y - pos.y) < 110) {
            setPrompt('Open the chart', 'plain')
            hang(p.x, p.y, 26, Math.sin(t * 2.1) * 1.2)
            promptAnchor = null
            seaFire = () => { requestUi('chart') }
          }
        }

        /* The one lit thing can be pressed from a little farther away, so a push can't leave it out
         * of reach. */
        const guided = leading ? anchors.get(leading) : undefined
        const near = hull || seaFire || locked || busy || fade
          ? null
          : anchors.nearestInteractive(pos.x, pos.y)
            ?? (guided && guided.kind !== 'region' && guided.kind !== 'trigger'
              && Math.hypot(anchors.standAt(guided).x - pos.x, anchors.standAt(guided).y - pos.y)
                <= map.character.heightPx * 1.6
              ? guided : undefined)
        const st = near ? offerOf(near) : null
        const canFire = !!st?.canFire
        if (near && st) {
          // Use spotOf, so an anchor tied to a pacing body shows its prompt where that body stands.
          const np = anchors.spotOf(near)
          setPrompt(st.text, st.state)
          hang(np.x, np.y, 18, Math.sin(t * 2.1) * 1.2)
          /* A door's plaque hangs below the door, on the ground in front of it. */
          if (near.kind === 'door' && prompt.visible) {
            const pb = prompt.getBounds()
            prompt.y = np.y + (pb.height / 2 + 8) / camZ + Math.sin(t * 2.1) * 1.2
          }
          clearOfLit(near)
          /* The plaque can only be tapped when pressing E would do something. */
          prompt.eventMode = canFire ? 'static' : 'none'
          promptAnchor = canFire ? near : null
        } else if (!seaFire) { prompt.visible = false; promptSaid = ''; promptAnchor = null }
        /* The plaque takes a tap on the water too, since "press E" is no help to someone using only
         * a trackpad. */
        seaTap = seaFire

        /* The objective marker shows one thing at a time, picked by the year's own state machine. */
        const obj = nextObjective(loadSave())
        /* A guide_to from a station beats the year's own next step. */
        /* If the thing it points at is on another map, it leads to the door that goes there. */
        const doorTo = (want: string): Anchor | undefined =>
          doors.find((d) => d.to === want)
        const mark = guideTarget ?? (
          !obj ? undefined
            /* Once the year is done, nothing is owed and nothing gets pointed at. */
            : obj.phase === 'done' ? undefined
              : obj.map === mapId ? anchors.byRole(obj.role)
                : doorTo(obj.map))
        leading = mark?.name ?? null
        if (mark) {
          /* The arrow follows a route found by the same path search the walk uses, and only
           * searches again when the old route is stale. */
          const goal = anchors.standAt(mark)
          /* The search reruns only after both 700 ms have passed and the player has moved 40
           * pixels, or when the target changes. */
          const stale = !guide || guide.key !== mark.name
            || (performance.now() - guide.at > 700 && Math.hypot(pos.x - guide.from.x, pos.y - guide.from.y) > 40)
          if (stale) {
            const r = findPath(doc, cfg, { x: pos.x, y: pos.y }, goal, { step: 4 })
            guide = { key: mark.name, route: r.points, from: { x: pos.x, y: pos.y }, reached: r.reached, at: performance.now() }
          }
          const g = guide!
          /* The marks stay up during a scripted walk and under the black bars, for the whole beat. */
          const marksOn = !fade && !shotHeld && (!!autoWalk || !!guideTarget || (!locked && !movieOn))

          /* The sign hangs on the thing, not over the middle of the room. */
          const over = anchors.spotOf(mark)
          const atIt = Math.hypot(over.x - pos.x, (over.y - pos.y) * (map.yScale || 1))
            < map.character.heightPx * 2.5
          /* Lift it about half a body above the anchor, so the sign lands on the thing and not on
           * whatever is drawn behind it. */
          const lift = Math.round(map.character.heightPx * (atIt ? 0.9 : 0.55))
          bigMark.position.set(over.x, over.y - lift + Math.sin(t * 2.6) * 3)
          /* Keep it under the top panel too. The panel's bottom edge is measured once a second
           * instead of hardcoded. */
          if (t - panelBandAt > 1) {
            panelBandAt = t
            const el = document.querySelector('.ob-wrap')
            const r = el ? el.getBoundingClientRect() : null
            panelBand = r && r.height > 0 ? r.bottom : 0
          }
          if (panelBand > 0) {
            /* The sprite hangs by its bottom, so its top edge is a full height above where it's
             * placed. */
            const topPx = world.y + (bigMark.y - bigMark.height) * camZ
            const short = panelBand + 4 - topPx
            if (short > 0) bigMark.y += short / camZ
          }
          bigMark.zIndex = 9e9 - 2
          /* A highlight is a light on a thing, not a hint to walk there. */
          bigMark.visible = marksOn && !markQuiet

          /* The light sits on the thing at its current position, squashed flat onto the painting's
           * floor. */
          const spot = anchors.spotOf(mark)
          /* The light is sized against the body's height, with the ring's radius and 22 pixels as
           * minimums. */
          const want = Math.max(mark.r, Math.round(map.character.heightPx * 1.1), 22)
          litAnchor = mark
          if (litKey !== mark.name || litR !== want) {
            litKey = mark.name
            litR = want
            const ry = Math.max(6, want * (map.yScale || 1) * 0.5)
            litRy = ry
            /* A pool of light on the ground, drawn as a soft disc instead of a sticker on top of
             * the art. */
            lit.clear()
            lit.ellipse(0, 0, want * 0.98, ry * 0.98).fill({ color: 0xffe9b8, alpha: 0.1 })
            lit.ellipse(0, 0, want + 2, ry + 2).stroke({ color: 0x241708, width: 3, alpha: 0.5 })
            lit.ellipse(0, 0, want, ry).stroke({ color: 0xffe9b8, width: 2, alpha: 0.95 })
          }
          lit.position.set(spot.x, spot.y)
          /* A ring leaves the pool every two and a half seconds and fades as it spreads. */
          litRing.clear()
          litRing.position.set(spot.x, spot.y)
          litRing.zIndex = lit.zIndex
          if (!prefersReducedMotion()) {
            const ph = (t / 2.5) % 1
            const grow = 0.62 + ph * 0.75
            const fade = 1 - ph
            /* It uses the same two-tone edge as the pool. */
            litRing.ellipse(0, 0, want * grow + 2, litRy * grow + 2)
              .stroke({ color: 0x241708, width: 3, alpha: 0.34 * fade })
            litRing.ellipse(0, 0, want * grow, litRy * grow)
              .stroke({ color: 0xffe9b8, width: 2, alpha: 0.62 * fade })
          }
          litRing.visible = marksOn
          /* Draw it over the painting but under anything on the same row, including the player and
           * every occluder. */
          lit.zIndex = spot.y - 0.5
          /* The pulse fades in and out smoothly instead of blinking, and turns off for reduced
           * motion. */
          lit.alpha = prefersReducedMotion() ? 1 : 0.82 + Math.sin(t * 2.6) * 0.18
          lit.visible = marksOn

          /* The route itself, shown as arrow marks on the ground that point the way it goes. */
          /* The marks are spaced by distance on the ground, not by waypoint index. */
          let shown = 0
          /* The arrow art is stored in this repo, so it doesn't depend on the platform's sheet. */
          if (marksOn && (trailArt.size > 0 || trailTex) && g.route.length > 1) {
            const ys = map.yScale || 1
            /* Spaced by body height, so they look like a path at either zoom. */
            const STEP = Math.max(16, Math.round(map.character.heightPx * 1.5))
            let run = 0
            /* The first mark is about one body length from the player's feet, so the path starts
             * right in front of them. */
            let next = map.character.heightPx * 1.2
            const marks: { x: number; y: number; t: number; dir: string }[] = []
            for (let i = 1; i < (markQuiet ? 0 : g.route.length) && marks.length < 64; i++) {
              const a = g.route[i - 1], b = g.route[i]
              const dx = b.x - a.x, dy = (b.y - a.y) * ys
              const seg = Math.hypot(dx, dy)
              if (seg < 0.001) continue
              while (run + seg >= next && marks.length < 64) {
                const k = (next - run) / seg
                const x = a.x + (b.x - a.x) * k
                const y = a.y + (b.y - a.y) * k
                next += STEP
                if (Math.hypot(x - pos.x, (y - pos.y) * ys) < map.character.heightPx * 0.9) continue
                /* The arrow's direction comes from the route's movement in pixels, squashed the
                 * same way a body's facing is. */
                marks.push({ x, y, t: 0, dir: dirFrom(b.x - a.x, (b.y - a.y) * ys) })
              }
              run += seg
            }
            for (let i = 0; i < marks.length; i++) marks[i].t = marks.length < 2 ? 1 : i / (marks.length - 1)
            for (const m of marks) {
              const art = trailArt.get(m.dir) ?? trailTex
              if (!art) continue
              let sp = trailSprites[shown]
              if (!sp) {
                sp = new Sprite(art)
                sp.anchor.set(0.5, 0.5)
                trailSprites.push(sp)
                trailLayer.addChild(sp)
              }
              if (sp.texture !== art) sp.texture = art
              /* Sized against the character and snapped to whole pixels. */
              const arrow = trailArt.has(m.dir)
              /* Big enough to read at the close zoom, so it looks like a marking on the floor. */
              /* Marks near the player are smaller and softer, and the far ones are bigger and
               * brighter. */
              const want = Math.max(3, Math.round(map.character.heightPx * (arrow ? 0.34 + 0.22 * m.t : 0.26 + 0.18 * m.t)))
              sp.width = want
              sp.height = Math.max(1, Math.round(want * ys))
              sp.position.set(Math.round(m.x), Math.round(m.y))
              /* The alpha stays fairly high, because the arrow art has its own dark outline. */
              sp.alpha = 0.55 + 0.4 * m.t
              sp.visible = true
              shown++
            }
          }
          for (let i = shown; i < trailSprites.length; i++) trailSprites[i].visible = false
          trailMarks = shown
        } else {
          bigMark.visible = false
          for (const sp of trailSprites) sp.visible = false
          trailMarks = 0
          /* Check before hiding instead of clearing every time, since this runs every frame on a
           * map with nothing to point at. */
          if (lit.visible) { lit.visible = false; litKey = ''; litR = 0; litRy = 0 }
          if (litRing.visible) { litRing.visible = false; litRing.clear() }
          litAnchor = null
          guide = null
        }

        /* Regions and triggers fire when the player walks into them. A region gets logged, and a
         * trigger runs. */
        if (!fade && !busy && !runtime.running) {
          const nowIn = anchors.regionsAt(pos.x, pos.y)
          const nowNames = new Set(nowIn.map((z) => z.name))
          for (const z of nowIn) {
            if (inZones.has(z.name)) continue
            inZones.add(z.name)
            engine.log(z.kind === 'trigger' ? 'trigger_entered' : 'region_entered', { map: mapId, anchor: z.name })
            if (z.kind !== 'trigger') continue
            const repeat = z.meta?.repeat === true
            if (!repeat && firedTriggers.has(z.name)) continue
            /* Only mark a trigger fired if it really ran. A trigger nobody answers says so in the
             * console. */
            if (!ownerOf(z.name, grapeHandlers)) {
              console.warn(`[pmap] ${mapId}: trigger "${z.name}" fired and nothing answers to that name`)
              engine.log('trigger_unanswered', { map: mapId, anchor: z.name })
              firedTriggers.add(z.name)
              continue
            }
            /* The island has to be free too. It's checked here because this is the code that uses
             * up the trigger. */
            if (busy || (!!ownerOf(z.name, grapeHandlers) && grape?.busy())) continue
            firedTriggers.add(z.name)
            void fire(z)
          }
          for (const name of [...inZones]) {
            if (nowNames.has(name)) continue
            inZones.delete(name)
            engine.log('region_left', { map: mapId, anchor: name })
          }
        }

        /* A camera hold from look_at, released when its time runs out. */
        if (lookAtTarget) {
          if (performance.now() > lookAtTarget.until) { lookAtTarget = null; setShotUp(false) }
          else {
            const was = holdStill
            holdStill = false
            camTo(lookAtTarget.x, lookAtTarget.y, false, dt)
            holdStill = was
          }
        }

        // E counts once per press, not while it's held down. One press is one interaction.
        const eNow = !!keys['e']
        if (eNow && !ePrev) {
          if (seaFire) { startWrap(); seaFire(); keys['e'] = false }
          else if (near && canFire) { startWrap(); fire(near) }
        }
        ePrev = eNow
        /* The ring runs on the scene's own clock, so it still draws while a handler is holding the
         * world. */
        tickWrap()

        /* One-shot effects, ticked on the engine's own clock so each one plays to the end. */
        for (let i = fxRuns.length - 1; i >= 0; i--) {
          const f = fxRuns[i]
          f.t += dt
          const k = Math.min(1, f.t / f.life)
          f.g.clear()
          if (f.kind === 'island_rising') {
            /* Three rings spread out from where the rumor was, each one fainter than the last. */
            for (let r = 0; r < 3; r++) {
              const kk = k * 1.35 - r * 0.18
              if (kk <= 0 || kk >= 1) continue
              f.g.circle(f.x, f.y, 12 + kk * 150)
                .stroke({ color: 0xdff4f6, width: 2, alpha: (1 - kk) * 0.55 })
            }
          } else if (f.kind === 'chart_marked') {
            const r = 8 + k * 14
            f.g.circle(f.x, f.y, r).stroke({ color: 0xffd98a, width: 2, alpha: 1 - k })
          } else {
            f.g.circle(f.x, f.y, 3 + k * 10).fill({ color: 0xffe9b0, alpha: (1 - k) * 0.8 })
          }
          if (k >= 1) {
            f.g.destroy()
            fxRuns.splice(i, 1)
            f.done()
          }
        }
        /* The markers on the water are screen-space UI, so zooming out leaves them the same size. */
        for (const c of slotMarks.children) if (c.scale.x !== uiS) c.scale.set(uiS)

        // Placed assets. The animated ones cycle their frames here, timed on this same ticker.
        for (const a of animAssets) {
          /* Only one thing sets each texture. A body a script has taken over is drawn only by the
           * driven pass. */
          if (driven.has(a.sp)) continue
          a.t += dt * a.fps
          /* A body keeps the heading a scene left it facing, instead of the one in its filename. */
          const kept = lastFacing.get(a.sp)
          let run = a.frames
          if (kept) {
            const look = looksOf.get(a.sp)?.[0]
            const vs = look?.views
              && (look.views[kept] || look.views[NEAREST_VIEW[kept]] || null)
            if (vs && vs.length) run = vs
          }
          const af = run[Math.floor(a.t) % run.length]
          if (a.sp.texture !== af) a.sp.texture = af
        }

        /* Placements that move on their own. Their position depends only on the clock. */
        if (lifeAssets.length) {
          const lt = performance.now() / 1000
          /* Work out everyone's spot, push them apart, then place them. These are the same three
           * passes MAPVIS uses. */
          /* lifeAt only gets the terrain as its floor and never other bodies, because its result
           * has to depend on the time alone. */
          const res = lifeAssets.map((q) => lifeAt(q.life, lt, q.home, canStand))
          /* Things that can't move are listed twice, to make up for the half of each push they
           * throw away. */
          const fixed = [...obstacles, { x: pos.x, y: pos.y, r: Math.max(BODY_MIN, HIP) }]
          const pts = [
            ...lifeAssets.map((q, i) => ({
              x: q.home.x + res[i].dx,
              y: q.home.y + res[i].dy,
              r: bodyRadius(q.bodyW),
            })),
            ...fixed,
            ...fixed,
          ]
          /* Each row says whether the floor fences it in, which lifeAt already says through
           * walkOnly. */
          const fenced = [
            ...lifeAssets.map((q) => !!q.life.walkOnly),
            ...fixed.map(() => false),
            ...fixed.map(() => false),
          ]
          const push = floorPush(pts, separate(pts, map.yScale, 1), canStand, fenced)
          for (let qi = 0; qi < lifeAssets.length; qi++) {
            const q = lifeAssets[qi]
            /* A script controls this one, so writing its position here would fight the script every
             * frame. */
            if (driven.has(q.sp)) continue
            // walkOnly makes the floor a second fence, checked with the game's own canStand.
            const at = { ...res[qi], dx: res[qi].dx + push[qi].dx, dy: res[qi].dy + push[qi].dy }
            if (at.alpha <= 0.01) {
              q.sp.visible = false
              continue
            }
            q.sp.visible = true
            q.sp.alpha = at.alpha
            q.sp.position.set(q.home.x + at.dx, q.home.y + at.dy)
            // The placement's rotation plus the tilt from its behavior, leaning from the feet
            // instead of the middle.
            q.sp.rotation = q.baseRot + at.rot
            /* Which picture to use, falling back to the first when the index is past the end. */
            const look = q.looks[at.art] || q.looks[0]
            if (look.views) {
              // All headings share one animation clock, and the walk cycle only runs while the
              // thing is moving.
              if (at.moving) q.animT += dt * look.fps
              const set = look.views[at.facing] || look.views[NEAREST_VIEW[at.facing]] || look.views.south
              /* A heading with no view and no fallback uses the look's first frame. */
              const vt = set && set.length ? set[at.moving ? Math.floor(q.animT) % set.length : 0] : look.frames[0]
              if (q.sp.texture !== vt) q.sp.texture = vt
              q.sp.scale.x = q.baseSX * (q.flipX ? -1 : 1)
            } else {
              // A plain frame list is handled in this pass too, so one loop controls the texture.
              if (look.frames.length > 1) q.animT += dt * look.fps
              const ft = look.frames[look.frames.length > 1 ? Math.floor(q.animT) % look.frames.length : 0]
              if (q.sp.texture !== ft) q.sp.texture = ft
              const face = at.flip !== q.flipX
              q.sp.scale.x = q.baseSX * (face ? -1 : 1)
            }
            if (!q.life.airborne) q.sp.zIndex = biased(q.sp, q.home.y + at.dy)
          }
        }

        /* The actors a script has taken over. They're moved after the life pass, which skips them. */
        for (const [sp, d] of driven) {
          d.moved = 0
          if (d.move) {
            /* Divide dy by the painting's y scale when measuring distance, to undo the
             * foreshortening. */
            const ys2 = map.yScale || 1
            /* One frame's travel distance is spent along as many legs as it takes to use it up. */
            let budget = d.move.speed * dt
            let settle: (() => void) | undefined
            for (let guard = 0; guard < 64 && d.move && budget > 0; guard++) {
              const dx = d.move.tx - d.x, dy = d.move.ty - d.y
              const dist = Math.hypot(dx, dy / ys2)
              if (dist > budget) {
                const k = budget / dist
                d.x += dx * k; d.y += dy * k
                d.moved += budget
                budget = 0
                break
              }
              d.x = d.move.tx; d.y = d.move.ty
              d.moved += dist
              budget -= dist
              /* Pick up the next waypoint on the same frame, so no frame goes by without moving. */
              const via = d.move.via
              if (via && via.length) {
                const next = via.shift() as { x: number; y: number }
                d.move.tx = next.x; d.move.ty = next.y
                continue
              }
              d.move.done = true
              /* Arrival is announced only from here, on the frame it really happened. */
              settle = d.move.then
              d.move = null
            }
            /* The body looks where the route is going, aimed at a point about a body's height
             * ahead. */
            if (d.move) {
              const at = aheadAlong(d.move, d.x, d.y, Math.max(6, map.character.heightPx * 0.9), ys2)
              const turn = dirFrom(at.x - d.x, (at.y - d.y) * ys2)
              if (turn) d.facing = turn
            }
            settle?.()
          }
          sp.position.set(d.x, d.y)
          sp.visible = d.visible
          sp.zIndex = biased(sp, d.y)
          if (d.look !== null || d.facing !== null) {
            const set = looksOf.get(sp)
            /* While the body walks, the walk animation wins. When it stops, it goes back to its own
             * look. */
            const look = (d.move ? gaitOf.get(sp) : undefined) ?? (set && (set[d.look ?? 0] ?? set[0]))
            if (look) {
              /* A driven body that has stopped keeps playing its idle animation instead of freezing
               * on frame zero. */
              const stride = map.speed / (look.fps || 8)
              if (d.move) d.animT += stride > 0 ? d.moved / stride : 0
              else d.animT += dt * (look.fps || 8)
              /* Pick by heading first. A look with no view for that heading falls back to the
               * nearest one. */
              const views = d.facing ? look.views : null
              const vs = views && (views[d.facing!] || views[NEAREST_VIEW[d.facing!]] || views.south)
              const frame = Math.max(0, Math.floor(d.animT))
              const want = vs && vs.length
                ? vs[frame % vs.length]
                : look.frames[look.frames.length ? frame % look.frames.length : 0]
              if (want && sp.texture !== want) sp.texture = want
            }
          }
        }

        // The sea moves with the world one to one, and refills when the view drifts two tile rows.
        if (sea) {
          sea.position.copyFrom(world.position)
          if (Math.abs(world.x - seaFX) > HH * SEA_SCALE * 2 || Math.abs(world.y - seaFY) > HH * SEA_SCALE * 2) {
            seaFX = world.x; seaFY = world.y
            refreshSea()
          }
          // The sea's swell animates by tint, at half rate when the frame is already running late.
          swellSkip = !swellSkip
          if (tk.deltaMS < 22 || swellSkip) animSwells(waterS, t, () => 0)
        }
      })

      /* The camera is placed and the world is built before the first frame the player sees. */
      app.stage.visible = true
      loadingPlate?.remove(); loadingPlate = null
      ;(window as any).__sceneReady = true
      /* Tell the HUD too, so nothing it opens shows up over the black screen before the first
       * frame. */
      setSceneDrawn(mapId)

      /* The place card tells the player where they are, once each time they arrive on this map. */
      /* Show it now, unless the player is still on the water. In that case it waits until the
       * player steps off the ship. */
      if (!(target.aboard && hull)) arrivalCard()

      console.log(`[pmap] loaded "${map.id}" ${W}x${H} zoom x${Z}${coastCut ? ' with ocean' : ' (interior, no ocean)'}${doors.length ? ` · ${doors.length} door${doors.length > 1 ? 's' : ''}` : ''}. WASD to walk.`)
    }

    let loadingPlate: HTMLDivElement | null = null
    ;(window as any).__sceneReady = false
    setSceneDrawn(null)
    start().catch((err) => console.error('[PmapScene] failed', err))
    return () => {
      destroyed = true
      setSceneDrawn(null)
      loadingPlate?.remove(); loadingPlate = null
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku)
      offHold()
      offSail()
      offHome()
      offVoyage()
      offTravel()
      offLook()
      offCamera()
      /* The black bars come down with the scene, unless a cutscene carried them through a door. */
      offCinema()
      movieHold?.(); movieHold = null
      if (!takeCinemaCarry()) setCinema(false)
      /* The line this scene added to the objective panel goes away with it. */
      setWorldObjective(null)
      /* The island's own objective line goes too, except during a voyage, since the engine is still
       * running that. */
      if (!travelPlan()) setObjectiveSaid(null)
      /* The island's task list goes with the island, since its rows are things to do here. */
      clearIslandTasks()
      /* Anything a station was waiting on gets resolved instead of being left holding the world
       * lock. */
      clearDialogue()
      /* Stop the island's worker too, so no Python heap outlives the map that started it. */
      stopIsland()
      /* Put the stage back before the scene goes, so no runtime is left published over a torn-down
       * app. */
      teardownStage()
      if (instance) instance.destroy(true, { children: true })
    }
  }, [target])

  return <div ref={hostRef} style={{ position: 'fixed', inset: 0, background: '#05080c' }} />
}
