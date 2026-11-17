/* The reduced motion setting, as a value the renderer can read. The CSS reads the same setting from
 * an attribute on <html>. */

let cached: boolean | null = null
const listeners = new Set<(on: boolean) => void>()

/* What the player picked in settings. It stays null until they pick, and the OS setting is used
 * until then. */
let asked: boolean | null = null

const osReduce = (): boolean => {
  /* The OS setting counts too. A student who already turned on less motion in Chrome OS shouldn't
   * have to do it again in the game, and the district's Chromebook setup is where that setting most
   * often comes from. */
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }
  catch { return false }
}

const attrOn = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.dataset.rm === '1'

const read = (): boolean => {
  if (typeof document === 'undefined') return false
  return asked ?? (attrOn() || osReduce())
}

/** What the OS says, so a settings sheet can use it as its starting value. */
export const systemPrefersReducedMotion = (): boolean => osReduce()

/** The current value. It's cached, so it's cheap enough to call every frame. */
export function prefersReducedMotion(): boolean {
  if (cached === null) cached = read()
  return cached
}

/* Writes the value onto <html> as data-rm, so the stylesheets see exactly the same value as the
 * renderer. */
const publish = () => {
  if (typeof document === 'undefined') return
  const want = read() ? '1' : ''
  if (document.documentElement.dataset.rm !== want) document.documentElement.dataset.rm = want
}

/** Called by the settings sheet when the player flips the toggle. */
export function setReducedMotion(on: boolean): void {
  asked = on
  publish()
  push()
}

const push = () => {
  const now = read()
  if (now === cached) return
  cached = now
  for (const fn of listeners) fn(now)
}

/**
 * A renderer in the middle of an animation can subscribe, so it can cut a movement short as soon as
 * the player turns motion down.
 */
export function onReducedMotion(fn: (on: boolean) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

if (typeof document !== 'undefined') {
  /* Watch the attribute too, so code that writes it directly is noticed here. */
  new MutationObserver(() => { publish(); push() })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-rm'] })
  try { window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener('change', () => { publish(); push() }) }
  catch { /* Older browsers: watching the attribute still works. */ }
  /* Push the OS setting to the stylesheets right away, before anyone opens settings. Otherwise the
   * first cutscene plays with full motion for a student who already asked for less. */
  publish()
}

/* What reduced motion means for anything that draws: shorter moves and no swinging back and forth. */

/**
 * How long a camera move should take, given how long it would normally take. Reduced motion caps it
 * at 120ms.
 */
export const motionMs = (ms: number): number => (prefersReducedMotion() ? Math.min(ms, 120) : ms)

/** How far a decorative back and forth movement should swing. Reduced motion makes it 0. */
export const motionAmp = (amp: number): number => (prefersReducedMotion() ? 0 : amp)
