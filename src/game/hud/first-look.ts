/* The one line each corner plaque shows the first time a student opens it. */
import { loadSave, setFlag } from '../save'

/* Each plaque shows one sentence the first time it's opened. The year sheet is the exception,
 * because the tour teaches it. */
export type Plaque = 'my-year' | 'guide' | 'map' | 'sheet'

const FLAG: Record<Plaque, string> = {
  'my-year': 'told:my-year',
  guide: 'told:guide',
  map: 'told:map',
  sheet: 'told:sheet',
}

/* Say plainly what the thing is, with no metaphors, and keep it to one short line. */
const LINE: Record<Plaque, string> = {
  'my-year': 'This is your schedule.',
  guide: 'Every club and class at Bonney Lake.',
  map: 'Where you sail.',
  /* The sheet gets a spotlight tour instead (`hud/Tour.tsx`), so it has no line here. */
  sheet: '',
}

/**
 * The line for a plaque the student hasn't opened before. Once it's been seen, this returns null.
 * With no save it also returns null.
 */
export function firstLook(which: Plaque): string | null {
  const s = loadSave()
  if (!s) return null
  return s.flags.includes(FLAG[which]) ? null : (LINE[which] || ' ')
}

/* Reading the line and marking it seen are separate calls. If firstLook() marked it, a re-render
 * would make the line disappear while the student is reading it. */
export function markLooked(which: Plaque) {
  const s = loadSave()
  if (!s || s.flags.includes(FLAG[which])) return
  setFlag(FLAG[which])
}
