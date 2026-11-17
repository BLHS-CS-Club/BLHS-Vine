// Tests for reading anchors. MAPVIS writes the anchors and the game reads them, so both sides have
// to agree on the format.
import { describe, it, expect } from 'vitest'
import { AnchorSet, readAnchors, anchorName, isAnchorName } from './anchors'

describe('reading what MAPVIS actually exports', () => {
  // Copied exactly from MAPVIS-next/work/hub/map.json.
  const hub = {
    anchors: [{
      name: 'panthers_maw', kind: 'door', x: 343, y: 378, r: 14,
      to: 'panther-maw', label: "Panther's Maw", meta: { docId: 2, derived: true },
    }],
    events: [{ id: 2, type: 'door', x: 343, y: 378, r: 14, label: "Panther's Maw", to: 'panther-maw' }],
  }

  it('prefers anchors over the legacy events array', () => {
    const a = readAnchors(hub, 'hub')
    expect(a).toHaveLength(1)
    expect(a[0].name).toBe('panthers_maw')
    expect(a[0].kind).toBe('door')
    expect(a[0].to).toBe('panther-maw')
  })

  it('the hub door points at the maw map id', () => {
    // If this fails, either the hub door moved or the Maw was published under a different id. Fix
    // that before painting anything.
    expect(readAnchors(hub, 'hub')[0].to).toBe('panther-maw')
  })

  it('falls back to events for a bundle exported before anchors existed', () => {
    const a = readAnchors({ events: hub.events }, 'old')
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('door')
    // Nobody typed a name, so one is made from the label and marked as derived.
    expect(a[0].name).toBe('panthers_maw')
    expect(a[0].meta?.derived).toBe(true)
  })

  it('a bundle with neither field loads as a map with no anchors, not an error', () => {
    expect(readAnchors({}, 'bare')).toEqual([])
  })
})

describe('a hand-edited or future bundle cannot black-screen a map', () => {
  it('skips a kind this build does not know and keeps the rest', () => {
    const a = readAnchors({
      anchors: [
        { name: 'ok_one', kind: 'post', x: 1, y: 1, r: 4, label: 'a' },
        { name: 'from_2027', kind: 'hologram', x: 2, y: 2, r: 4, label: 'b' },
      ],
    })
    expect(a.map((x) => x.name)).toEqual(['ok_one'])
  })

  it('skips an anchor with no position rather than putting it at the origin', () => {
    const a = readAnchors({ anchors: [{ name: 'nowhere', kind: 'point', label: 'x' }] })
    expect(a).toEqual([])
  })

  it('keeps the first of a duplicated name, because a name must resolve to one thing', () => {
    const a = readAnchors({
      anchors: [
        { name: 'hearth', kind: 'post', x: 10, y: 10, r: 4, label: 'first' },
        { name: 'hearth', kind: 'post', x: 90, y: 90, r: 4, label: 'second' },
      ],
    })
    expect(a).toHaveLength(1)
    expect(a[0].label).toBe('first')
  })

  it('re-derives a name that is not a legal python identifier', () => {
    const a = readAnchors({ anchors: [{ name: 'Chart Table!', kind: 'post', x: 1, y: 1, r: 4, label: 'The Chart Table' }] })
    expect(a[0].name).toBe('the_chart_table')
    expect(a[0].meta?.derived).toBe(true)
  })
})

describe('anchorName matches MAPVIS letter for letter', () => {
  it.each([
    ["Panther's Maw", 'panthers_maw'],
    ['The Chart Table', 'the_chart_table'],
    ['  spaced  out  ', 'spaced_out'],
    ['3rd bridge', 'a3rd_bridge'],
    ['', 'anchor'],
  ])('%s becomes %s', (input, want) => {
    expect(anchorName(input)).toBe(want)
  })

  it('rejects what MAPVIS would reject', () => {
    expect(isAnchorName('chart_table')).toBe(true)
    expect(isAnchorName('Chart_Table')).toBe(false)
    expect(isAnchorName('3rd')).toBe(false)
    expect(isAnchorName('has space')).toBe(false)
    expect(isAnchorName('a'.repeat(49))).toBe(false)
  })
})

