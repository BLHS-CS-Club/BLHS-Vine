import { useEffect, useState, type CSSProperties } from 'react'
import { collectFact, grantBadge, loadSave } from '../game/save'
import { bookwormThreshold } from '../game/badges'
import { track } from '../game/telemetry'
import { announce } from '../game/ui/a11y'
import { Gauge } from '../game/ui/controls'
import { kitCached, kitOptedIn, kitPiece, kitSlot } from '../game/ui/kit'
import { prefersReducedMotion } from '../game/ui/motion'
import './transitions.css'

// One controller handles every scene change: cover the screen, swap the scene, uncover.

export type TransitionKind = 'fade' | 'foam' | 'iris' | 'chart' | 'scene'

/** What kind of arrival a cover is. It changes the cover's word, its plaque and its picture. */
export type CoverVoice = 'arrival' | 'inside' | 'crossing' | 'ceremony'

export type TransitionSpec = {
  kind: TransitionKind
  /**
   * The shortest time the cover stays fully closed. It's a minimum, so the cover can stay up
   * longer.
   */
  holdMs?: number
  /** Where the iris closes to, as fractions of the screen (center by default). */
  focus?: { x: number; y: number }
  /**
   * Scene cover: a full-screen picture, the kicker, the place's name on a drawn plaque, and a
   * loading bar.
   */
  image?: string
  /* Pictures to try in order. A bundle can come from one of two folders depending on how the game
   * started, so the overlay shows the first one and `onError` moves on to the next. A map with no
   * cover picture yet costs one failed request. When this list is given, `image` is tried last. */
  images?: string[]
  title?: string
  /* The small word over the plaque. The spaces in it are typed by hand, because letter-spacing
   * alone doesn't look like painted lettering. */
  kicker?: string
  voice?: CoverVoice
  /** Whether this cover shows a fact card. The destination decides. */
  fact?: boolean
}

/* The loading facts come straight from the fact table. Never keep a second list of facts. */
export { FACTS, factById, type Fact } from '../game/facts'
import { FACTS } from '../game/facts'

const COVER_MS = 950 // Cover in/out time. Slow and calm, never a flash.

/** The shortest a cover of this kind can last, so a fast load doesn't flash. */
export function holdFloorMs(spec: TransitionSpec): number {
  if (typeof spec.holdMs === 'number') return spec.holdMs
  if (spec.kind === 'chart') return 2400
  if (spec.kind === 'scene') return 1800
  return 60
}

type Phase = 'idle' | 'in' | 'hold' | 'out'

/** What the cover is actually doing, which the bar alone can't show. */
export type TransitionWork = 'idle' | 'working' | 'done'

export type TransitionState = {
  phase: Phase
  spec: TransitionSpec
  fact: string
  /** 0 to 1 when a caller reports real work, and null when no one has. */
  progress: number | null
  work: TransitionWork
}

export function makeTransitionState(): TransitionState {
  return { phase: 'idle', spec: { kind: 'fade' }, fact: FACTS[0].text, progress: null, work: 'idle' }
}

/**
 * How a swap reports how far along it is. `total` defaults to 1, so a caller with a fraction passes
 * one number and a caller counting files passes two.
 */
export type CoverProgress = (done: number, total?: number) => void

/* The transition state lives at module scope, so any code can ask for a cover, one at a time. */
const host = {
  st: makeTransitionState(),
  version: 0,
  busy: false,
  listeners: new Set<() => void>(),
}

const emitHost = () => { host.version++; for (const fn of host.listeners) fn() }

export function subscribeTransition(fn: () => void): () => void {
  host.listeners.add(fn)
  return () => { host.listeners.delete(fn) }
}

export const transitionState = (): TransitionState => host.st
export const transitionVersion = (): number => host.version
export const transitionBusy = (): boolean => host.busy

/* The same reporter, reachable from module scope while one cover is running. */
let liveReport: CoverProgress | null = null

/**
 * Report how much of the real work behind the current cover is done. It's ignored when no cover is
 * running, so a loader can call it any time.
 */
export function reportCoverProgress(done: number, total = 1): void {
  liveReport?.(done, total)
}

/**
 * Cover the screen, run `swap`, uncover. Resolves once the cover has lifted. If a cover is already
 * running, it does nothing and gives back false.
 */
export async function cover(
  spec: TransitionSpec,
  swap: (report: CoverProgress) => void | Promise<void>,
): Promise<boolean> {
  if (host.busy) return false
  host.busy = true
  try {
    await runTransition(host.st, emitHost, spec, swap)
    return true
  } finally {
    host.busy = false
  }
}

