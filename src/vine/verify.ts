// Makes the short code printed on what the student turns in. The client and the server work it out
// the same way.

export type Transcript = {
  participantId: string
  handle: string
  gpa: number | null
  cords: string[]          // The cord ids they earned, sorted.
  ranks: Record<string, number>
  islandsCompleted: number
  /* How many places the player saw and how many programmes they finished. Neither one goes into the
   * verification code, because that code's fields are frozen. */
  placesSeen: number
  programmesCompleted: number
  factsLearned: number
  years: number
}

/**
 * The exact string the code is made from. Its field order is frozen, so don't reorder the fields
 * and don't add any.
 */
export function canonical(t: Transcript): string {
  return [
    t.participantId,
    t.gpa === null ? '-' : t.gpa.toFixed(2),
    [...t.cords].sort().join(','),
    Object.keys(t.ranks).sort().map((k) => `${k}:${t.ranks[k]}`).join(','),
    t.islandsCompleted,
    t.factsLearned,
    t.years,
  ].join('|')
}

/**
 * Hashes the string with 64-bit FNV-1a and turns it into a 10 character base-32 code, split in two
 * so it's easy to read aloud (ABCDE-FGHIJ).
 */
export function runCode(t: Transcript): string {
  const s = canonical(t)
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * prime) & 0xffffffffffffffffn
  }
  const GLYPHS = 'ABCDEFGHJKMNPQRSTUVWXYZ2345679'
  let out = ''
  let v = h
  for (let i = 0; i < 10; i++) {
    out += GLYPHS[Number(v % BigInt(GLYPHS.length))]
    v /= BigInt(GLYPHS.length)
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`
}