describe('AnchorSet: the questions a scene asks every frame', () => {
  const set = new AnchorSet('panther-maw', readAnchors({
    anchors: [
      { name: 'maw_entrance', kind: 'door', x: 256, y: 470, r: 20, to: 'hub', toAnchor: 'panthers_maw', label: 'Back to the harbour' },
      { name: 'chart_table', kind: 'post', x: 180, y: 300, r: 30, label: 'The chart table', facing: 'south' },
      { name: 'hearth', kind: 'post', x: 320, y: 300, r: 30, label: 'The Advisory Hearth' },
      { name: 'trophy_wall', kind: 'point', x: 250, y: 220, r: 24, label: 'The trophy wall' },
      { name: 'the_hall', kind: 'region', x: 250, y: 300, r: 5, rect: [100, 200, 400, 470], label: 'hall' },
      { name: 'first_step', kind: 'trigger', x: 256, y: 450, r: 40, label: '' },
      { name: 'arrive_here', kind: 'spawn', x: 256, y: 460, r: 8, label: '' },
    ],
  }))

  it('resolves by name', () => {
    expect(set.has('chart_table')).toBe(true)
    expect(set.has('chart_tabel')).toBe(false)
    expect(set.get('chart_table')?.label).toBe('The chart table')
  })

  it('a region uses the rectangle its author drew, not a circle around the middle', () => {
    const region = set.get('the_hall')!
    expect(set.contains(region, 390, 390)).toBe(true)   // Inside the rect, far outside r=5.
    expect(set.contains(region, 410, 300)).toBe(false)
  })

  it('regions and triggers never steal the interact prompt from a post', () => {
    // Standing on the hearth also means standing inside the_hall.
    const near = set.nearestInteractive(320, 300)
    expect(near?.name).toBe('hearth')
  })

  it('two posts 140px apart with r=30 leave a dead gap, which is the spacing law', () => {
    expect(set.nearestInteractive(200, 300)?.name).toBe('chart_table')
    expect(set.nearestInteractive(300, 300)?.name).toBe('hearth')
    // Halfway between them no ring reaches, and that's correct. A ring is how far away the player
    // can be and still be at the station, so it limits how many stations fit on one platform.
    expect(set.nearestInteractive(250, 300)).toBeNull()
  })

  it('when rings DO overlap the nearer station wins, so neither is unreachable', () => {
    // Two posts placed closer than their radii still work. The prompt switches over as the player
    // crosses the middle.
    const tight = new AnchorSet('tight', readAnchors({
      anchors: [
        { name: 'left', kind: 'post', x: 100, y: 100, r: 40, label: 'l' },
        { name: 'right', kind: 'post', x: 150, y: 100, r: 40, label: 'r' },
      ],
    }))
    expect(tight.nearestInteractive(110, 100)?.name).toBe('left')
    expect(tight.nearestInteractive(140, 100)?.name).toBe('right')
  })

  it('offers nothing when the feet are outside every ring', () => {
    expect(set.nearestInteractive(10, 10)).toBeNull()
  })

  it('reports every region and trigger underfoot, not just the nearest', () => {
    const names = set.regionsAt(256, 450).map((a) => a.name).sort()
    expect(names).toEqual(['first_step', 'the_hall'])
  })

  it('arrives at the named anchor a door pointed at', () => {
    expect(set.arrival('chart_table', [1, 1])).toEqual({ x: 180, y: 300, facing: 'south' })
  })

  it('falls back to a spawn anchor before the map-level spawn, and never to the origin', () => {
    expect(set.arrival(undefined, [1, 1])).toEqual({ x: 256, y: 460, facing: undefined })
    expect(set.arrival('does_not_exist', [1, 1])).toEqual({ x: 256, y: 460, facing: undefined })
  })

  it('uses the map-level spawn when there is no spawn anchor at all', () => {
    const bare = new AnchorSet('x', readAnchors({ anchors: [{ name: 'p', kind: 'point', x: 5, y: 5, r: 2, label: '' }] }))
    expect(bare.arrival(undefined, [77, 88])).toEqual({ x: 77, y: 88 })
  })
})