/** Runs a full transition: cover in, swap(), wait out the minimum hold, cover out. */
export async function runTransition(
  st: TransitionState,
  emit: () => void,
  spec: TransitionSpec,
  swap: (report: CoverProgress) => void | Promise<void>,
) {
  st.spec = spec
  st.progress = null
  st.work = 'idle'
  // Pick a fact the player hasn't learned yet. Once every fact is learned, any of them can come
  // back.
  const learned = new Set(loadSave()?.facts ?? [])
  const pool = FACTS.filter((f) => !learned.has(f.id))
  const fact = (pool.length ? pool : FACTS)[Math.floor(Math.random() * (pool.length ? pool.length : FACTS.length))]
  st.fact = fact.text
  /* Facts are collected on the scene cover because that's the cover the game actually shows. Every
   * door and every voyage goes through `coverFor`, which returns `kind: 'scene'`. If only `chart`
   * collected facts, the Facts tab would never fill up and the Bookworm badge couldn't be earned. */
  const carriesFact = spec.fact !== false && (spec.kind === 'chart' || spec.kind === 'scene')
  if (carriesFact) {
    collectFact(fact.id)
    track('loading_fact_shown', { id: fact.id })
  }
  /* The bookworm threshold comes from the fact pool, so the two can't get out of sync. */
  if ((loadSave()?.facts.length ?? 0) >= bookwormThreshold) grantBadge('bookworm')
  st.phase = 'in'; emit()
  /* One polite screen reader announcement of where the player is going. */
  if (spec.kind === 'scene' || spec.kind === 'chart') {
    const said = [spec.title, carriesFact ? st.fact : ''].filter(Boolean).join('. ')
    if (said) announce(said)
  }
  await sleep(COVER_MS)
  st.phase = 'hold'; st.work = 'working'; emit()
  const t0 = performance.now()
  /* The reporter only works while the swap is running, so a loader that answers late can't move the
   * bar of the next cover. */
  const report: CoverProgress = (done, total = 1) => {
    if (!(total > 0) || !Number.isFinite(done)) return
    const p = Math.max(0, Math.min(1, done / total))
    if (st.progress === p) return
    st.progress = p
    emit()
  }
  liveReport = report
  try {
    await swap(report)
  } finally {
    liveReport = null
  }
  /* The bar fills when the swap finishes, never on a timer. */
  st.progress = 1; st.work = 'done'; emit()
  const left = holdFloorMs(spec) - (performance.now() - t0)
  if (left > 0) await sleep(left)
  st.phase = 'out'; emit()
  await sleep(COVER_MS)
  st.phase = 'idle'; st.work = 'idle'; st.progress = null; emit()
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/* The arrival band. Its text is placed using the rectangles MAPVIS marked on the piece. */
type BandDress = { worn: boolean; style?: CSSProperties }

export function bandDress(
  pieces = kitCached(),
  worn = kitOptedIn(),
): BandDress {
  if (!pieces?.length) return { worn: false }
  const piece = kitPiece(pieces, 'band')
  const title = kitSlot(pieces, 'band', 'title')
  const sub = kitSlot(pieces, 'band', 'subtitle')
  /* A piece missing a rectangle was never finished being marked. Fall back to the stylesheet's own
   * numbers, because half-read numbers can put the place name through the frame. */
  if (!piece || !title || !sub || !(piece.w > 0 && piece.h > 0)) return { worn: false }
  return {
    worn,
    style: {
      '--band-pad-l': `${title.x}px`,
      '--band-pad-r': `${piece.w - (title.x + title.w)}px`,
      '--band-pad-t': `${title.y}px`,
      '--band-pad-b': `${piece.h - (sub.y + sub.h)}px`,
      '--band-title-h': `${title.h}px`,
      '--band-sub-h': `${sub.h}px`,
    } as CSSProperties,
  }
}

/* What the cover says about itself, in words instead of a color. */
const WORK_WORD: Record<TransitionWork, string> = {
  idle: '',
  working: 'Still loading',
  done: 'Ready',
}

const DEFAULT_KICKER = 'E N T E R I N G'

/* The last candidate is art kept in this repo, so the search always finds something. Nothing is
 * fetched ahead or waited on, so a missing destination picture only costs one failed request and
 * looks the same. */
function CoverImage({ candidates }: { candidates: string[] }) {
  const [i, setI] = useState(0)
  /* A new cover starts its search over. Otherwise the second destination would keep the first one's
   * fallback and never show its own picture. */
  const key = candidates.join('|')
  useEffect(() => { setI(0) }, [key])
  const src = candidates[Math.min(i, candidates.length - 1)]
  return (
    <img
      className="pix tr-scene-img"
      src={src}
      alt=""
      draggable={false}
      onError={() => setI((n) => (n + 1 < candidates.length ? n + 1 : n))}
    />
  )
}

export function TransitionOverlay({ st, version }: { st: TransitionState; version: number }) {
  void version // re-render key from the host
  const { phase, spec } = st
  const [needle, setNeedle] = useState(0)
  useEffect(() => {
    if (phase !== 'hold' || spec.kind !== 'chart') return
    /* A swinging needle is motion, so with reduced motion on it starts out already pointing
     * straight. */
    if (prefersReducedMotion()) { setNeedle(0); return }
    // The compass needle is the progress animation. It swings back and forth less and less until it
    // settles.
    let raf = 0
    const t0 = performance.now()
    const step = () => {
      const t = (performance.now() - t0) / 1000
      setNeedle(52 * Math.exp(-t * 1.4) * Math.sin(t * 7 + 1.2))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [phase, spec.kind])

  if (phase === 'idle') return null
  const cls = phase === 'in' ? 'tr-in' : phase === 'out' ? 'tr-out' : 'tr-hold'

  if (spec.kind === 'foam') {
    return (
      <div className={`tr-root ${cls}`}>
        <div className="tr-foam-wash" />
        <div className="tr-foam-lace" />
      </div>
    )
  }
  if (spec.kind === 'iris') {
    const f = spec.focus ?? { x: 0.5, y: 0.5 }
    return (
      <div className={`tr-root ${cls}`}>
        <div className="tr-iris" style={{ ['--fx' as string]: `${f.x * 100}%`, ['--fy' as string]: `${f.y * 100}%` }} />
      </div>
    )
  }
  if (spec.kind === 'scene') {
    const band = bandDress()
    const painted = true
    const title = spec.title ?? 'THE SEA'
    return (
      <div className={`tr-root ${cls}`}>
        <div className={`tr-scene tr-voice-${spec.voice ?? 'arrival'}`}>
          {painted && (
            <>
              <CoverImage
                candidates={[
                  ...(spec.images ?? []),
                  spec.image ?? '/art/ui/loading-voyage.png',
                ]}
              />
              <div className="tr-scene-vig" />
              <div className="tr-scene-twinkles">
                {Array.from({ length: 14 }, (_, i) => (
                  <span key={i} className="tr-twinkle" style={{
                    left: `${(i * 71 + 13) % 100}%`, top: `${(i * 37 + 9) % 72}%`,
                    animationDelay: `${(i * 0.37) % 2.4}s`,
                  }} />
                ))}
              </div>
            </>
          )}
          <div className="tr-scene-text">
            <div className="tr-scene-entering">{spec.kicker ?? DEFAULT_KICKER}</div>
            {/* One class styles the plaque for whichever skin is on, and the nine-slice sets its
              * inset. */}
            {/* The name of the place, with nothing under it. */}
            <div className="tr-scene-band kit-surface-band" style={band.style}>
              <h1 className="tr-scene-title">{title}</h1>
            </div>
            <div className="tr-scene-meter">
              <Gauge
                value={st.progress}
                label={`Loading ${title}`}
                reading={st.progress === null ? undefined : `${Math.round(st.progress * 100)}%`}
              />
              <p className="tr-scene-work">{WORK_WORD[st.work]}</p>
            </div>
            {/* The fact shown while the cover is up. In year one, this is the only place the player
              * sees the nineteen facts about the school. */}
            {spec.fact !== false && <p className="tr-scene-fact">{st.fact}</p>}
          </div>
        </div>
      </div>
    )
  }
  if (spec.kind === 'chart') {
    const painted = true
    return (
      <div className={`tr-root ${cls}`}>
        <div className="tr-chart-field" />
        <div className="tr-chart">
          {painted && (
            <>
              <img className="pix tr-chart-img" src="/art/ui/chart-cover.png" alt="" draggable={false} />
              <div className="tr-chart-needle" style={{ transform: `translate(-50%, -100%) rotate(${needle}deg)` }} />
            </>
          )}
          {spec.fact !== false && <p className="tr-chart-fact">{st.fact}</p>}
        </div>
      </div>
    )
  }
  return <div className={`tr-root ${cls}`}><div className="tr-fade" /></div>
}
