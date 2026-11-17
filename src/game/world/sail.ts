/* The ship on the world map, kept as plain data that one tick moves forward. */

/**
 * The eight compass headings. The walking code uses the same list, so a berth's `facing` means the
 * same thing for the ship as it does for a character.
 */
export const HEADINGS = [
  'east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east',
] as const
export type Heading = typeof HEADINGS[number]

export const headingOf = (dx: number, dy: number): Heading => {
  const a = Math.atan2(dy, dx)
  const i = Math.round(a / (Math.PI / 4))
  return HEADINGS[((i % 8) + 8) % 8]
}

export type HullState = {
  x: number
  y: number
  /**
   * The direction the ship points, in radians. It turns toward a new heading gradually instead of
   * snapping.
   */
  heading: number
  /** Ocean pixels per second along the heading. Never negative. */
  speed: number
  /* Whether the ship is touching the coast. It stays true until the ship makes progress back toward
   * deeper water. */
  aground: boolean
  /** The wake points, oldest first. There's a hard cap so a long crossing can't keep growing it. */
  wake: WakePt[]
}

/* One wake point. There are two trails, one from each back corner of the ship, and each point ages
 * on its own. */
export type WakePt = { x: number; y: number; side: -1 | 1; age: number }

export type SailCfg = {
  /** Cruising top speed in ocean px/s. A map can set its own with `speed` in `map.json`. */
  cruise: number
  /** Holding the full-sail key raises the top speed to this. It doesn't change the acceleration. */
  fullSail: number
  /** Acceleration, in ocean px per second per second. */
  accel: number
  /** How fast the ship loses speed with no throttle. */
  drag: number
  /** Radians per second the bow can turn. It turns slower at high speed. */
  turn: number
  /** Radius of the round probe: how far from the ship's center the coast starts to block it. */
  probe: number
  /**
   * How many wake points are kept. It's a hard cap, because a crossing can go on for any length of
   * time.
   */
  wakeCap: number
  /** How many seconds a wake point lives. */
  wakeLife: number
  /** How far off the center line the two trails sit. */
  wakeSpread: number
}

/* The default sailing numbers. Cruise sits well below full sail so there's a real difference when
 * the player holds full sail, and the bow turns a bit slowly. A map can still set its own `speed`. */
export const DEFAULT_SAIL: SailCfg = {
  cruise: 96, fullSail: 170, accel: 62, drag: 46, turn: 1.7,
  /* Keep the wake short. A long wake trails across most of the screen at the sailing zoom, and a
   * real wake closes up behind the ship. */
  probe: 26, wakeCap: 170, wakeLife: 1.5, wakeSpread: 7,
}

/**
 * What the player is asking for this tick. `turn` is -1, 0 or 1 and `throttle` is 0 or 1, so a
 * keyboard and a pointer both turn into the same shape.
 */
export type Helm = { throttle: number; turn: number; fullSail: boolean }

export const HELM_IDLE: Helm = { throttle: 0, turn: 0, fullSail: false }

/* Steer toward a point. The wheel turns in proportion to how far off the heading is, and the
 * throttle eases off through a big turn. Turning the wheel all the way every time makes the ship
 * swing too hard. */
export const SOFT_RAD = 0.55
export function steerTo(s: HullState, aim: { x: number; y: number }, full = false): Helm {
  const want = Math.atan2(aim.y - s.y, aim.x - s.x)
  let err = want - s.heading
  while (err > Math.PI) err -= 2 * Math.PI
  while (err < -Math.PI) err += 2 * Math.PI
  const turn = Math.max(-1, Math.min(1, err / SOFT_RAD))
  /* A small heading error barely slows the ship, and a hairpin turn slows it a lot. The throttle
   * never drops below 0.25, so the ship never stops dead in the middle of a turn. */
  const ease = Math.max(0.25, 1 - Math.abs(err) / Math.PI)
  return { throttle: ease, turn: Math.abs(turn) < 0.04 ? 0 : turn, fullSail: full }
}

/* The same rule as `steerTo`, for a helm that already knows its heading error. The wheel turns in
 * proportion, and the throttle eases off through a hard turn. */
