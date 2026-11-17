// The maps the core engine owns itself, and which folder of Python each one runs. No programme is
// behind these.

export type VineIsland = {
  /** The map id. This table is looked up by it. */
  map: string
  /** The folder under `public/grapes/`. It's served from the game's own site. */
  folder: string
  /**
   * One line saying what it is. It's only for people reading this file, and the game never shows
   * it.
   */
  what: string
}

export const VINE_ISLANDS: VineIsland[] = [
  {
    map: 'panther-maw',
    folder: 'panther-maw',
    what: "the home base: the founding event, the planner, the fire, the cords, the wardrobe, the wall",
  },
  {
    map: 'hub',
    folder: 'the-hub',
    what: "the central island: the ship sails herself in, and three people on the way up from the dock",
  },
]

const byMap = new Map(VINE_ISLANDS.map((i) => [i.map, i]))

/** The engine's own island for a map, if it has one. */
export const vineIslandOfMap = (mapId: string | undefined): VineIsland | undefined =>
  mapId ? byMap.get(mapId) : undefined
