// Cleans up names the player types. The intro's identity cards and the settings screen both use
// this file, so the rules are the same in both places.

const BLOCKLIST = ['fuck', 'shit', 'ass', 'bitch', 'dick', 'cunt', 'fag', 'nigg', 'rape', 'sex', 'porn']

/** The pronoun options shown at sign-up and in settings, kept in one place. */
export const PRONOUN_CHOICES = ['he/him', 'she/her', 'they/them', 'ask me'] as const

/**
 * Removes characters that aren't allowed and cuts the name to a max length. Deck names stop at 14
 * and ship names pass max=18.
 */
export const cleanName = (v: string, max = 14) => v.replace(/[^a-zA-Z0-9 '&-]/g, '').slice(0, max)

/** True if the text contains a blocked word. It only looks at letters and ignores case. */
export const isBlocked = (v: string) => {
  const l = v.toLowerCase().replace(/[^a-z]/g, '')
  return BLOCKLIST.some((b) => l.includes(b))
}
