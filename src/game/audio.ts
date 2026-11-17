/* The game's sound library. It holds the named effects, unlocks audio on the first click or key,
 * and uses only CC0 files. */
import { NotBuilt } from '../vine/intents'

/** One entry in the library: the file, its license, and where it came from. */
export type Sfx = {
  /**
   * The filename under `public/sfx/`. It's null for a name that's been picked but has no sound file
   * yet, and that name throws an error the same way an unknown name does, so it never fails
   * silently.
   */
  file: string | null
  /** A license id in SPDX style. CC0-1.0 is the only one this library accepts. */
  license: string
  /** The page the sound pack was downloaded from, so someone can find it again. */
  source: string
  author: string
  /** How loud this effect plays compared to the others. */
  gain?: number
}

/* The twelve named effects and the files behind them. */
export const SFX: Record<string, Sfx> = {
  /* The four sounds the UI kit uses for every panel, choice and refusal. */
  click: { file: 'click.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.45 },
  open: { file: 'open.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.6 },
  close: { file: 'close.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.6 },
  deny: { file: 'deny.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.55 },

  /* The paper sounds: a Handbook page turning, a mark on the chart, an award landing. */
  page: { file: 'page.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/rpg-audio', author: 'Kenney Vleugels', gain: 0.7 },
  mark: { file: 'mark.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.6 },
  chime: { file: 'chime.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.6 },

  /* The five sounds the intro uses. They're spelled with underscores like the rest of the engine. */
  surf_in: { file: 'surf-in.ogg', license: 'CC0-1.0', source: 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx', author: 'rubberduck', gain: 0.85 },
  cork_pop: { file: 'cork-pop.mp3', license: 'CC0-1.0', source: 'https://opengameart.org/content/a-slide-pop-sound', author: 'EZduzziteh', gain: 0.8 },
  sail_snap: { file: 'sail-snap.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/rpg-audio', author: 'Kenney Vleugels', gain: 0.75 },
  bottle: { file: 'bottle.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/interface-sounds', author: 'Kenney', gain: 0.6 },
  board: { file: 'board.ogg', license: 'CC0-1.0', source: 'https://kenney.nl/assets/rpg-audio', author: 'Kenney Vleugels', gain: 0.7 },
}

/**
 * All the sound names in one sorted array, so an error message lists them in the same order every
 * time.
 */
export const SFX_NAMES: string[] = Object.keys(SFX).sort()

/**
 * The files live in `public/`, which Vite serves from the root. So this is a URL, not a path on
 * disk.
 */
const SFX_DIR = '/sfx/'

/* The volume the whole library plays at. */
const MASTER = 0.7

/* How long a sound asked for before the unlock is still worth playing, and how many get held at
 * most. */
const QUEUE_FRESH_MS = 1000
const QUEUE_MAX = 4

/* ---- state. It lives at module level because there is one audio output ---- */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let unlocked = false
let listening = false
/**
 * Sounds that are decoded and ready. Each file gets one buffer, and that buffer can play many times
 * at once.
 */
const buffers = new Map<string, AudioBuffer>()
/**
 * Files that are loading right now, so ten clicks in the first second only fetch once. A promise
 * that resolved to `null` means the file failed, and it isn't tried again until the page reloads,
 * so a broken URL doesn't get fetched on every click.
 */
const loading = new Map<string, Promise<AudioBuffer | null>>()
/** Sounds asked for before the unlock. QUEUE_FRESH_MS says how long they stay worth playing. */
const queue: { name: string; gain: number; at: number }[] = []

/* ---- the mute. The settings sheet owns it ---------------------------------- */

/* Reads the Sound toggle from the saved settings so there's only one place the flag lives. */
/* Sound is off by default. Only an explicit mute: false turns it on. */
const SETTINGS_KEY = 'blhs_settings_v1'
let lastSettingsRaw: string | null = null
let lastMute = true

function isMuted(): boolean {
  if (typeof localStorage === 'undefined') return true
  let raw: string | null = null
  try { raw = localStorage.getItem(SETTINGS_KEY) } catch { return lastMute }
  if (raw === lastSettingsRaw) return lastMute
  lastSettingsRaw = raw
  try { lastMute = (JSON.parse(raw ?? '{}') as { mute?: boolean }).mute !== false }
  catch { lastMute = true }
  return lastMute
}

/**
 * Turns sound off or on from code, and saves it where the settings sheet reads it. That way the
 * code and the toggle can't disagree.
 */
export function setMuted(b: boolean): void {
  lastMute = b
  if (typeof localStorage === 'undefined') return
  try {
    const cur = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, unknown>
    const next = JSON.stringify({ ...cur, mute: b })
    localStorage.setItem(SETTINGS_KEY, next)
    lastSettingsRaw = next
  } catch { /* Locked or full storage shouldn't break a click. */ }
}

/* Reduced motion is a camera setting, so nothing in this file reads it. */

/* ---- the unlock ------------------------------------------------------------ */

/* Creates the audio context and starts it on the student's first click, key press or touch. */
function armUnlock(): void {
  if (listening || unlocked || typeof window === 'undefined') return
  listening = true
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, onGesture, { capture: true, passive: true })
  }
}

function disarmUnlock(): void {
  if (!listening || typeof window === 'undefined') return
  listening = false
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.removeEventListener(ev, onGesture, { capture: true })
  }
}

function onGesture(): void {
  const c = context()
  if (!c) {
    /* This machine has no Web Audio at all. Stop listening and empty the queue, because those
     * sounds could never play. */
    disarmUnlock()
    queue.length = 0
    return
  }
  /* `resume` returns a promise, and the flush waits for it. A sound started while the context is
   * still suspended never plays. */
  void c.resume().then(() => {
    unlocked = true
    disarmUnlock()
    flush()
  }).catch(() => { disarmUnlock() })
}

/** Whether the browser has let the page play sound yet. */
export function isUnlocked(): boolean { return unlocked }

/**
 * How many sounds asked for before the unlock are being held. Without this there's no way to tell a
 * queued sound from one that got dropped.
 */
export function pending(): number { return queue.length }

function flush(): void {
  const now = Date.now()
  const due = queue.splice(0, queue.length).filter((q) => now - q.at < QUEUE_FRESH_MS)
  for (const q of due) fire(q.name, q.gain)
}

/* ---- the context ----------------------------------------------------------- */

function context(): AudioContext | null {
  if (ctx) return ctx
  /* happy-dom, old Safari and a locked-down district laptop all end up here. They all get the same
   * result: no sound, no crash and nothing in the console. */
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== 'undefined' ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = MASTER
    master.connect(ctx.destination)
    /* The context can start out already running if the page was clicked before. Then there's
     * nothing to wait for. */
    if (ctx.state === 'running') { unlocked = true; disarmUnlock() }
    return ctx
  } catch { return null }
}

/* ---- looking up a name. A wrong name throws here --------------------------- */

/* Hyphens and underscores count as the same thing in a name. Any other difference is an error. */
function resolve(name: string): { key: string; entry: Sfx & { file: string } } {
  const key = SFX[name] ? name : name.replace(/-/g, '_')
  const entry = SFX[key]
  if (!entry)
    throw new NotBuilt('sound', `"${name}" is not in the sound library. It has: ${SFX_NAMES.join(', ')}`)
  if (!entry.file)
    throw new NotBuilt('sound', `"${key}" is a reserved name with no file behind it yet. The ones that can play: ${SFX_NAMES.filter((n) => SFX[n].file).join(', ')}`)
  return { key, entry: entry as Sfx & { file: string } }
}

/* ---- loading, decoding, playing -------------------------------------------- */

/* Decode each file once, then play it through a new source every time. */
function load(file: string): Promise<AudioBuffer | null> {
  const had = loading.get(file)
  if (had) return had
  const p = (async (): Promise<AudioBuffer | null> => {
    const c = context()
    if (!c) return null
    try {
      const res = await fetch(SFX_DIR + file)
      if (!res.ok) throw new Error(`${res.status}`)
      const bytes = await res.arrayBuffer()
      const buf = await c.decodeAudioData(bytes)
      buffers.set(file, buf)
      return buf
    } catch (e) {
      /* A network problem isn't the island author's fault, so it doesn't throw at them. The null
       * result is cached above, so a file missing from the deployed build costs one failed request
       * instead of one per click. */
      console.warn(`[audio] ${file} did not load, that effect stays silent:`, e)
      return null
    }
  })()
  loading.set(file, p)
  return p
}

function fire(name: string, gain: number): void {
  const entry = SFX[name]
  if (!entry?.file) return
  const c = context()
  if (!c || !master) return
  const buf = buffers.get(entry.file)
  if (!buf) {
    /* The first time this file is asked for, fetch it, decode it, then play it once it arrives.
     * That delay is why `preload` exists, for sounds a scene knows it's about to need. */
    void load(entry.file).then((b) => { if (b) start(b, gain) })
    return
  }
  start(buf, gain)
}

function start(buf: AudioBuffer, gain: number): void {
  const c = ctx
  if (!c || !master) return
  try {
    const src = c.createBufferSource()
    src.buffer = buf
    const g = c.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(master)
    /* Disconnect everything when the sound ends. Otherwise a long session leaves one node per click
     * attached to the master volume. */
    src.onended = () => { try { src.disconnect(); g.disconnect() } catch { /* Already disconnected. */ } }
    src.start(0)
  } catch (e) {
    console.warn('[audio] a source refused to start:', e)
  }
}

/* ---- what the rest of the game calls --------------------------------------- */

/* Whether the kit's own panels and buttons make any sound. */
export const UI_SOUND = false

/** Plays one of the UI kit's own effects, for a panel, a control or a refusal. */
export function playUi(name: string, gain?: number): void {
  /* Check the name first, the same way `play` does. A name that isn't in the library is a mistake
   * even when the sound wouldn't play. */
  resolve(name)
  if (!UI_SOUND) return
  play(name, gain)
}

/** Plays a named effect once, right now. gain is multiplied by the entry's own level. */
export function play(name: string, gain?: number): void {
  /* Check the name before anything else, even before mute. Otherwise a typo only shows up for
   * students who have sound on. */
  const { key, entry } = resolve(name)
  if (isMuted()) return
  const level = (entry.gain ?? 1) * (gain ?? 1)
  if (!unlocked) {
    armUnlock()
    context()      // Create it now so the file can decode while waiting.
    if (!unlocked) {
      /* Drop the oldest sound to make room. The one that matters is the one just asked for. */
      if (queue.length >= QUEUE_MAX) queue.shift()
      queue.push({ name: key, gain: level, at: Date.now() })
      void load(entry.file)
      return
    }
  }
  fire(key, level)
}

/** Fetches and decodes a set of effects before they're needed. */
export async function preload(names: string[]): Promise<void> {
  /* Check the names first so a typo throws. Then skip the download if the student has sound muted. */
  const files = names.map((n) => resolve(n).entry.file)
  if (isMuted()) return
  armUnlock()
  await Promise.all(files.map((f) => load(f)))
}

/* Start listening when the file loads, before anything plays. The unlock has to catch the very
 * first click, or the first sound the player expects to hear won't play. */
armUnlock()