export function easeHelm(err: number, throttle: number): Helm {
  const turn = Math.max(-1, Math.min(1, err / SOFT_RAD))
  const ease = Math.max(0.25, 1 - Math.abs(err) / Math.PI)
  return { throttle: throttle * ease, turn: Math.abs(turn) < 0.04 ? 0 : turn, fullSail: false }
}

/* `lineUpPoint` (below) finds the mark behind the berth, on the berth's heading, where the final
 * run-in starts. It walks outward until it hits land, so the mark is always on water, and it goes
 * no further out than the ship needs to turn around. It's exported so a route can be searched to it
 * over water. */
/* `insideTheApproach` checks whether the ship is already on the approach line: behind the berth,
 * close to the line and no further out than the mark. If it is, the ship keeps coming in instead of
 * sailing back out to the mark. A ship ahead of the berth still has to loop around. */
export function insideTheApproach(
  from: { x: number; y: number },
  berth: { x: number; y: number },
  facing: number,
  mark: { x: number; y: number } | null,
  heading?: number,
): boolean {
  const fx = Math.cos(facing), fy = Math.sin(facing)
  const dx = from.x - berth.x, dy = from.y - berth.y
  const along = dx * fx + dy * fy
  /* Behind the berth is the only side a run-in can come from. */
  if (along >= 0) return false
  const cross = Math.abs(dx * -fy + dy * fx)
  if (cross > RUN_IN_CORRIDOR_PX) return false
  /* The ship also has to be pointing down the line. A ship crossing the corridor sideways is inside
   * it by the math, but it would have to stop and turn on the spot. Going out to the mark gives it
   * room to turn while moving. */
  if (heading !== undefined && Math.abs(wrap(heading - facing)) > LINED_UP_RAD) return false
  /* And it can't be further out than the mark, or there's more line to gain by standing off. No
   * mark at all means there isn't enough water for a full line, so being on it this close is the
   * best the ship can get. */
  if (!mark) return true
  const markOut = Math.hypot(mark.x - berth.x, mark.y - berth.y)
  return -along <= markOut + 20
}

export function lineUpPoint(
  target: { x: number; y: number },
  facing: number,
  cfg: SailCfg = DEFAULT_SAIL,
  ok?: Navigable,
): { x: number; y: number } | null {
  const fx = Math.cos(facing), fy = Math.sin(facing)
  const radius = cfg.cruise / Math.max(0.2, cfg.turn * 0.74)
  const reach = Math.max(RUN_IN_CORRIDOR_PX, Math.min(RUN_IN_ROUND_PX, radius * 3))
  let back = 0
  for (let d = RUN_IN_CORRIDOR_PX; d <= reach; d += 20) {
    if (ok && !ok(target.x - fx * d, target.y - fy * d)) break
    back = d
  }
  if (!back) return null
  return { x: target.x - fx * back, y: target.y - fy * back }
}

export const newHull = (x: number, y: number, heading = 0): HullState =>
  ({ x, y, heading, speed: 0, aground: false, wake: [] })

/* How deep the water is at a point. Positive is water, negative is land. */
export type DepthAt = (x: number, y: number) => number

