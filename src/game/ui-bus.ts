// Lets world code open the vine's panels without importing React or a HUD file.
import type { BeatDeclaration } from '../vine/intents'

/* yearbook: a year's own page, which any island can send a student to. */
/* wall: what the student has earned, which any island can open. */
/* 'cords' opens the Guide on its cords tab, so an island can choose that tab. The Guide is one
 * panel with six tabs. */
/* The panel names as an array, so they can be checked while the game runs. A member's island is
 * Python and never gets type checked, so its panel name arrives through the worker as a plain
 * string, and an unchecked bad name freezes the game. The array is the source and the type is built
 * from it. */
export const UI_PANELS = [
  'planner', 'handbook', 'cords', 'chart', 'settings',
  'advisory', 'wardrobe', 'yearbook', 'wall', 'tour',
] as const
export type UiRequest = typeof UI_PANELS[number]

const EVENT = 'blhs:open-ui'
const BEAT_EVENT = 'blhs:play-beat'

/* What gets sent with the event. done is called once the panel that opened has closed. */
export type UiOpen = { ui: UiRequest; done?: () => void }

/* The longest a caller can be left waiting on a panel. */
export const OPEN_CEILING_MS = 600_000

/* How many listeners there are, so requestUi can tell if anyone got the event. */
let listening = 0
export const uiListenerCount = () => listening

export function requestUi(which: UiRequest, done?: () => void): boolean {
  window.dispatchEvent(new CustomEvent<UiOpen>(EVENT, { detail: { ui: which, done } }))
  return listening > 0
}

/* Opens a panel and resolves once it's closed. Gives back false if nothing is mounted to show it. */
export function requestUiAndWait(which: UiRequest): Promise<void> | false {
  let settle: (() => void) | null = null
  const p = new Promise<void>((r) => { settle = r })
  let ceiling = 0
  const done = () => {
    if (!settle) return
    const s = settle
    settle = null
    window.clearTimeout(ceiling)
    s()
  }
  if (!requestUi(which, done)) return false
  ceiling = window.setTimeout(() => {
    console.error(`[ui-bus] "${which}" was opened ${OPEN_CEILING_MS / 1000}s ago and nothing has `
      + 'said it closed, so whoever was waiting on it is being let go.')
    done()
  }, OPEN_CEILING_MS)
  return p
}

export function onUiRequest(fn: (which: UiRequest, done?: () => void) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<UiOpen>).detail
    fn(d.ui, d.done)
  }
  window.addEventListener(EVENT, h)
  listening++
  /* Safe to call twice. React runs cleanups twice in strict mode, and if the count went negative it
   * would say nothing is listening. */
  let off = false
  return () => {
    if (off) return
    off = true
    listening--
    window.removeEventListener(EVENT, h)
  }
}

/* Asks for a scored activity and gets the grade back, or a refusal if nothing ran. */
export type BeatRequest = {
  beat: string
  /* Only there when an island brings its own activity. Without it, the beat id is looked up in the
   * engine's own table. */
  decl?: BeatDeclaration
  /** The activity ran. A number is the grade, and null means the player closed it without finishing. */
  done: (grade: number | null) => void
  /* Nothing ran at all. That's a refusal, which is different from a null grade. */
  refuse: (why: string) => void
}

export function requestBeat(beat: string, decl?: BeatDeclaration): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (g: number | null) => { if (!settled) { settled = true; resolve(g) } }
    const refuse = (why: string) => { if (!settled) { settled = true; reject(new Error(why)) } }
    const ev = new CustomEvent<BeatRequest>(BEAT_EVENT, {
      detail: { beat, done, refuse, ...(decl ? { decl } : {}) }, cancelable: true,
    })
    const heard = window.dispatchEvent(ev)
    /* dispatchEvent gives back true when no listener called preventDefault, which means nobody
     * picked it up. */
    if (heard) refuse(`nothing here can play "${beat}": this scene has no HUD mounted`)
  })
}

export function onBeatRequest(fn: (r: BeatRequest) => void): () => void {
  const h = (e: Event) => {
    e.preventDefault()          // Tells `requestBeat` above that a listener has it.
    const r = (e as CustomEvent<BeatRequest>).detail
    /* A listener that throws must still answer. `dispatchEvent` hides the error, and
     * `preventDefault` has already told `requestBeat` someone has it. Without this, the island's
     * `play()` would never return and the controls would stay locked until a reload, so an error
     * becomes a refusal. */
    try {
      fn(r)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      console.error(`[beat] building "${r.beat}" threw, so the island is being refused: ${why}`)
      r.refuse(why)
    }
  }
  window.addEventListener(BEAT_EVENT, h)
  return () => window.removeEventListener(BEAT_EVENT, h)
}
