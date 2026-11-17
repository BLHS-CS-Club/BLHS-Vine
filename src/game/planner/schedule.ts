/* Decides when a year's schedule is finished, and what's still missing when it isn't. */

export type ScheduleOwed = {
  /** An elective period is still empty. */
  owesClass: boolean
  /** Nothing is picked after school, and there's a real club or sport to join. */
  owesActivity: boolean
  /** True when the button can finish the screen. */
  ready: boolean
  /* Which box is lit. The schedule comes first because the page is read top to bottom with the
   * periods at the top, and a lit box further down would pull the eye away from what's being read. */
  stage: 'schedule' | 'after' | 'go'
  /* Why the button is off. There's always a reason, because a disabled button the student can't ask
   * about is worse. */
  notYet: string | null
}

/* How many elective periods a year has. It's two, which is also the number of blank rows `PickYear`
 * draws and where `refuseClass` stops a third pick. All three have to match, or the sheet asks for
 * a row it doesn't have. */
export const ELECTIVES_OWED = 2

/* How many after-school seasons a year has, which is also how many season tokens each year starts
 * with. It's a plain number here so this file doesn't have to import the save. */
export const SEASONS_OWED = 3

export function scheduleOwed(n: {
  /** How many of this year's elective periods are still blank (0, 1 or 2). */
  electivesLeft: number
  /** How many after-school slots this year's sheet has filled. */
  chosen: number
  /** How many electives on offer have a playable island behind them. */
  realClasses: number
  /** How many clubs and sports on offer have one. */
  realActivities: number
  /* Not always three. Filling three tokens needs three different programmes the student can press,
   * and with only one island built the screen offers one. So the gate asks for every seat really on
   * offer, capped at the three the year has. */
  seats?: number
}): ScheduleOwed {
  /* Both elective periods are always required, whether or not an island exists behind one. */
  const owesClass = n.electivesLeft > 0
  /* Every seat on offer has to be filled before stamping. That's never more than the year has, and
   * at least one when anything is playable. */
  const seats = Math.max(1, Math.min(SEASONS_OWED, n.seats ?? SEASONS_OWED))
  const seasonsLeft = Math.max(0, seats - n.chosen)
  const owesActivity = n.realActivities > 0 && seasonsLeft > 0
  const ready = !owesClass && !owesActivity
  const stage = owesClass ? 'schedule' : owesActivity ? 'after' : 'go'
  /* Count what's missing, because "Not yet" on its own gives the student no way forward. */
  const notYet = owesClass
    ? `Not yet: fill ${n.electivesLeft > 1 ? 'both Elective periods' : 'the last Elective period'}.`
    : owesActivity
      ? seasonsLeft > 1
        ? `Not yet: pick something for all ${seats} seasons. ${seasonsLeft} still empty.`
        : seats > 1 ? 'Not yet: one season is still empty.'
          : 'Not yet: press one club or sport below.'
      : null
  return { owesClass, owesActivity, ready, stage, notYet }
}