/* An anchor can name a painted placement. That's how show() finds the thing to hide. */
describe('an anchor bound to a placement', () => {
  const bound = () =>
    new AnchorSet('maw', readAnchors({
      anchors: [
        { name: 'counselor', kind: 'post', x: 100, y: 100, r: 20, label: 'the counselor', placement: 'nurse' },
        { name: 'hearth', kind: 'post', x: 300, y: 100, r: 20, label: 'the hearth' },
      ],
    }))

  it('carries the binding through the parse', () => {
    expect(bound().get('counselor')?.placement).toBe('nurse')
    expect(bound().get('hearth')?.placement).toBeUndefined()
  })

  it('sits where the bundle put it until somebody says otherwise', () => {
    // No placements are loaded yet, like a bundle whose art hasn't finished loading.
    expect(bound().spotOf(bound().get('counselor')!)).toEqual({ x: 100, y: 100 })
  })

  it('follows the thing it is bound to once the scene can answer', () => {
    // Seventeen of the hub's people wander. The exported x,y is only where the sprite starts, and
    // its real position changes over time.
    const set = bound()
    set.follow((ref) => (ref === 'nurse' ? { x: 140, y: 155 } : null))
    expect(set.spotOf(set.get('counselor')!)).toEqual({ x: 140, y: 155 })
    // An anchor with no placement doesn't move, and neither does one whose placement is gone.
    expect(set.spotOf(set.get('hearth')!)).toEqual({ x: 300, y: 100 })
  })

  it('takes its prompt ring, its arrival and its reach with it', () => {
    const set = bound()
    set.follow((ref) => (ref === 'nurse' ? { x: 140, y: 155 } : null))
    // The ring moved, so the old center is out of reach and the new ring is in reach.
    expect(set.nearestInteractive(100, 100)).toBeNull()
    expect(set.nearestInteractive(145, 158)?.name).toBe('counselor')
    expect(set.arrival('counselor', [1, 1])).toEqual({ x: 140, y: 155, facing: undefined })
  })

  it('falls back to the exported spot when the placement is not on this map', () => {
    // A binding that points at something deleted must not put the anchor at 0,0, because that's
    // inside the rock.
    const set = bound()
    set.follow(() => null)
    expect(set.spotOf(set.get('counselor')!)).toEqual({ x: 100, y: 100 })
  })
})

/* The spot a character stands on at an anchor, and which way it faces when it gets there. */
describe('where a body ends up, and which way it looks', () => {
  const set = () =>
    new AnchorSet('maw', readAnchors({
      anchors: [
        // The tabletop, with the floor beside it marked and a direction to face.
        { name: 'chart_table', kind: 'post', x: 200, y: 200, r: 20, label: 'the chart table',
          stand: [200, 214], facing: 'north' },
        // No stand spot, so the character walks to the anchor itself.
        { name: 'hearth', kind: 'post', x: 300, y: 100, r: 20, label: 'the hearth' },
      ],
    }))

  it('aims at the marked floor, not at the middle of the thing', () => {
    expect(set().standAt(set().get('chart_table')!)).toEqual({ x: 200, y: 214, facing: 'north' })
  })

  it('falls back to the anchor itself when no floor was marked', () => {
    expect(set().standAt(set().get('hearth')!)).toEqual({ x: 300, y: 100, facing: undefined })
  })

  it('a door landing on a station puts you beside it rather than on top of it', () => {
    expect(set().arrival('chart_table', [1, 1])).toEqual({ x: 200, y: 214, facing: 'north' })
  })

  it('the prompt ring still belongs to the thing, not to the floor beside it', () => {
    // 14px above the table is inside the ring. Moving the stand spot doesn't move the ring, because
    // they mean different things.
    expect(set().nearestInteractive(200, 186)?.name).toBe('chart_table')
  })

  it('a bound anchor carries its floor along by however far the thing moved', () => {
    const s = new AnchorSet('maw', readAnchors({
      anchors: [{ name: 'coach', kind: 'post', x: 100, y: 100, r: 20, label: 'coach',
        placement: 'coach_sprite', stand: [100, 112], facing: 'north' }],
    }))
    s.follow((ref) => (ref === 'coach_sprite' ? { x: 130, y: 160 } : null))
    // The coach moved 30 right and 60 down, so the spot beside the coach moved the same amount.
    expect(s.standAt(s.get('coach')!)).toEqual({ x: 130, y: 172, facing: 'north' })
  })
})

