// Tells a real offering apart from a placeholder. Something is real when there's a playable island
// behind it.
import { programmeById } from './roster'
import { EXAMPLE_BLURB, NO_ISLAND_YET, exampleLabel } from './example'

/* The words live in example.ts, which imports nothing, so the roster can use them to hide its own
 * entries without a circular import. */
export { EXAMPLE_BLURB, NO_ISLAND_YET, exampleLabel }

/** True when there's a playable island behind this programme id. */
export const programmeIsReal = (id: string): boolean => programmeById(id)?.playable === true

/**
 * True when there's a playable island behind this class id. It checks the same table as
 * programmeIsReal.
 */
export const classIsReal = (id: string): boolean => programmeIsReal(id)

// The Example letters come from the roster, which already assigned them. They aren't counted again
// here.

/** The placeholder name for an id, or null when a real island is behind it. */
export const exampleNameOf = (id: string): string | null => {
  const p = programmeById(id)
  return p && !p.playable ? p.name : null
}

/** The name to show for an id: the placeholder name if there is one, otherwise the real name. */
export const shownName = (id: string, real: string): string => exampleNameOf(id) ?? real
