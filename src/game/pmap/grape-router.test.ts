/* Tests for who owns an anchor, and what the player sees when standing at it. */
import { describe, it, expect } from 'vitest'
import { labelFor, ownerOf } from './grape-router'

describe('who answers to an anchor', () => {
  it('gives it to the island that claims it', () => {
    expect(ownerOf('coach', ['talk:coach'])).toEqual({ handler: 'talk:coach' })
  })

  it('answers nobody when no island claims it', () => {
    /* Only an island can own an anchor, so a name with no handler goes nowhere. */
    expect(ownerOf('chart_table', [])).toBeNull()
  })

  it('answers nobody for an anchor nobody claims', () => {
    expect(ownerOf('a_name_nobody_wrote', ['talk:coach'])).toBeNull()
  })

  it('does not match a handler that is not a talk handler', () => {
    /* The engine calls `start` when the island loads, and it isn't an anchor. An island with only
     * on_start owns no anchors. */
    expect(ownerOf('start', ['start'])).toBeNull()
  })

  it('matches the anchor name exactly, prefix and all', () => {
    expect(ownerOf('coach', ['talk:coach_two'])).toBeNull()
    expect(ownerOf('coach_two', ['talk:coach'])).toBeNull()
  })
})

describe('what the player reads', () => {
  it('reads the label the map carries', () => {
    /* The label the map maker typed is what the player sees. */
    expect(labelFor('The Counselor', 'counselor')).toBe('The Counselor')
  })

  it('falls back to the anchor name when the map left the label blank', () => {
    /* Club members often name the handler after the anchor and never write a label. Then the
     * anchor's name is shown, not something built from the handler key. */
    expect(labelFor('', 'coach')).toBe('coach')
    expect(labelFor(undefined, 'coach')).toBe('coach')
  })
})