/* Moves the ship forward one tick and returns the new state. */
export function stepHull(s: HullState, helm: Helm, dt: number, depth: DepthAt, cfg = DEFAULT_SAIL): HullState {
  const d = Math.max(0, Math.min(dt, 0.1))          // Cap dt so a hidden tab can't teleport the ship.
  const ceiling = helm.fullSail ? cfg.fullSail : cfg.cruise

  /* The ship turns slower the faster it goes. Don't add a turning cut at low speed. It stops a
   * player at rest from pointing the ship, and the run-in does its hardest turning at low speed. */
  const rate = cfg.turn * (1 - 0.45 * Math.min(1, s.speed / Math.max(1, cfg.fullSail)))
  const heading = s.heading + helm.turn * rate * d

  let speed = s.speed
  /* The throttle is a fraction, not on or off, so a helm can ease off through a turn. The top speed
   * drops with it, or a quarter throttle would keep coasting at cruise until drag caught up. */
  const want = ceiling * Math.max(0, Math.min(1, helm.throttle))
  if (helm.throttle > 0) speed = Math.min(want, speed + cfg.accel * d * helm.throttle)
  else speed = Math.max(0, speed - cfg.drag * d)
  /* Letting go of full sail doesn't stop the ship dead. The top speed drops and drag slows the ship
   * down to it, so it feels like easing off instead of braking. */
  const top = helm.throttle > 0 ? want : ceiling
  if (speed > top) speed = Math.max(top, speed - cfg.drag * d)

  let nx = s.x + Math.cos(heading) * speed * d
  let ny = s.y + Math.sin(heading) * speed * d

  /* Check for the coast using the shared distance field and a round probe around the ship. */
  const here = depth(s.x, s.y)
  const there = depth(nx, ny)
  const grounded = there < cfg.probe
  let aground = s.aground

  if (grounded) {
    if (there > here + 0.01) {
      aground = true                                 // Still on land, but moving off it.
    } else {
      /* Slide along the coast instead of stopping dead. Keep whichever direction of movement
       * doesn't go into shallower water. */
      const ax = depth(nx, s.y), ay = depth(s.x, ny)
      const okx = ax >= here - 0.01, oky = ay >= here - 0.01
      if (okx && (!oky || ax >= ay)) { ny = s.y }
      else if (oky) { nx = s.x }
      else { nx = s.x; ny = s.y; speed = Math.min(speed, cfg.cruise * 0.15) }
      aground = true
    }
  } else {
    aground = false
  }

  /* Age the wake points and drop the old ones. New points only get added while the ship is actually
   * moving. */
  const wake: WakePt[] = []
  for (const p of s.wake) {
    const age = p.age + d
    if (age < cfg.wakeLife) wake.push({ ...p, age })
  }
  /* Two wake points get added every frame, so the trail's length depends on the frame rate. The cap
   * is generous: at 60 fps it holds about three seconds of wake and at 30 fps about six. Points
   * fade by age, so both look the same length. */
  if (speed > cfg.cruise * 0.12) {
    const bx = -Math.cos(heading), by = -Math.sin(heading)
    const px = -by, py = bx                          // Perpendicular to the heading, for the spread.
    const qx = nx + bx * cfg.probe * 0.55, qy = ny + by * cfg.probe * 0.55
    wake.push({ x: qx + px * cfg.wakeSpread, y: qy + py * cfg.wakeSpread, side: 1, age: 0 })
    wake.push({ x: qx - px * cfg.wakeSpread, y: qy - py * cfg.wakeSpread, side: -1, age: 0 })
  }
  /* A hard cap on wake points, for the same reason the ocean pools its sprites. A crossing with no
   * limit on a 4 GB Chromebook slowly makes the machine worse. */
  while (wake.length > cfg.wakeCap) wake.shift()

  return { x: nx, y: ny, heading, speed, aground, wake }
}

/* Docking. It runs as a helm, so the same physics that sails the ship also docks it. */
export type Berthing = {
  target: { x: number; y: number }
  /** The heading to end on, in radians. Leave it out to keep whatever heading the ship arrives on. */
  facing?: number
  /** A point to head for before the final run-in, so the ship doesn't cut a corner. */
  approach?: { x: number; y: number }
  /* How far along docking is. given_up hands the helm back to the player. */
  stage: 'approach' | 'alongside' | 'done' | 'given_up'
  /* The watchdog: the closest the ship has gotten, and how long since it last got closer. */
  best?: number
  stuckMs?: number
}

/** How long the ship can go without getting closer before docking gives the helm back. */
export const BERTH_GIVE_UP_MS = 4000
/**
 * The ship has to get at least this much closer for it to count as progress, so small jitter
 * doesn't count.
 */
export const BERTH_PROGRESS_PX = 2

export const ALONGSIDE_PX = 18
/* How far from the mark still counts as docked when the ship can't get any closer. A berth can sit
 * where the 26px probe can't reach, so docked means within a ship's length, facing the right way
 * and unable to get closer. If the exact mark is reachable, the ship goes there. */
