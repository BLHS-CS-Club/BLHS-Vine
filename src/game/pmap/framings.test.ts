/* Tests that a camera shot is read from the map itself. A script's own zoom number is only used
 * when the map has none. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { framingOf, framingNames, shotOf, projectFramings, shotsOf } from './framings'

const DESK = {
  framing: { zoom: 1.5, dy: -14, name: 'default' },
  framings: { close: { zoom: 1.9, dy: -18 }, wide: { zoom: 1.05, dy: 0 } },
}

describe('a framing on an anchor', () => {
  it('reads the default shot off the meta bag that already survives export', () => {
    expect(framingOf(DESK)).toEqual({ zoom: 1.5, dx: 0, dy: -14, name: 'default' })
  })

  it('reads a named one, and keeps the name it was asked for', () => {
    expect(framingOf(DESK, 'close')).toEqual({ zoom: 1.9, dx: 0, dy: -18, name: 'close' })
  })

  /* A name the map doesn't have falls back to the anchor's default shot instead of nothing. Half a
   * shot looks worse than the map maker's wide one. Warning the caller is `PmapScene`'s job. */
  it('falls back to the anchor own default when the name is not there', () => {
    expect(framingOf(DESK, 'nope')?.name).toBe('default')
  })

  it('answers nothing at all for an anchor nobody framed', () => {
    expect(framingOf(undefined)).toBeNull()
    expect(framingOf({ why: 'a note somebody left' })).toBeNull()
  })

  /* An empty bag isn't a framing. Otherwise it would replace a script's zoom with undefined and
   * pull the shot back to the map's load scale. */
  it('refuses a framing that says nothing', () => {
    expect(framingOf({ framing: {} })).toBeNull()
    expect(framingOf({ framing: { name: 'empty' } })).toBeNull()
  })

  it('lists what an anchor really carries, for a refusal that can name them', () => {
    expect(framingNames(DESK)).toEqual(['(default)', 'close', 'wide'])
    expect(framingNames(undefined)).toEqual([])
  })

  it('applies the offset, which is the thing look_at could never express', () => {
    expect(shotOf({ x: 196, y: 322 }, framingOf(DESK, 'close'))).toEqual({ x: 196, y: 304, zoom: 1.9 })
    /* With no framing the shot is the anchor itself, at the caller's fallback zoom. */
    expect(shotOf({ x: 10, y: 20 }, null, 1.35)).toEqual({ x: 10, y: 20, zoom: 1.35 })
  })
})

/* The older format for shots: a flat list at the top level of the bundle. The reader still accepts
 * it. */
const HUB_SHOTS = [{ name: 'the_maw_mouth', anchor: 'panthers_maw', dx: 0, dy: 0, zoom: 1, entry: true }]

/**
 * The hub's door, copied exactly from version 13 of the hub bundle. It's made fresh each time
 * because folding writes into it.
 */
const mawDoor = (meta: Record<string, unknown> = { docId: 2, derived: true }) =>
  ({ name: 'panthers_maw', x: 343, y: 378, meta })

let warns: string[] = []
const listen = () => {
  warns = []
  vi.spyOn(console, 'warn').mockImplementation((...a) => { warns.push(a.map(String).join(' ')) })
}
afterEach(() => { vi.restoreAllMocks() })

describe('folding the live hub top-level shots onto its anchors', () => {
  it('lands the one shot the platform is serving today on the door it belongs to', () => {
    const door = mawDoor()
    expect(projectFramings([door], HUB_SHOTS, 'hub')).toBe(1)
    /* Zoom is a multiple of the opening view, so 1 is a real setting and not an empty shot. */
    expect(framingOf(door.meta, 'the_maw_mouth')).toEqual({ zoom: 1, dx: 0, dy: 0, name: 'the_maw_mouth' })
  })

  it('makes an entry shot the unnamed default that look_at reads', () => {
    const door = mawDoor()
    projectFramings([door], HUB_SHOTS, 'hub')
    expect(framingOf(door.meta)?.name).toBe('the_maw_mouth')
    expect(shotOf({ x: 343, y: 378 }, framingOf(door.meta))).toEqual({ x: 343, y: 378, zoom: 1 })
  })

  it('leaves an unnamed default that is already authored alone', () => {
    /* The anchor's own default shot wins over an entry flag in the flat list. */
    const door = mawDoor({ framing: { zoom: 2.2, dy: -30 } })
    projectFramings([door], HUB_SHOTS, 'hub')
    expect(framingOf(door.meta)?.zoom).toBe(2.2)
  })

  /* A bundle with both formats is halfway through converting. The meta bag is what MAPVIS writes
   * now and the list is the older format. If this goes the wrong way, a map maker's edit gets
   * undone. */
  it('lets the meta bag win over the projection, name for name', () => {
    const door = mawDoor({ docId: 2, framings: { the_maw_mouth: { zoom: 1.9, dy: -18 } } })
    expect(projectFramings([door], HUB_SHOTS, 'hub')).toBe(0)
    expect(framingOf(door.meta, 'the_maw_mouth')?.zoom).toBe(1.9)
  })

  it('opens on the shot that won, and not on the copy the projection lost with', () => {
    /* Otherwise the map would open at zoom 1 while `the_maw_mouth` gives 1.9. That's one name with
     * two different numbers. */
    const door = mawDoor({ docId: 2, framings: { the_maw_mouth: { zoom: 1.9, dy: -18 } } })
    projectFramings([door], HUB_SHOTS, 'hub')
    expect(framingOf(door.meta)?.zoom).toBe(1.9)
  })

  it('drops a shot hung off an anchor this map does not have, and names both', () => {
    listen()
    const door = mawDoor()
    const orphans = [{ name: 'the_stage', anchor: 'the_podium', dx: 0, dy: -40, zoom: 1.4 }]
    expect(projectFramings([door], orphans, 'hub')).toBe(0)
    /* A shot can outlive its anchor being renamed or deleted. Without this warning, it would only
     * show up as a close-up that never happens. */
    expect(warns.join()).toContain('the_stage')
    expect(warns.join()).toContain('the_podium')
    expect(warns.join()).toContain('hub')
  })

  it('never lets a shot that says nothing reach an anchor', () => {
    const door = mawDoor()
    const flat = [{ name: 'says_nothing', anchor: 'panthers_maw', dx: 0, dy: 0 }]
    expect(projectFramings([door], flat, 'hub')).toBe(0)
    /* It doesn't even create an empty framings bag, so an anchor with no shots still has no shots. */
    expect(framingNames(door.meta)).toEqual([])
  })

  it('costs a loop and nothing else on a bundle that carries no list', () => {
    const door = mawDoor()
    expect(projectFramings([door], undefined, 'hub')).toBe(0)
    expect(projectFramings([door], [], 'hub')).toBe(0)
    expect(door.meta).toEqual({ docId: 2, derived: true })
  })
})

