/* Every reason the game can say no to a pick, written as a sentence and kept in one place so every
 * screen says the same thing. */
import type { SaveGame, Season } from '../save'
import { programmeById, programmeAllowedIn, seasonOf } from '../roster/roster'
import { classById } from '../planner/catalog'

/** Why a season token can't go on this programme, or null if it can. */
export function refuseSlot(
  programmeId: string, season: Season, s: SaveGame | null, year: number,
): string | null {
  const plan = s?.plans?.[year]
  if (plan?.stamped) return 'Your year sheet is stamped. Year ' + year + ' cannot be changed.'

  const g = programmeById(programmeId)
  /* Refuse a slot that points at nothing instead of saving it. */
  if (!g) return `Nothing on the roster is called "${programmeId}".`

  if (!programmeAllowedIn(g, season)) {
    const real = seasonOf(g)
    /* A sport's season comes from the school itself, so the sentence names the real season. */
    return `${g.name} is a ${String(real).toLowerCase()} sport. It does not run in ${season.toLowerCase()}.`
  }

  /* One programme per year. Two tokens on the same programme would count one year of a rank twice,
   * and the completion record is one row per programme per year, so the second token would buy a
   * row that's already there. */
  const taken = Object.entries(plan?.slots ?? {})
    .find(([se, id]) => se !== season && id === programmeId)
  if (taken) return `You already picked ${g.name} for ${taken[0].toLowerCase()}. Pick something else.`

  if (!plan?.slots?.[season] && s && !s.tokens.includes(season))
    return `You already used your ${season.toLowerCase()} pick this year.`

  return null
}

/** Why this class can't go on the year sheet, or null if it can. */
export function refuseClass(classId: string, s: SaveGame | null, year: number): string | null {
  const plan = s?.plans?.[year]
  if (plan?.stamped) return 'Your year sheet is stamped. Year ' + year + ' cannot be changed.'
  const c = classById(classId)
  if (!c) return `Nothing in the catalog is called "${classId}".`
  if (plan?.classes.includes(classId)) return `${c.name} is already picked for this year.`
  /* The limit of two classes is a real rule of the game, so say it out loud instead of quietly
   * hiding the pick button. */
  if ((plan?.classes.length ?? 0) >= 2)
    return 'Two focus classes a year. Remove one before you add another.'
  if (!c.years.includes(year)) return `${c.name} is not open to you in year ${year}.`
  /* Prerequisites aren't checked here, because that needs every year's picks. */
  return null
}