export const ALONGSIDE_MAX_PX = 52
/** How long the ship has to fail to get closer before being beside the berth is good enough. */
export const ALONGSIDE_SETTLED_MS = 1200
/** How close to the berth's heading counts as parallel to the dock. */
export const ALONGSIDE_RAD = 0.3

/* On the run-in the ship doesn't steer straight at the berth. It steers at a point on the berth's
 * line, and that point slides into the berth as the ship gets closer, so the ship arrives already
 * facing the right way. */
/** How far ahead along the line the steering point sits, as a fraction of the distance still to go. */
export const RUN_IN_LOOK = 0.85
/* The furthest behind the berth the meeting point can sit. At cruise the ship turns at about 1.6
 * rad/s and goes 150px/s, so its turning radius is roughly 92px and turning the bow 180 degrees
 * needs about 300px of water. */
export const RUN_IN_ROUND_PX = 320
/** How far off the line still counts as inside the approach corridor. */
export const RUN_IN_CORRIDOR_PX = 90
/** How far off the berth's heading still counts as lined up. */
export const LINED_UP_RAD = 0.9

const wrap = (a: number): number => {
  let r = a
  while (r > Math.PI) r -= Math.PI * 2
  while (r < -Math.PI) r += Math.PI * 2
  return r
}

/**
 * `berthHelm` (below) returns the helm docking wants this tick, and how far along docking is. `dt`
 * is only for the watchdog. Leave it out to run docking without ever giving up, which is what the
 * pure tests do.
 */
/* An optional test for whether a point is water. A meeting point worked out from the berth can't
 * tell if there's water there, so without this the ship can sail at a point off the map and run
 * aground. Leave it out and everything counts as water. */
export type Navigable = (x: number, y: number) => boolean

