/* The words used for placeholder islands: their names and what they say about themselves. */

/** The one line a placeholder shows about itself, everywhere it appears. */
export const EXAMPLE_BLURB = 'An island a member has not built yet.'

/**
 * The source line for a placeholder. Every roster entry has a source field, and this is what a
 * placeholder puts there.
 */
export const EXAMPLE_SOURCE = 'a placeholder: no island stands behind this yet'

/** The quiet label for a class that has no island yet. */
export const NO_ISLAND_YET = 'no island yet'

/** Turns 0, 1, 2 into Example A, Example B, Example C. After Z it goes on to AA. */
export function exampleLabel(n: number): string {
  let out = ''
  let i = n
  do { out = String.fromCharCode(65 + (i % 26)) + out; i = Math.floor(i / 26) - 1 } while (i >= 0)
  return `Example ${out}`
}

/**
 * The name for a place the player can't sail to yet. It uses the word "place" so a place never has
 * the same name as a card.
 */
export const examplePlace = (n: number): string => `Example place ${exampleLabel(n).slice(8)}`
