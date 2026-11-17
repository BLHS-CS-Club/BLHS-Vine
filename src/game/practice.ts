/* whether this tab is a practice link: an island fetched from somewhere other than this game, played without touching the visitor's real run */

/** the address param that remembers which map a practice island was opened on, once a door has changed `map` */
export const PRACTICE_MAP_PARAM = 'grape_map'

/** a page is a practice link when the island it names comes from an origin other than the page's own: `grape` on a map, or `from` and `gh` on the island bench at ?scene=grape */
export function isPracticeLink(search: string, origin: string): boolean {
  const p = new URLSearchParams(search)
  /* a github ref is always fetched from raw.githubusercontent.com, so it is somebody else's island whatever it names */
  if (p.get('gh')) return true
  return fromElsewhere(p.get('grape'), origin) || fromElsewhere(p.get('from'), origin)
}

function fromElsewhere(base: string | null, origin: string): boolean {
  if (!base) return false
  try {
    return new URL(base, origin).origin !== origin
  } catch {
    /* an address that cannot be read is no island at all, so there is nothing to practise on */
    return false
  }
}

/** the map a practice island belongs to, or null when the address names none */
export function practiceMapOf(search: string): string | null {
  const p = new URLSearchParams(search)
  return p.get(PRACTICE_MAP_PARAM) || p.get('map') || null
}

/* read once when the page loads, so a door rewriting the address can never switch practice off halfway through */
const here = typeof window !== 'undefined' && window.location ? window.location : null

/** true for the whole life of a tab that was opened from a practice link */
export const PRACTICE: boolean = here ? isPracticeLink(here.search, here.origin) : false

/** the map a practice link names, or null when it names none or this is not a practice tab, which route.ts reads as the default map */
export const PRACTICE_MAP: string | null = PRACTICE && here ? practiceMapOf(here.search) : null