export function berthHelm(
  s: HullState, b: Berthing, cfg = DEFAULT_SAIL, dt = 0, ok?: Navigable,
): { helm: Helm; next: Berthing } {
  if (b.stage === 'done' || b.stage === 'given_up') return { helm: HELM_IDLE, next: b }

  /* Run the watchdog first. Measure progress against whatever the ship is steering for, not always
   * the berth, because heading out to an approach point means getting further from the berth for a
   * while. */
  const aimNow = b.stage === 'approach' && b.facing !== undefined
    ? {
      x: (b.approach ?? b.target).x - (b.approach ? 0 : Math.cos(b.facing) * RUN_IN_ROUND_PX),
      y: (b.approach ?? b.target).y - (b.approach ? 0 : Math.sin(b.facing) * RUN_IN_ROUND_PX),
    }
    : b.stage === 'approach' && b.approach ? b.approach : b.target
  const gap = Math.hypot(aimNow.x - s.x, aimNow.y - s.y)
  let best = b.best ?? gap
  let stuckMs = b.stuckMs ?? 0
  if (dt > 0) {
    if (gap < best - BERTH_PROGRESS_PX) { best = gap; stuckMs = 0 }
    else stuckMs += dt * 1000
    if (stuckMs >= BERTH_GIVE_UP_MS)
      return { helm: HELM_IDLE, next: { ...b, stage: 'given_up', best, stuckMs } }
  }
  const watched = (n: Berthing): Berthing => ({ ...n, best, stuckMs })
  /* Start the progress count over when the ship switches to a new aim. Its distance at that moment
   * becomes the new best. */
  const restart = (n: Berthing): Berthing => ({ ...n, best: undefined, stuckMs: 0 })

  if (b.stage === 'approach') {
    /* Head for a drawn approach point first, so the ship comes at the dock down the dock's own line
     * instead of cutting across the shallows. */
    /* When nobody drew an approach point, make one on the berth's line, about a turning circle
     * behind it, so the ship ends up in the corridor for the run-in. Being behind the berth and
     * near the line counts no matter how close, so a ship that has nearly reached the dock doesn't
     * sail back out to sea. */
    let aim = b.approach
    if (!aim && b.facing !== undefined) {
      const fx = Math.cos(b.facing), fy = Math.sin(b.facing)
      const along = (s.x - b.target.x) * fx + (s.y - b.target.y) * fy
      const cross = Math.abs(-(s.x - b.target.x) * fy + (s.y - b.target.y) * fx)
      /* The ship also needs room to straighten out. The room it needs is its heading error times
       * its turning radius, and none at all when it's already within the heading tolerance. */
      const off = Math.abs(wrap(b.facing - s.heading))
      const radius = cfg.cruise / Math.max(0.2, cfg.turn * 0.74)
      const room = off < ALONGSIDE_RAD ? 0 : off * radius
      /* `along < 0` means behind the berth. A ship sitting exactly on the mark has along = 0, which
       * is where `board()` leaves it, so the `near` check below catches that case. */
      /* `near` is only for a ship sitting at the berth, the way `board()` leaves it. It has to be
       * slow too, or a ship coming in fast from the wrong side ends up turning on the spot at the
       * dock. */
      const gap = Math.hypot(b.target.x - s.x, b.target.y - s.y)
      const near = gap <= ALONGSIDE_MAX_PX && s.speed < cfg.cruise * 0.5
      /* Don't sail past a dock the ship is already at. Inside the lineup distance the approach
       * stage is over, whichever way the ship is pointing. */
      const lineUp = lineUpPoint(b.target, b.facing, cfg, ok)
      /* Already on the approach line. Going out to the mark would take the ship through its own
       * berth and around in a loop. */
      const onHerRunAlready = insideTheApproach(s, b.target, b.facing, lineUp, s.heading)
      /* Close enough that going around again makes no sense. The corridor width is the cutoff,
       * since it already means beside the dock in this code. */
      /* The ship also has to be slow. A ship still at cruise this close can't turn onto the line
       * and ends up spinning in place, so slow and close docks from here while fast and close goes
       * around. */
      const onTopOfIt = gap <= RUN_IN_CORRIDOR_PX && s.speed < cfg.cruise * 0.55
      if (near || onTopOfIt || onHerRunAlready
        || (along < 0 && cross < RUN_IN_CORRIDOR_PX && -along >= room))
        return berthHelm(s, restart({ ...b, stage: 'alongside' }), cfg, dt, ok)
      /* `lineUpPoint` finds the furthest point back down the line that's still water. It walks out
       * from the berth instead of guessing, because a mark that's too close is bad and one on land
       * is worse. */
      /* It also goes no further out than the ship needs to straighten up, which comes from its
       * turning circle. */
      /* No water behind the berth at all, so there's no approach to make. Hand the ship to the
       * run-in and let it do what it can from where it is. */
      if (!lineUp) return berthHelm(s, restart({ ...b, stage: 'alongside' }), cfg, dt, ok)
      aim = lineUp
    }
    if (!aim) return berthHelm(s, restart({ ...b, stage: 'alongside' }), cfg, dt, ok)
    const dx = aim.x - s.x, dy = aim.y - s.y
    const d = Math.hypot(dx, dy)

    /* A waypoint counts as passed once it's behind the bow. The ship doesn't have to hit it
     * exactly. */
    const ahead = Math.cos(s.heading) * dx + Math.sin(s.heading) * dy
    if (d < ALONGSIDE_PX * 2 || (ahead < 0 && d < cfg.cruise))
      return berthHelm(s, restart({ ...b, stage: 'alongside' }), cfg, dt, ok)

    const err = wrap(Math.atan2(dy, dx) - s.heading)
    /* Keep speed through the gate, since it's a waypoint to pass and not a place to stop. Braking
     * for it makes the ship stop and start in open water. Only ease off when the bow has to turn
     * more than 90 degrees, because speed makes a turn wide. */
    const stopIn = (s.speed * s.speed) / (2 * cfg.drag)
    const hardTurn = Math.abs(err) > Math.PI / 2 && d < stopIn + ALONGSIDE_PX * 2
    /* Don't slow down for the meeting point. A ship with no speed can't turn, so it ends up
     * spinning in place. The ship slows down on the run-in instead. */
    return { helm: easeHelm(err, hardTurn ? 0 : 1), next: watched(b) }
  }

  const dx = b.target.x - s.x, dy = b.target.y - s.y
  const dist = Math.hypot(dx, dy)

  /* At the berth: throttle off, and swing onto the berth's heading. After a good run-in that's only
   * a degree or two. This also handles a ship that's already docked and asked to dock again, which
   * is at zero distance facing whatever way it was left. */
  if (dist <= ALONGSIDE_PX) {
    const err = b.facing === undefined ? 0 : wrap(b.facing - s.heading)
    if (s.speed < cfg.cruise * 0.12 && Math.abs(err) < ALONGSIDE_RAD)
      return { helm: HELM_IDLE, next: watched({ ...b, stage: 'done' }) }
    return { helm: { throttle: 0, turn: Math.abs(err) < 0.05 ? 0 : Math.sign(err), fullSail: false }, next: watched(b) }
  }

  /* Beside the berth and unable to get closer: turn the ship onto the berth's heading and tie up.
   * This needs the ship to be close first. */
  if (dist <= ALONGSIDE_MAX_PX && stuckMs >= ALONGSIDE_SETTLED_MS) {
    /* The ship has to have stopped, the same check the exact case above uses. Otherwise a ship
     * sailing past a berth with no heading would count as docked while still moving. */
    if (s.speed >= cfg.cruise * 0.12) return { helm: { throttle: 0, turn: 0, fullSail: false }, next: watched(b) }
    /* A berth with no heading can't be checked for lining up. Instead the ship has to go twice as
     * long without getting closer before it counts as docked. */
    if (b.facing === undefined) {
      if (stuckMs >= ALONGSIDE_SETTLED_MS * 2)
        return { helm: HELM_IDLE, next: watched({ ...b, stage: 'done' }) }
      return { helm: { throttle: 0, turn: 0, fullSail: false }, next: watched(b) }
    }
    const err = wrap(b.facing - s.heading)
    if (Math.abs(err) < ALONGSIDE_RAD * 1.5)
      return { helm: HELM_IDLE, next: watched({ ...b, stage: 'done' }) }
    return { helm: easeHelm(err, 0), next: watched(b) }
  }

  /* Steer onto the dock's line, not straight at the dock. Project the ship's position onto the line
   * and steer at a point further along it, never past the berth. The ship's heading lines up as
   * that point reaches the berth. */
  let aimX = b.target.x, aimY = b.target.y
  if (b.facing !== undefined) {
    const fx = Math.cos(b.facing), fy = Math.sin(b.facing)
    /* How far along the line the ship is, measured from the berth. Behind the berth is negative,
     * which is where a docking ship always is. */
    const along = (s.x - b.target.x) * fx + (s.y - b.target.y) * fy
    /* The steering point sits a fraction of the remaining distance ahead. A fixed distance past the
     * berth never finishes, and one stopped at the berth collapses onto it so the ship steers at
     * the dock instead of along it. */
    /* The approach stage already put the ship behind the berth. If it has overshot, the berth
     * itself is the aim. */
    const at = along < 0 ? along + Math.max(ALONGSIDE_PX, -along * RUN_IN_LOOK) : 0
    aimX = b.target.x + fx * at
    aimY = b.target.y + fy * at
  }

  const err = wrap(Math.atan2(aimY - s.y, aimX - s.x) - s.heading)
  /* Slow down onto the berth. The throttle cuts out inside the stopping distance for the current
   * speed, so the ship coasts in instead of arriving at cruise and stopping instantly. */
  const stopIn = (s.speed * s.speed) / (2 * cfg.drag)
  const throttle = dist > stopIn + ALONGSIDE_PX ? 1 : 0
  return { helm: easeHelm(err, throttle), next: watched(b) }
}

/* What the save keeps: the berth the ship was last tied to, never a point at sea. */
export type VesselRecord = {
  /** The composition slot whose berth the ship is tied to. */
  berthedAt: string
  /** How many legs this ship has sailed. It's the only sailing history the save keeps. */
  legs: number
}

export const moored = (v: VesselRecord | undefined): boolean => !!v?.berthedAt
