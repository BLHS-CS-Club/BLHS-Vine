/* Works out where the player reappears when a run resumes, and when a saved position is thrown away
 * for the map's own spawn point. */
import type { RunPosition, SaveGame } from '../save'
import type { WorldComposition, WorldSlot } from '../world/composition'
import { slotOfMap } from '../world/composition'
import type { VesselRecord } from '../world/sail'

/** What's loaded right now. Every check compares the save against this. */
export type WorldStamp = {
  map: string
  /**
   * The published version the map bundle came from. It's missing for a map loaded from a local
   * folder.
   */
  mapVersion?: number
  /** The version of the world composition document. */
  worldVersion?: number
}

export type ResumeTarget =
  /** The whole position can be trusted, so put the player back exactly where they were. */
  | { kind: 'exact'; map: string; x: number; y: number; anchor?: string; why: string }
  /** The x and y were thrown out but the anchor name is still good. Try that anchor, then the spawn. */
  | { kind: 'anchor'; map: string; anchor: string; why: string }
  /** Nothing in the position can be used, so go to the map's own spawn. */
  | { kind: 'spawn'; map: string; why: string }

/* Why a resume didn't use the saved spot, in words. These are for the console, not for the player. */
export const RESUME_REASONS = {
  fresh: 'no position on the save yet',
  otherMap: 'the saved position is on a different map',
  mapVersion: 'the map was republished since this position was written',
  worldVersion: 'the world composition changed since this position was written',
  noPixels: 'the position carried no pixels, only a name',
  trusted: 'same map, same version, same composition',
} as const

/** Where the player reappears, given what the save holds and what's loaded. */
export function resumeTarget(where: RunPosition | undefined, now: WorldStamp): ResumeTarget {
  const nameOrSpawn = (why: string): ResumeTarget =>
    where?.anchor
      ? { kind: 'anchor', map: now.map, anchor: where.anchor, why }
      : { kind: 'spawn', map: now.map, why }

  if (!where) return { kind: 'spawn', map: now.map, why: RESUME_REASONS.fresh }
  if (where.map !== now.map) return { kind: 'spawn', map: now.map, why: RESUME_REASONS.otherMap }

  /* The versions have to match exactly. A missing version doesn't count as a match. */
  if (where.mapVersion !== now.mapVersion) return nameOrSpawn(RESUME_REASONS.mapVersion)
  if (where.worldVersion !== now.worldVersion) return nameOrSpawn(RESUME_REASONS.worldVersion)
  if (where.x === undefined || where.y === undefined) return nameOrSpawn(RESUME_REASONS.noPixels)

  return {
    kind: 'exact', map: now.map, x: where.x, y: where.y,
    ...(where.anchor ? { anchor: where.anchor } : {}),
    why: RESUME_REASONS.trusted,
  }
}

/** The same check, given a whole save, since that's what a scene usually has. */
export const resumeFor = (s: SaveGame | null, now: WorldStamp): ResumeTarget =>
  resumeTarget(s?.where, now)

/* ---- the ship: it reappears at a berth, or at the home slot ---- */
export type Mooring =
  | { kind: 'berth'; slot: WorldSlot; why: string }
  | { kind: 'home'; slot?: WorldSlot; why: string }

export function mooringFor(v: VesselRecord | undefined, c: WorldComposition): Mooring {
  const home = c.home
    ? c.slots.find((s) => (s.place ?? s.map) === c.home!.slot)
    : undefined
  if (!v?.berthedAt) return { kind: 'home', slot: home, why: 'no vessel record: the run has not sailed' }
  const slot = c.slots.find((s) => (s.place ?? s.map) === v.berthedAt) ?? slotOfMap(c, v.berthedAt)
  /* If the berth's slot no longer exists, fall back to the home slot, the same way a changed map
   * falls back to its spawn. */
  if (!slot?.berth) return { kind: 'home', slot: home, why: `berth "${v.berthedAt}" is not on this composition` }
  return { kind: 'berth', slot, why: 'moored where she was left' }
}

/* The record a scene saves. It's kept next to the code that reads it so the two shapes can't get
 * out of sync. */
export const stampOf = (now: WorldStamp, anchor?: string, x?: number, y?: number): Omit<RunPosition, 'at'> => ({
  map: now.map,
  ...(now.mapVersion !== undefined ? { mapVersion: now.mapVersion } : {}),
  ...(now.worldVersion !== undefined ? { worldVersion: now.worldVersion } : {}),
  ...(anchor ? { anchor } : {}),
  ...(x !== undefined ? { x } : {}),
  ...(y !== undefined ? { y } : {}),
})