/* What a region's four rect numbers mean. */
describe('a region with an area', () => {
  const set = new AnchorSet('hall', readAnchors({
    anchors: [{ name: 'the_hall', kind: 'region', x: 300, y: 300, r: 8, label: '',
      rect: [200, 250, 400, 350] }],
  }))
  const hall = set.get('the_hall')!

  it('is the rectangle between the two corners, not a box of width 400', () => {
    expect(set.contains(hall, 399, 349)).toBe(true)
    expect(set.contains(hall, 401, 300)).toBe(false)
    // If rect were [x,y,w,h] this point would be inside, since 200+400 reaches 600.
    expect(set.contains(hall, 560, 300)).toBe(false)
  })

  it('does not care which corner was clicked first', () => {
    const flipped = new AnchorSet('hall', readAnchors({
      anchors: [{ name: 'the_hall', kind: 'region', x: 300, y: 300, r: 8, label: '',
        rect: [400, 350, 200, 250] }],
    }))
    expect(flipped.contains(flipped.get('the_hall')!, 250, 300)).toBe(true)
  })

  it('beats the radius, which is the whole point of drawing one', () => {
    // The radius is 8px, so 90px out is far outside the circle but well inside the box.
    expect(Math.hypot(390 - 300, 300 - 300)).toBeGreaterThan(hall.r)
    expect(set.contains(hall, 390, 300)).toBe(true)
  })
})

describe('a standing spot that was left behind when its post moved', () => {
  /* Real bundle data where a post moved and its standing spot stayed behind. */
  const v7 = () => readAnchors({
    yScale: 0.72,
    character: { heightPx: 20 },
    anchors: [
      { name: 'chart_table', kind: 'post', x: 288, y: 229, r: 10, stand: [295, 213], label: 'Open the year sheet' },
      { name: 'counselor', kind: 'post', x: 382, y: 196, r: 14, stand: [324, 185], label: 'The Counselor' },
      { name: 'principal_desk', kind: 'post', x: 191, y: 116, r: 14, stand: [370, 201], label: 'Principal Panther' },
      { name: 'trophy_wall', kind: 'post', x: 290, y: 203, r: 14, stand: [298, 201], label: 'The Trophy Wall' },
    ],
  }, 'panther-maw')

  it('keeps every standing spot that is really beside its post', () => {
    const a = v7()
    /* The chart table's stand spot is the farthest real one so far, a little over a body length
     * away. It has to be kept, because it's where the whole first-year film puts the player. */
    expect(a.find((x) => x.name === 'chart_table')!.stand).toEqual([295, 213])
    expect(a.find((x) => x.name === 'trophy_wall')!.stand).toEqual([298, 201])
  })

  it('drops the two that are the ghost of where the post used to be', () => {
    const a = v7()
    expect(a.find((x) => x.name === 'counselor')!.stand).toBeUndefined()
    expect(a.find((x) => x.name === 'principal_desk')!.stand).toBeUndefined()
  })

  it('so a walk to either one goes to the post, not to the other post', () => {
    const set = new AnchorSet('panther-maw', v7())
    /* The principal's leftover stand spot is about twelve pixels from the counselor. */
    expect(set.standAt(set.get('principal_desk')!)).toMatchObject({ x: 191, y: 116 })
    expect(set.standAt(set.get('counselor')!)).toMatchObject({ x: 382, y: 196 })
  })
})
