/* Checks that every directory row names something that really appears in
 * docs/blhs/sourced-facts.md. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DIRECTORY, directoryCount, type DirectoryRow } from './directory'

const SOURCE = fs.readFileSync(path.resolve('docs/blhs/sourced-facts.md'), 'utf8')

const rows = (): DirectoryRow[] => DIRECTORY.flatMap((s) => s.groups.flatMap((g) => g.rows))

/* Squash a name down to lowercase letters and numbers, with & read as "and" and the word "the"
 * dropped. That way small differences in punctuation and wording can't break a match. */
const key = (s: string) => s.toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\bthe\b/g, ' ')
  .replace(/[^a-z0-9]+/g, '')

const SRC = key(SOURCE)

describe('every row is a real Bonney Lake thing', () => {
  it('names something that appears in docs/blhs/sourced-facts.md', () => {
    const missing = rows()
      .map((r) => r.name)
      /* A name written a little differently in the source still matches after both are squashed
       * down by key(). */
      .filter((n) => !SRC.includes(key(n)))
    expect(missing).toEqual([])
  })

  it('has no Example placeholder anywhere in it', () => {
    /* A directory row is a real fact about the school, so it can never be an "Example" placeholder. */
    for (const r of rows()) {
      expect(r.name).not.toMatch(/example/i)
      expect(r.what ?? '').not.toMatch(/example/i)
    }
  })

  it('carries nothing a student could press', () => {
    /* A row only holds information. If it needs an id, a place or a programme, it should be a card
     * instead. */
    for (const r of rows()) expect(Object.keys(r).sort()).toEqual(
      Object.keys(r).filter((k) => ['name', 'what', 'meets', 'note'].includes(k)).sort(),
    )
  })
})

describe('what the page holds', () => {
  it('lists the whole club roster, all three sports seasons and the AP list', () => {
    /* These are minimums, not exact counts, so adding a new sourced row never breaks the test. */
    expect(directoryCount('clubs')).toBeGreaterThanOrEqual(30)
    expect(directoryCount('sports')).toBeGreaterThanOrEqual(22)
    expect(directoryCount('classes')).toBeGreaterThanOrEqual(22)
    expect(DIRECTORY.find((s) => s.id === 'sports')!.groups.map((g) => g.heading))
      .toEqual(['Fall', 'Winter', 'Spring'])
  })

  it('either says when a thing meets or says honestly that nobody published it', () => {
    /* A club with no time in the source shows a note saying so. Never make up a time for it. */
    for (const r of DIRECTORY.find((s) => s.id === 'clubs')!.groups.flatMap((g) => g.rows)) {
      expect(!!r.meets || !!r.note).toBe(true)
    }
  })

  it('says where every group came from', () => {
    for (const s of DIRECTORY) for (const g of s.groups) expect(g.from).toMatch(/sourced-facts\.md/)
  })
})