describe('every named shot on a map, indexed by the name a person typed', () => {
  const anchorsOf = () => [
    { name: 'chart_table', x: 180, y: 300, meta: { framings: { the_chart: { zoom: 1.6, dy: -10 } } } },
    { name: 'hearth', x: 320, y: 300, meta: { framings: { the_fire: { zoom: 2, dy: -4 } } } },
  ]

  it('finds a shot without being told which anchor carries it', () => {
    /* A scene asks for the shot by name, like the maw mouth, and doesn't need to know which anchor
     * has it. */
    const shots = shotsOf(anchorsOf())
    expect([...shots.keys()].sort()).toEqual(['the_chart', 'the_fire'])
    expect(shots.get('the_fire')?.anchor.name).toBe('hearth')
    expect(shots.get('the_fire')?.framing.zoom).toBe(2)
  })

  it('hands back the caller own anchor record and not the two fields this file needs', () => {
    const anchors = anchorsOf()
    /* A shot is worked out from the anchor's x, so the index has to hand back the whole anchor.
     * Otherwise every caller would need a cast to get it. */
    expect(shotsOf(anchors).get('the_chart')?.anchor).toBe(anchors[0])
    expect(shotsOf(anchors).get('the_chart')?.anchor.x).toBe(180)
  })

  it('keeps the first of a collision and says which two anchors argued', () => {
    listen()
    const shots = shotsOf([
      { name: 'chart_table', x: 1, y: 1, meta: { framings: { the_shot: { zoom: 1.6 } } } },
      { name: 'hearth', x: 2, y: 2, meta: { framings: { the_shot: { zoom: 9 } } } },
    ])
    expect(shots.get('the_shot')?.anchor.name).toBe('chart_table')
    expect(warns.join()).toContain('chart_table')
    expect(warns.join()).toContain('hearth')
  })

  it('never indexes a framing that says nothing, and does not let one hold the name', () => {
    const shots = shotsOf([
      { name: 'ghost_post', x: 1, y: 1, meta: { framings: { the_shot: {} } } },
      { name: 'hearth', x: 2, y: 2, meta: { framings: { the_shot: { zoom: 1.4 } } } },
    ])
    /* An empty bag isn't a shot, so it can't take the name either. The real shot on the next anchor
     * is the one the scene wants. */
    expect(shots.get('the_shot')?.anchor.name).toBe('hearth')
    expect(shots.size).toBe(1)
  })

  it('skips an anchor with no bag and one whose bag is not a set', () => {
    const shots = shotsOf([
      { name: 'plain', x: 1, y: 1 },
      { name: 'odd', x: 2, y: 2, meta: { framings: 'soon' } },
      { name: 'hearth', x: 3, y: 3, meta: { framings: { the_fire: { zoom: 2 } } } },
    ])
    expect([...shots.keys()]).toEqual(['the_fire'])
  })

  it('finds the live hub shot after the fold, which is the whole round trip', () => {
    const door = mawDoor()
    projectFramings([door], HUB_SHOTS, 'hub')
    const shot = shotsOf([door]).get('the_maw_mouth')
    expect(shot?.anchor.name).toBe('panthers_maw')
    expect(shotOf({ x: shot!.anchor.x, y: shot!.anchor.y }, shot!.framing)).toEqual({ x: 343, y: 378, zoom: 1 })
  })
})
