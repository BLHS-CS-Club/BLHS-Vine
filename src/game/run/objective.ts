/* Works out the one thing the player should do next, as a place on a map the arrow can point at. */
import type { SaveGame } from '../save'
import { roleByConvention, type Role } from './roles'
import { sessionOver, yearStatus, yearWord } from './year'
import { picksOf } from './pick'

export type Objective = {
  /* What the target place is for. The room turns the role into whichever anchor has it. null means
   * there's no place to point at, so no arrow is drawn. */
  role: Role | null
  /* The map that anchor is on, so the arrow can tell the player it's somewhere else. */
  map: string
  /* `say` is the step as shown on the objective's own map. `away` is the same step as shown from
   * any other map. */
  say: string
  away: string
  /* Which part of the year this belongs to. It's used for logging and the debug overlay. */
  phase: 'founding' | 'vignette' | 'plan' | 'core' | 'class' | 'voyage' | 'rising' | 'yearbook' | 'done'
}

export const MAW_MAP = 'panther-maw'
export const HUB_MAP = 'hub'

/* The flag that says the founding event has played. It's named here so the cutscene, the station
 * and the save all use the same string. It follows the same `thing:detail` shape save.ts uses for
 * `vignette:y1`. */
export const FOUNDING_FLAG = 'maw:founding'

/* Picks the sentence that fits where the player is standing, on the objective's map or somewhere
 * else. */
export function objectiveLine(o: Objective | null, mapId: string | null | undefined): string {
  if (!o) return ''
  /* If the map the player is on is unknown, treat it as somewhere else. */
  return mapId === o.map ? o.say : o.away
}

/* The steps of the year in order. Read them top to bottom and the first one that matches wins. */
export function nextObjective(s: SaveGame | null): Objective | null {
  if (!s || !s.introDone) return null
  if (s.graduated) return null

  /* A finished year has no objective. The only thing left is the closing film, which has its own
   * controls and leads to the title screen, so a bar would point at nothing. */
  if (sessionOver(s)) return null

  /* The founding event happens once per run, before anything else in the year. */
  if (!s.flags.includes(FOUNDING_FLAG)) {
    return {
      role: 'principal', map: MAW_MAP, phase: 'founding',
      say: 'Talk to Principal Panther.',
      away: 'Go into the mountain.',
    }
  }

  const y = yearStatus(s)

  /* The year's opening vignette. The HUD shows it on its own whenever nothing else is happening, so
   * this step only keeps the objective from pointing somewhere else until it's seen. */
  if (!y.vignetteSeen) {
    return {
      /* No anchor here, because the HUD shows the vignette card itself and the principal has no
       * handler for it. Pointing at `principal_desk` would send a year two student to a "back
       * again?" line with the arrow still on the principal. */
      role: null, map: MAW_MAP, phase: 'vignette',
      say: 'Look around.',
      away: 'Go into the mountain.',
    }
  }

  if (!y.planStamped) {
    return {
      role: 'plan', map: MAW_MAP, phase: 'plan',
      say: 'Go to the table and pick your year.',
      away: 'Go into the mountain and pick your year.',
    }
  }

  if (!y.coreBeatDone) {
    return {
      role: 'advisory', map: MAW_MAP, phase: 'core',
      say: 'Go to the fire.',
      away: 'Go into the mountain. Advisory is at the fire.',
    }
  }

  /* One step covers every unfinished pick, class or club, since each is one row on the year sheet
   * with one button that finishes it. The line has to name the year sheet, because a pick is played
   * from a corner button and not from a painted classroom. */
  const owed = picksOf(s).find((p) => !p.done)
  if (owed) {
    return {
      role: 'plan', map: MAW_MAP, phase: 'class',
      say: `${owed.map ? `Sail to ${owed.name}` : `Go to ${owed.name}`}. Open My Year.`,
      away: `Go into the mountain. ${owed.name} is on your year sheet.`,
    }
  }

  /* Everything for the year is done but the yearbook page hasn't been seen yet. */
  if (y.readyForYearbook && !y.yearbookSeen) {
    /* The year's closing plays at the principal's desk, so the away line tells the player how to
     * get back in. */
    return {
      role: 'principal', map: MAW_MAP, phase: 'yearbook',
      /* The `say` line gives the reason for going, so it doesn't sound the same as the founding
       * step. Its second sentence is the first thing on screen that says the year is over. */
      /* Only the `away` line says to go back to the Maw. The path into the Maw ends at the chart
       * table right next to the principal, so a player already inside only needs the other half. */
      say: `Find the principal. Year ${yearWord(s.year)} is done.`,
      away: 'Go back to the Maw. The principal is waiting.',
    }
  }

  /* The fallback if nothing above matched. A normal year never gets here. */
  return {
    role: 'plan', map: MAW_MAP, phase: 'done',
    say: 'Nothing left this year. Look around.',
    away: 'Nothing left this year. Look around.',
  }
}

/* Checks whether this anchor on this map is where the player is being sent. `roleOf` is the room's
 * own answer, and the standard anchor names are used when the room has none. */
export function isObjective(
  s: SaveGame | null,
  mapId: string,
  anchorName: string,
  roleOf: (name: string) => Role | null = roleByConvention,
): boolean {
  const o = nextObjective(s)
  if (!o || o.map !== mapId || !o.role) return false
  return roleOf(anchorName) === o.role
}
