/* Decides which scene a page load opens on, and makes sure a pasted address can't put someone back
 * in the middle of a run. */

/* The address holds the map and the arrival anchor. `pmap/route.ts` writes them with `replaceState`
 * at every door and `PmapScene` reads them back on mount. Only the tab that got there follows them,
 * so a pasted link in a fresh window opens the title. Nothing here touches the save. */

/** The key for this tab's claim that it's the one playing the run. It goes away when the tab closes. */
export const TAB_KEY = 'blhs_tab_v1'

/** How long that claim lasts. After 30 minutes, the page opens on the title instead. */
export const TAB_MS = 30 * 60 * 1000

/** The params that say where in a run someone is, as opposed to how the game looks. */
export const PLAY_PARAMS = ['scene', 'map', 'at', 'aboard'] as const

/* Scenes that hold a position in a run, so their address isn't safe to share. `beach`, `teacher`,
 * `grape` and `title` are places, so opening one in a fresh window opens that place. */
export const PLAY_SCENES = new Set(['pmap'])

/** The way around the rule, for a test harness or for someone debugging a map by hand. */
export const DEEP_PARAM = 'deep'

/** Mark this tab as the one playing the run. It's cheap and runs on every scene change. */
export function markTabLive(now = Date.now()): void {
  try { sessionStorage.setItem(TAB_KEY, String(now)) } catch { /* A private window with storage off still plays. */ }
}

/** Whether this tab was in the game recently enough for its address to count. */
export function tabIsLive(now = Date.now()): boolean {
  try {
    const t = Number(sessionStorage.getItem(TAB_KEY))
    return Number.isFinite(t) && t > 0 && now - t >= 0 && now - t < TAB_MS
  } catch { return false }
}

export type Opening = {
  /** The scene id to mount. */
  scene: string
  /** The query the address should have from now on, without the leading `?`. */
  search: string
  /** A one-sentence reason, or null when the address was used as written. */
  why: string | null
}

/** Remove only the position from a query and keep every other setting. */
function withoutPosition(p: URLSearchParams): string {
  const q = new URLSearchParams(p)
  for (const k of PLAY_PARAMS) q.delete(k)
  q.delete(DEEP_PARAM)
  return q.toString()
}

/**
 * Works out what a page load opens on. `known` asks the scene registry, so an id that isn't
 * registered lands on boot. `live` is `tabIsLive()` passed in, which keeps this function pure so
 * the tests don't need storage.
 */
export function openingScene(opts: {
  search: string
  known: (id: string) => boolean
  live: boolean
}): Opening {
  const p = new URLSearchParams(opts.search)
  const want = p.get('scene')

  /* No scene asked for, or one that isn't registered, so open on boot. */
  if (!want || !opts.known(want)) return { scene: 'boot', search: p.toString(), why: null }

  /* This scene is a place and holds no position, so open it directly. */
  if (!PLAY_SCENES.has(want)) return { scene: want, search: p.toString(), why: null }

  /* `?deep=1` on the address skips the rule, for a test harness or for debugging a map by hand from
   * a cold start. */
  if (p.get(DEEP_PARAM) === '1') return { scene: want, search: p.toString(), why: null }

  /* The main rule: a position only counts in the tab that got there. */
  if (opts.live) return { scene: want, search: p.toString(), why: null }

  return {
    scene: 'boot',
    search: withoutPosition(p),
    why: 'this address carries a position in a run and this tab has not been having one, '
      + 'so it opens on the title instead. Nothing saved is lost.',
  }
}


/* Two tabs share one save and each one writes the whole thing, so the older copy can land on top of
 * the newer one. */

const PLAYING_KEY = 'blhs_playing_v1'
const TAB_ID_KEY = 'blhs_tabid_v1'

/** How often a playing tab renews its claim. */
export const CLAIM_BEAT_MS = 3000

/** How long a claim lasts without being renewed. That's three missed renewals. */
export const CLAIM_STALE_MS = 10_000

type Claim = { id: string; at: number }

/** This tab's own id, made once and kept for as long as the tab is open. */
export function tabId(): string {
  try {
    const had = sessionStorage.getItem(TAB_ID_KEY)
    if (had) return had
    /* This isn't a security token. It only has to be different from the other tabs open on this
     * computer right now, so the time plus a random number is plenty. */
    const made = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
    sessionStorage.setItem(TAB_ID_KEY, made)
    return made
  } catch { return 't0' }
}

function readClaim(): Claim | null {
  try {
    const raw = localStorage.getItem(PLAYING_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as Claim
    return c && typeof c.id === 'string' && typeof c.at === 'number' ? c : null
  } catch { return null }
}

/** Mark this tab as the one playing, and renew the claim. */
export function claimPlaying(now = Date.now()): void {
  try { localStorage.setItem(PLAYING_KEY, JSON.stringify({ id: tabId(), at: now })) } catch { /* Storage is off. */ }
}

/** Give up the claim. A tab does this when it leaves the world for the title. */
export function releasePlaying(): void {
  try {
    const c = readClaim()
    if (c && c.id === tabId()) localStorage.removeItem(PLAYING_KEY)
  } catch { /* Storage is off. */ }
}

/* Whether another tab holds a claim that is still fresh. */
export function otherTabPlaying(now = Date.now()): boolean {
  const c = readClaim()
  return !!c && c.id !== tabId() && now - c.at >= 0 && now - c.at < CLAIM_STALE_MS
}

/** Scenes that count as playing the run, so they hold the claim. */
export const PLAYING_SCENES = new Set(['pmap', 'beach', 'grape'])
