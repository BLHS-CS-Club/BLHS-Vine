/* The islands club members have finished. Each one is a row of data in member-islands.json instead
 * of being written as code. */
import type { Season } from '../save'
import data from './member-islands.json'

export type MemberIsland = {
  /** The programme id from the roster. This is the name `award(programme=...)` uses. */
  programme: string
  /**
   * The map the island is played on. Map ids are a separate set of names, so this is never the same
   * string as the programme id.
   */
  map: string
  /** The folder in blhs-islands. The island's package is served from a folder with the same name. */
  folder: string
  name: string
  place: string
  kind: 'sport' | 'club'
  season?: Season
  tags: string[]
  rankTrack?: string
  /** Whether the island's loop can really run right now. This belongs to the programme. */
  playable: boolean
  blurb: string
  host?: string
  /** Where the blurb and the host came from. It must always be filled in and never made up. */
  source: string
}

/* The file gets checked instead of trusted, because members edit it in pull requests. A bad row
 * should name itself here instead of turning into a blank spot in the planner. */
export type IslandFault = { row: string; why: string }

const RAW = data as { format: number; islands: unknown[] }

export function islandFaults(rows: unknown[] = RAW.islands): IslandFault[] {
  const out: IslandFault[] = []
  const seen = new Map<string, string>()
  rows.forEach((row, i) => {
    const r = row as Partial<MemberIsland>
    const where = r.programme ?? r.folder ?? `row ${i + 1}`
    const need = (k: keyof MemberIsland) => {
      if (typeof r[k] !== 'string' || !(r[k] as string).trim()) {
        out.push({ row: where, why: `\`${k}\` is missing` })
      }
    }
    for (const k of ['programme', 'map', 'folder', 'name', 'place', 'blurb', 'source'] as const) need(k)
    if (r.kind !== 'sport' && r.kind !== 'club') out.push({ row: where, why: '`kind` is sport or club' })
    if (typeof r.playable !== 'boolean') out.push({ row: where, why: '`playable` is true or false' })
    if (!Array.isArray(r.tags)) out.push({ row: where, why: '`tags` is a list, empty if none' })
    /* A programme id and a map id can never be the same string, here or in the manifest or in the
     * roster's own checks. If they matched, there'd be no way to tell which one an id means. */
    for (const k of ['programme', 'map'] as const) {
      const v = r[k]
      if (typeof v !== 'string') continue
      const owner = seen.get(v)
      if (owner) out.push({ row: where, why: `${k} "${v}" is already claimed by ${owner}` })
      else seen.set(v, `${where}'s ${k}`)
    }
  })
  return out
}

/* Drop any bad row so it can't turn into an undefined in the planner, and print a warning naming
 * it. */
const bad = new Set(islandFaults().map((f) => f.row))
for (const f of islandFaults()) {
  console.warn(`[member-islands] ${f.row}: ${f.why}`)
}

export const MEMBER_ISLANDS: MemberIsland[] = (RAW.islands as MemberIsland[])
  .filter((r) => !bad.has(r.programme ?? r.folder))

const byMap = new Map(MEMBER_ISLANDS.map((i) => [i.map, i]))

/** The island that a map belongs to. This is how a map finds its Python. */
export const islandOfMap = (mapId: string | undefined): MemberIsland | undefined =>
  mapId ? byMap.get(mapId) : undefined
