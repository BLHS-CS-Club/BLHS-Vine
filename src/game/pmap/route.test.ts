import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MAP, HOME_TARGET, PMAP_SCENE, SEA_ARRIVAL, searchFor, targetFromUrl,
} from './route'
import { HUB_MAP, MAW_MAP } from '../run/objective'

/* the painted world's address in the url, written by two scenes and read by one */

const q = (s: string) => new URLSearchParams(s)

describe('the pmap address', () => {
  it('reads a bare url as the default map with nothing else asked for', () => {
    expect(targetFromUrl('')).toEqual({ map: DEFAULT_MAP, at: undefined, aboard: false })
  })

  it('reads a map, an arrival anchor and an at-sea arrival', () => {
    expect(targetFromUrl('?scene=pmap&map=hub&at=quay&aboard=1'))
      .toEqual({ map: 'hub', at: 'quay', aboard: true })
  })

  it('round-trips every target through the query', () => {
    for (const t of [
      { map: 'hub' },
      { map: 'hub', aboard: true },
      { map: MAW_MAP, at: 'arrive_maw' },
      { map: 'x', at: 'y', aboard: true },
    ]) {
      const back = targetFromUrl(`?${searchFor(t, '')}`)
      expect(back.map).toBe(t.map)
      expect(back.at).toBe(t.at)
      expect(back.aboard).toBe(!!t.aboard)
    }
  })

  /* a new target deletes the parts of the address it does not carry */
  it('deletes an anchor the new target does not carry', () => {
    expect(q(searchFor({ map: 'hub' }, '?scene=pmap&map=hub&at=quay')).has('at')).toBe(false)
  })

  it('deletes aboard when the new target is not at sea', () => {
    expect(q(searchFor({ map: 'hub' }, '?scene=pmap&map=hub&aboard=1')).has('aboard')).toBe(false)
  })

  it('keeps every other parameter, so dbg, src, kit and a member gh ref survive a door', () => {
    const s = q(searchFor({ map: 'b' }, '?scene=pmap&map=a&dbg=1&src=local&kit=1&gh=o/r@main:i/x'))
    expect(s.get('map')).toBe('b')
    expect(s.get('dbg')).toBe('1')
    expect(s.get('src')).toBe('local')
    expect(s.get('kit')).toBe('1')
    expect(s.get('gh')).toBe('o/r@main:i/x')
  })

  it('always names the pmap scene, so a refresh does not land on boot', () => {
    expect(q(searchFor({ map: 'hub' }, '')).get('scene')).toBe(PMAP_SCENE)
  })
})

/* a practice island only stands in on its own map, and a door to any other map finds that map's island */
describe('a practice link and the doors', () => {
  const RAW = 'https://raw.githubusercontent.com/BLHS-CS-Club/BLHS-Island-Explorer/main/examples/03-remember/'
  const link = (grape: string, rest = 'scene=pmap&map=atc-1') => `?${rest}&grape=${encodeURIComponent(grape)}`
  const was = window.location.href
  afterEach(() => { window.history.replaceState(null, '', was) })

  /* the practice answer is read off the address when the module loads, so each case loads it again */
  const loadRoute = async (search: string) => {
    window.history.replaceState(null, '', `/${search}`)
    vi.resetModules()
    return await import('./route')
  }

  it('plays the island on the map its link opened and on no other', async () => {
    const r = await loadRoute(link(RAW))
    expect(r.grapePlaysOn('atc-1')).toBe(true)
    expect(r.grapePlaysOn('hub')).toBe(false)
    expect(r.grapePlaysOn('panther-maw')).toBe(false)
  })

  it('falls back to the default map when the link names none, the way the address does', async () => {
    const r = await loadRoute(`?scene=pmap&grape=${encodeURIComponent(RAW)}`)
    expect(r.grapePlaysOn(r.DEFAULT_MAP)).toBe(true)
    expect(r.grapePlaysOn('atc-1')).toBe(false)
  })

  it('writes the island\'s map into the address at a door, so a reload still knows it', async () => {
    const r = await loadRoute(link(RAW))
    r.setMapUrl({ map: 'hub' })
    const p = q(window.location.search)
    expect(p.get('map')).toBe('hub')
    expect(p.get('grape')).toBe(RAW)
    expect(p.get('grape_map')).toBe('atc-1')
    /* and the reload reads it back */
    vi.resetModules()
    const again = await import('./route')
    expect(again.grapePlaysOn('hub')).toBe(false)
    expect(again.grapePlaysOn('atc-1')).toBe(true)
  })

  it('leaves a same origin grape on every map, as it always was', async () => {
    const r = await loadRoute(link('/grapes/atc/'))
    expect(r.grapePlaysOn('atc-1')).toBe(true)
    expect(r.grapePlaysOn('hub')).toBe(true)
    r.setMapUrl({ map: 'hub' })
    const p = q(window.location.search)
    expect(p.get('grape')).toBe('/grapes/atc/')
    expect(p.has('grape_map')).toBe(false)
  })

  it('leaves an address with no grape exactly as searchFor spells it', async () => {
    const r = await loadRoute('?scene=pmap&map=atc-1&dbg=1')
    /* the answer is worked out from the address before the door, so the door's own write cannot be what it is compared with */
    const want = r.searchFor({ map: 'hub', at: 'quay' })
    r.setMapUrl({ map: 'hub', at: 'quay' })
    expect(window.location.search).toBe(`?${want}`)
    expect(window.location.search).toBe('?scene=pmap&map=hub&dbg=1&at=quay')
  })
})

describe('the road', () => {
  /* where continue and the title send a student, asserted rather than described */
  it('sends Set Sail to the hub, on the water', () => {
    expect(SEA_ARRIVAL.map).toBe(HUB_MAP)
    expect(SEA_ARRIVAL.aboard).toBe(true)
    expect(SEA_ARRIVAL.at).toBeUndefined()
  })

  it('sends Continue to the Maw, at the bridge', () => {
    expect(HOME_TARGET.map).toBe(MAW_MAP)
    expect(HOME_TARGET.at).toBe('arrive_maw')
    expect(HOME_TARGET.aboard).toBeFalsy()
  })

  /* the stand-in bundle carries the anchor continue aims at, since it is the folder a student really opens */
  it('names an anchor the committed panther-maw bundle actually has', async () => {
    const maw = await import('../../../public/maps-painted/panther-maw/map.json')
    const names = (maw.default.anchors as { name: string }[]).map((a) => a.name)
    expect(names).toContain(HOME_TARGET.at)
  })
})
