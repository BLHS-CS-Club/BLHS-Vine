// Pure logic shared by the api handlers. Nothing in here touches files, the network or the
// database.

import { randomBytes, randomUUID } from 'node:crypto'

// Join codes are 6 characters long. The look-alike characters 0, O, 1, I and L are left out so
// nobody misreads a code. Don't change how codes are made.
export const GLYPHS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const newCode = () => {
  const bytes = randomBytes(6)
  return Array.from(bytes, (b) => GLYPHS[b % GLYPHS.length]).join('')
}
// Participant ids and teacher keys are the whole login, so they have to be impossible to guess.
// Always use crypto randomness here, never Math.random.
export const newId = (p: string) => p + '_' + randomUUID().replace(/-/g, '').slice(0, 20)

/**
 * Cleans up a handle on the server. It allows the same characters the client does and cuts it to 14
 * characters. An empty handle becomes 'Panther'.
 */
export const cleanHandle = (handle: string) =>
  handle.replace(/[^a-zA-Z0-9 '&-]/g, '').slice(0, 14) || 'Panther'
