/* Tests how a map's cover is picked. The destination's own bundle is tried first, then the
 * hand-picked table, then the art in this repo for its kind of arrival. Nothing is fetched to check
 * first, so a map with no cover yet only costs one failed image request. */
import { describe, expect, it } from 'vitest'
import { bundleCovers, ceremonyCover, coverFor, passingCover } from './covers'

describe('a cover asks the map it is going to first', () => {
  it('names the two roots a bundle is really loaded from, in that order', () => {
    /* Same order PmapScene uses: first the vendored copy the build writes, then the folder
     * committed in this repo. The paths are guessed, not fetched. */
    expect(bundleCovers('atc-1')).toEqual([
      '/maps-vendored/atc-1/cover.png',
      '/maps-painted/atc-1/cover.png',
    ])
  })

  it('asks for a named cover under the map own covers folder', () => {
    expect(bundleCovers('atc-1', 'the_stair')).toEqual([
      '/maps-vendored/atc-1/covers/the_stair.png',
      '/maps-painted/atc-1/covers/the_stair.png',
    ])
  })

  it('says nothing at all for a map with no id', () => {
    expect(bundleCovers('')).toEqual([])
  })

  it('puts the bundle candidates in front of the art committed here', () => {
    const c = coverFor('atc-1')
    expect(c.spec.images?.[0]).toBe('/maps-vendored/atc-1/cover.png')
    /* The fallback is still there. The overlay tries each of `images` and then falls back to
     * `image`, so a destination with no cover drawn never shows a blank screen. */
    expect(c.spec.image).toBeTruthy()
    expect(c.spec.image!.startsWith('/')).toBe(true)
  })

  it('keeps the hand-kept picture for a map that has one, underneath', () => {
    /* The Maw's cover is its own room painting, picked by hand. It stays as the fallback underneath
     * any bundle cover. */
    expect(coverFor('panther-maw').spec.image).toBe('/maps-painted/panther-maw/scene.png')
  })

  it('gives a map being crossed no picture, no name and no fact', () => {
    /* Passing through a map is a quick cut in the middle of one trip, so it shows nothing. Sailing
     * through a map must not bring up a transition screen. */
    const p = passingCover()
    expect(p.spec.kind).toBe('fade')
    expect(p.spec.title).toBeUndefined()
    expect(p.spec.images).toBeUndefined()
    expect(p.spec.fact).toBe(false)
    expect(p.first).toBe(false)
  })

  it('and the graduation keeps its own held title', () => {
    const c = ceremonyCover('Bonney Lake High')
    expect(c.spec.voice).toBe('ceremony')
    expect(c.spec.title).toBe('BONNEY LAKE HIGH')
    expect(c.spec.fact).toBe(false)
  })
})
