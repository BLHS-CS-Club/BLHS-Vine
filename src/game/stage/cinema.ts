// One flag that means the player is watching, not playing: black bars go up and the controls go
// away. There's also a time limit, after which the bars come down by themselves.
export const MOVIE_CEILING_MS = 600_000

/* The bars remember who put them up, and the engine only takes down bars it put up itself. A
 * member's island should never have to lower bars it didn't ask for. The hub's arrival keeps the
 * bars up through the door. */
export type CinemaBy = 'voyage' | 'island' | 'cutscene' | 'scene'

let on = false
let by: CinemaBy | null = null
let ceiling: ReturnType<typeof setTimeout> | null = null
const subs = new Set<(v: boolean) => void>()

export const cinemaOn = () => on
/** Who the bars belong to right now, or null when they're down. */
export const cinemaBy = (): CinemaBy | null => by

/* The stylesheets read this attribute. It's set here instead of in a component, so a scene that
 * raises the bars before React has drawn anything still hides the corner controls on the very first
 * frame. */
function mark(v: boolean) {
  if (typeof document === 'undefined') return
  if (v) document.documentElement.dataset.movie = '1'
  else delete document.documentElement.dataset.movie
}

// A one-time flag that lets the bars stay up through a door instead of coming down at it.
let carry = false

/** The player is going through a door, and the bars should stay up on the other side. */
export function carryCinemaThroughDoor() { carry = cinemaOn() }

/** The cleanup code calls this to ask if this unmount is that door. Reading it also clears it. */
export function takeCinemaCarry(): boolean {
  const was = carry
  carry = false
  return was
}

export function setCinema(v: boolean, who: CinemaBy = 'scene') {
  /* If the bars are already up, still update who owns them. Without this, the early return below
   * would ignore the island's claim, and the engine could take the bars down in the middle of the
   * island's own scene. */
  if (on && v) { by = who; return }
  if (on === v) return
  on = v
  by = v ? who : null
  mark(v)
  if (ceiling) { clearTimeout(ceiling); ceiling = null }
  if (v) {
    ceiling = setTimeout(() => {
      console.error(`[cinema] the bars have been up for ${MOVIE_CEILING_MS / 1000}s, raised by `
        + `"${by ?? 'nobody'}", and nothing has taken them down, so they are coming down. `
        + 'Look for a word that refused between a movie(True) and its movie(False).')
      setCinema(false)
    }, MOVIE_CEILING_MS)
  }
  for (const s of [...subs]) {
    try { s(v) } catch (e) { console.error('[cinema] a listener threw', e) }
  }
}

/**
 * Subscribe, and get the current value right away so a component that mounts late isn't out of
 * date.
 */
export function onCinema(f: (v: boolean) => void): () => void {
  subs.add(f)
  f(on)
  return () => { subs.delete(f) }
}
