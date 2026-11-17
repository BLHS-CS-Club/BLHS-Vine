/* Life is the set of numbers that makes a placement move. The position is worked out from the clock
 * every frame, not drawn as animation frames. */

export type LifeKind = 'wander' | 'cross' | 'orbit' | 'drift'

export interface LifeBounds {
  x: number
  y: number
  w: number
  h: number
}

/* A placement that changes over time. It has several states that play one after another and then
 * repeat. */
export interface LifeState {
  /* How many seconds this state lasts in each round. */
  secs: number
  /* Which picture to draw, as an index into the placement's own list of pictures. */
  art?: number
  /* Seconds of fade at each end, so a change of picture blends instead of cutting. */
  fade?: number
  /* How it moves during this state. If it's missing, it stands completely still. */
  move?: Life | null
}

export interface Life {
  kind: LifeKind
  /* The box it's allowed to move in, in painting pixels. If it's missing, it stays within range of
   * where it was placed. */
  bounds?: LifeBounds | null

  // ---- wander: bursts and pauses, the crab -------------------------------
  /* How far from home it can wander when there's no box, in pixels. */
  range?: number
  /* Speed in pixels per second, low and high. Each dash picks a speed between them. */
  speedMin?: number
  speedMax?: number
  /* Seconds of standing still between dashes, low and high. */
  pauseMin?: number
  pauseMax?: number
  /* How far one dash carries it, as a fraction of range. */
  stepMin?: number
  stepMax?: number
  /* Pixels of up and down bounce while moving. The crab's scuttle is 1.5. */
  bob?: number
  /* How fast that bounce repeats, in bounces per second. */
  bobRate?: number
  /* Mirror the sprite so it faces the way it's moving. */
  faceMotion?: boolean

  // ---- cross: a pass and a rest, the gull --------------------------------
  /* Seconds for the whole cycle. It's out of sight for most of it. */
  cycle?: number
  /* How many seconds of that cycle it spends flying across. */
  travel?: number
  /* The start and end of the pass, in painting pixels. Any end that's missing is worked out from
   * the box. */
  fromX?: number
  fromY?: number
  toX?: number
  toY?: number
  /* A wave along the pass: how many pixels it rises and falls, and how many waves there are. */
  swayAmp?: number
  swayWaves?: number
  /* Fade in and out at the ends of the pass instead of popping in. */
  fade?: boolean
  /* Draw it on top of everything instead of sorting it into the map by y. Use this for things in
   * the air, which shouldn't be hidden behind whatever is on the ground below them. */
  airborne?: boolean

  /* Rock: a tilt added on top of any behavior, in degrees to each side of upright. */
  rock?: number
  rockRate?: number

  // ---- orbit: a circuit ---------------------------------------------------
  /* Seconds for one lap. */
  period?: number
  /* The size of the oval, in pixels. */
  radiusX?: number
  radiusY?: number

  // ---- drift: barely moving, for something moored or idling ---------------
  /* Pixels of sway sideways and up and down. The time for one sway comes from `period`. */
  driftX?: number
  driftY?: number

  /* Only go where a character could stand, and stay inside the box as well. */
  walkOnly?: boolean
  /* How much of the box was walkable when it was drawn, from 0 to 1. The editor panel uses it to
   * explain itself, and the planner uses it to decide things. */
  walkPct?: number

  /* Seconds added to this placement's clock, so two copies of the same behavior don't move in step.
   * A duplicated placement gets a new seed and a new offset, so a pasted crowd doesn't move as one. */
  phase?: number

  /* Any whole number. All the random choices come from it, so two crabs side by side don't move the
   * same way. */
  seed?: number

  /* The list of states, two to six of them, if this thing changes over time. If it's missing, the
   * fields above describe everything it does. */
  states?: LifeState[]
}

const num = (v: unknown, d: number) => {
  const n = Number(v)
  return isFinite(n) ? n : d
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export const LIFE_KINDS: LifeKind[] = ['wander', 'cross', 'orbit', 'drift']

/* Cleans up whatever came from the file so it only holds values the code can handle. Anything
 * missing gets the beach map's numbers, since those have already been seen on screen and kept. */
export function cleanLife(raw: unknown, depth = 0): Life | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = LIFE_KINDS.includes(r.kind as LifeKind) ? (r.kind as LifeKind) : null
  if (!kind) return null
  const b = r.bounds as Record<string, unknown> | undefined
  const bounds: LifeBounds | null =
    b && num(b.w, 0) > 1 && num(b.h, 0) > 1
      ? { x: Math.round(num(b.x, 0)), y: Math.round(num(b.y, 0)), w: Math.round(num(b.w, 0)), h: Math.round(num(b.h, 0)) }
      : null
  const out: Life = { kind, bounds, seed: Math.round(clamp(num(r.seed, 1), 1, 2147483647)) }
  if (r.walkOnly) out.walkOnly = true
  if (isFinite(Number(r.walkPct))) out.walkPct = clamp(num(r.walkPct, 0), 0, 1)
  if (isFinite(Number(r.phase))) out.phase = clamp(num(r.phase, 0), 0, 100000)
  // The tilt works on every kind, so it's read before the code splits by kind.
  if (isFinite(Number(r.rock))) out.rock = clamp(num(r.rock, 0), 0, 45)
  if (isFinite(Number(r.rockRate))) out.rockRate = clamp(num(r.rockRate, 0.35), 0.01, 8)

  if (kind === 'wander') {
    out.range = clamp(num(r.range, 40), 4, 4000)
    out.speedMin = clamp(num(r.speedMin, 14), 0.5, 400)
    out.speedMax = clamp(num(r.speedMax, Math.max(out.speedMin, 26)), out.speedMin, 400)
    out.pauseMin = clamp(num(r.pauseMin, 1.2), 0, 60)
    out.pauseMax = clamp(num(r.pauseMax, Math.max(out.pauseMin, 4.7)), out.pauseMin, 120)
    out.stepMin = clamp(num(r.stepMin, 0.25), 0.02, 1)
    out.stepMax = clamp(num(r.stepMax, Math.max(out.stepMin, 0.8)), out.stepMin, 1)
    out.bob = clamp(num(r.bob, 1.5), 0, 24)
    out.bobRate = clamp(num(r.bobRate, 3.5), 0, 30)
    out.faceMotion = r.faceMotion !== false
  } else if (kind === 'cross') {
    out.cycle = clamp(num(r.cycle, 35), 2, 600)
    out.travel = clamp(num(r.travel, Math.min(9, out.cycle)), 0.5, out.cycle)
    if (isFinite(Number(r.fromX))) out.fromX = num(r.fromX, 0)
    if (isFinite(Number(r.fromY))) out.fromY = num(r.fromY, 0)
    if (isFinite(Number(r.toX))) out.toX = num(r.toX, 0)
    if (isFinite(Number(r.toY))) out.toY = num(r.toY, 0)
    out.swayAmp = clamp(num(r.swayAmp, 18), 0, 400)
    out.swayWaves = clamp(num(r.swayWaves, 1.4), 0, 20)
    out.fade = r.fade !== false
    out.airborne = !!r.airborne
    out.faceMotion = r.faceMotion !== false
  } else if (kind === 'orbit') {
    out.period = clamp(num(r.period, 12), 0.5, 600)
    out.radiusX = clamp(num(r.radiusX, 24), 1, 2000)
    out.radiusY = clamp(num(r.radiusY, Math.max(1, (out.radiusX as number) * 0.4)), 1, 2000)
    out.bob = clamp(num(r.bob, 0), 0, 24)
    out.bobRate = clamp(num(r.bobRate, 3), 0, 30)
    out.faceMotion = r.faceMotion !== false
  } else {
    out.driftX = clamp(num(r.driftX, 2), 0, 200)
    out.driftY = clamp(num(r.driftY, 1), 0, 200)
    out.period = clamp(num(r.period, 4), 0.2, 600)
    out.faceMotion = !!r.faceMotion
  }

  /* The states are read last, because the plain fields above become state one. */
  if (depth === 0 && kind !== 'cross' && Array.isArray(r.states)) {
    const st: LifeState[] = []
    for (const s of (r.states as unknown[]).slice(0, 6)) {
      if (!s || typeof s !== 'object') continue
      const q = s as Record<string, unknown>
      const secs = clamp(num(q.secs, 12), 0.2, 3600)
      const state: LifeState = {
        secs,
        /* Which picture this state draws, as an index from 0 to 7. */
        art: clamp(Math.round(num(q.art, 0)), 0, 7),
        /* Seconds of fade at each end. There's none unless the state asks for it. */
        fade: clamp(num(q.fade, 0), 0, Math.min(2, secs / 2)),
      }
      const mv = q.move ? cleanLife(q.move, 1) : null
      // A state that asks to be a cross keeps its seconds and its picture but doesn't move.
      // Otherwise the placement would fly off the map.
      if (mv && mv.kind !== 'cross') {
        /* A state always uses the placement's own box and floor setting, never its own. */
        mv.bounds = out.bounds ? { ...out.bounds } : null
        if (out.walkOnly) mv.walkOnly = true
        // The phase is added to the time before any of this runs, so a state with its own phase
        // would count it twice.
        delete mv.phase
        state.move = mv
      }
      st.push(state)
    }
    // One state isn't a sequence, and the fields above already say what it does.
    if (st.length > 1) {
      if (!st[0].move) st[0].move = { ...out, bounds: out.bounds ? { ...out.bounds } : null }
      delete (st[0].move as Life).phase
      /* The tilt belongs to the whole placement and is added to every state. So the copy that
       * becomes state one must not have it too, or it tilts twice as far during state one. */
      delete (st[0].move as Life).rock
      delete (st[0].move as Life).rockRate
      out.states = st
    }
  }
  return out
}

/* Where a placement is at time t, as an offset from where it was placed. */
export interface LifeAt {
  dx: number
  dy: number
  /* Face left. The caller mirrors the sprite. */
  flip: boolean
  /* From 0 to 1, for the fade at the ends of a pass. */
  alpha: number
  /* Which of the eight directions it faces, for art that has a frame for each direction. */
  facing: LifeFacing
  /* Whether it's moving right now, as opposed to standing still during a pause. */
  moving: boolean
  /* Extra tilt in radians, added to the placement's own rotation. It's zero unless the behavior
   * uses rock. */
  rot: number
  /* Which picture to draw. The caller looks it up in the placement's own list, and it's always 0
   * when there are no states. */
  art: number
}
export type LifeFacing =
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west'
  | 'north'
  | 'north-east'

/* The same direction mapping the walking code uses, so a wandering character and Thor agree on
 * which way is which. */
export function facingFrom(dx: number, dy: number, yScale = 1): LifeFacing {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return 'south'
  const a = (Math.atan2(dy * yScale, dx) * 180) / Math.PI
  if (a >= -22.5 && a < 22.5) return 'east'
  if (a >= 22.5 && a < 67.5) return 'south-east'
  if (a >= 67.5 && a < 112.5) return 'south'
  if (a >= 112.5 && a < 157.5) return 'south-west'
  if (a >= -67.5 && a < -22.5) return 'north-east'
  if (a >= -112.5 && a < -67.5) return 'north'
  if (a >= -157.5 && a < -112.5) return 'north-west'
  return 'west'
}

/* Every placement's position at time t can be worked out at once, so overlapping ones can be pushed
 * apart. */
/* Other characters count as part of the floor. bodyAt makes a test that says whether a spot is
 * already taken by someone. */
export type Body = { x: number; y: number; r: number }

export function bodyAt(bodies: Body[], yScale = 0.72) {
  return (x: number, y: number, skip = -1): boolean => {
    for (let i = 0; i < bodies.length; i++) {
      if (i === skip) continue
      const b = bodies[i]
      const dx = x - b.x
      const dy = (y - b.y) / (yScale || 1)
      if (dx * dx + dy * dy < b.r * b.r) return true
    }
    return false
  }
}

/* The ground test to give a moving figure: real floor that nobody else is standing on. It's built
 * from two pieces, so a caller that wants only the bare floor can still get it. */
export function floorWithBodies(
  stands: (x: number, y: number) => boolean,
  bodies: Body[],
  self: number,
  yScale = 0.72,
): (x: number, y: number) => boolean {
  const taken = bodyAt(bodies, yScale)
  return (x, y) => stands(x, y) && !taken(x, y, self)
}

export function separate(
  pts: { x: number; y: number; r: number }[],
  yScale = 0.55,
  // Keep this at full strength. Lower values leave most overlaps in place.
  strength = 1,
  /* The same floor test the behaviors use, so a push never lands someone in a wall. */
  stands?: (x: number, y: number) => boolean,
): { dx: number; dy: number }[] {
  const out = pts.map(() => ({ dx: 0, dy: 0 }))
  /* A couple of passes at half strength, measuring again each time, so nobody gets pushed too far. */
  const PASSES = 2
  const step = strength * 0.5
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        // Where the two are now, including what earlier passes already moved.
        const dx = b.x + out[j].dx - (a.x + out[i].dx)
        const dy = (b.y + out[j].dy - (a.y + out[i].dy)) / (yScale || 1)
        const want = a.r + b.r
        const d2 = dx * dx + dy * dy
        if (d2 >= want * want) continue
        const d = Math.sqrt(d2)
        /* Two characters exactly on top of each other get pushed apart sideways by their order in
         * the list, so the result never depends on which one showed up first. */
        const ux = d > 0.001 ? dx / d : i < j ? -1 : 1
        const uy = d > 0.001 ? dy / d : 0
        const push = ((want - d) / 2) * step
        out[i].dx -= ux * push
        out[i].dy -= uy * push * (yScale || 1)
        out[j].dx += ux * push
        out[j].dy += uy * push * (yScale || 1)
        moved = true
      }
    }
    // Nothing overlaps anymore, so the rest of the passes can be skipped.
    if (!moved) break
  }
  if (stands)
    for (let i = 0; i < pts.length; i++) {
      const o = out[i]
      if (!o.dx && !o.dy) continue
      if (!stands(pts[i].x + o.dx, pts[i].y + o.dy)) {
        o.dx = 0
        o.dy = 0
      }
    }
  return out
}

/* Which state is playing at time t, how many full rounds have gone by, and how far into the current
 * state it is. */
export function liveState(states: LifeState[], t: number): { k: number; c: number; into: number } {
  let T = 0
  for (let i = 0; i < states.length; i++) T += states[i].secs
  const c = Math.floor(t / T)
  const p = t - c * T
  let k = 0
  let start = 0
  while (k < states.length - 1 && p >= start + states[k].secs) {
    start += states[k].secs
    k++
  }
  return { k, c, into: p - start }
}

/* Each moving state gets a share of the box, measured out from where the placement stands. */
function share(m: Life, home: { x: number; y: number }, n: number): Life {
  const b = m.bounds
  if (!b) return m
  // Keep the home point inside the box first. A placement dropped outside its box has no room on
  // one side, and the math below would give a negative size.
  const hx = clamp(home.x, b.x, b.x + b.w)
  const hy = clamp(home.y, b.y, b.y + b.h)
  return { ...m, bounds: { x: home.x - (hx - b.x) / n, y: home.y - (hy - b.y) / n, w: b.w / n, h: b.h / n } }
}

/* Turns a whole number into a fixed value from 0 to 1, so a behavior looks random but plays the
 * same every time. */
function rnd(n: number, seed: number): number {
  let x = (Math.imul(n ^ seed, 2246822519) ^ Math.imul(n + seed, 3266489917)) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 2246822519) >>> 0
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

/* canStand is the floor test that keeps a placement on walkable ground. It's optional, so a caller
 * without one still gets the box. The editor passes its own level mask and the game passes the
 * bundle's. */
export function lifeAt(
  life: Life,
  t0: number,
  home: { x: number; y: number },
  canStand?: (x: number, y: number) => boolean,
): LifeAt {
  const seed = life.seed || 1
  // The phase keeps two copies of one behavior out of step.
  const t = t0 + (life.phase || 0)
  const floor = life.walkOnly && canStand ? canStand : null
  /* The tilt is worked out once and added to every result below, on top of the movement. That way a
   * moored boat can drift a little and lean at the same time. */
  const rock = life.rock ? (life.rock * Math.PI) / 180 : 0
  const rot = rock ? rock * Math.sin(t * Math.PI * 2 * (life.rockRate ?? 0.35)) : 0
  const still: LifeAt = { dx: 0, dy: 0, flip: false, alpha: 1, facing: 'south', moving: false, rot, art: 0 }
  if (!life) return still
  /* With states: find which one is playing, and add up how far every state has moved. */
  if (life.states && life.states.length > 1) {
    const st = life.states
    const { k, c, into } = liveState(st, t)
    /* Count the states that move, because only they share the box. A state that only changes the
     * picture gets no share. */
    let movers = 0
    for (let j = 0; j < st.length; j++) if (st[j].move) movers++
    /* The floor is split between the moving states the same way the box is. */
    const near =
      movers > 1 && canStand
        ? (x: number, y: number) => canStand(home.x + (x - home.x) * movers, home.y + (y - home.y) * movers)
        : canStand
    let ax = home.x
    let ay = home.y
    let heldFlip = false
    let heldFace: LifeFacing = 'south'
    let cur: LifeAt | null = null
    for (let j = 0; j < st.length; j++) {
      const raw = st[j].move
      if (!raw) continue
      /* Give any state that's missing them the placement's own box and floor setting. */
      const eff =
        (life.bounds && !raw.bounds) || (life.walkOnly && !raw.walkOnly)
          ? {
              ...raw,
              ...(life.bounds && !raw.bounds ? { bounds: { ...life.bounds } } : {}),
              ...(life.walkOnly && !raw.walkOnly ? { walkOnly: true } : {}),
            }
          : raw
      const m = share(eff, home, movers)
      // How many seconds this state has played in total. That's one full run for every round
      // already finished, plus this round: all of it for a state that's done, part of it for the
      // one playing, and none for one still to come.
      const own = (j < k ? c + 1 : c) * st[j].secs + (j === k ? into : 0)
      const a = lifeAt(m, own, home, near)
      ax += a.dx
      ay += a.dy
      if (j > 0) {
        // Only count how far this state has moved since it first started.
        const z = lifeAt(m, 0, home, near)
        ax -= z.dx
        ay -= z.dy
      }
      if (j === k) cur = a
      else if (j < k) {
        // Remember which way it faced when it stopped, so a state that stands still keeps that
        // facing. Only states already finished this round count.
        heldFlip = a.flip
        heldFace = a.facing
      }
    }
    let dx = ax - home.x
    let dy = ay - home.y
    /* Keep the total inside the box, not each state on its own. */
    const box = life.bounds
    if (box) {
      dx = clamp(home.x + dx, box.x, box.x + box.w) - home.x
      dy = clamp(home.y + dy, box.y, box.y + box.h) - home.y
    }
    /* Keep the total on the floor too: shrink the offset toward home until the feet are on walkable
     * ground. */
    if (life.walkOnly && canStand && (dx || dy) && !canStand(home.x + dx, home.y + dy)) {
      let lo = 0
      for (let s = 15; s >= 1; s--) {
        const k = s / 16
        if (canStand(home.x + dx * k, home.y + dy * k)) {
          lo = k
          break
        }
      }
      dx *= lo
      dy *= lo
    }
    const f = st[k].fade || 0
    /* The very first round starts fully visible, since there's nothing to fade in from. */
    const opening = k === 0 && c === 0
    const fa = f > 0 ? Math.max(0, Math.min(1, Math.min(opening ? f : into, st[k].secs - into) / f)) : 1
    const art = st[k].art || 0
    if (cur) {
      return {
        dx,
        dy,
        flip: cur.flip,
        alpha: cur.alpha * fa,
        facing: cur.facing,
        moving: cur.moving,
        // The placement's own tilt is added to every state, on top of any tilt the state's own
        // behavior has.
        rot: cur.rot + rot,
        art,
      }
    }
    // No movement in this state, so it stands where the last state left it, facing the way it faced
    // when it stopped.
    return { dx, dy, flip: heldFlip, alpha: fa, facing: heldFace, moving: false, rot, art }
  }
  /* Whether the whole line to a target is walkable, checked every two pixels. */
  const clearPath = (ax: number, ay: number, bx: number, by: number) => {
    if (!floor) return true
    const d = Math.hypot(bx - ax, by - ay)
    const n = Math.max(1, Math.ceil(d / 2))
    for (let i = 1; i <= n; i++) {
      const u = i / n
      if (!floor(ax + (bx - ax) * u, ay + (by - ay) * u)) return false
    }
    return true
  }

  if (life.kind === 'wander') {
    /* Replay the legs from the start instead of simulating frame by frame. With a given seed, each
     * leg always has the same length of time and the same destination, so adding them up gives the
     * exact position at any time. That's what makes it repeatable. */
    const b = life.bounds
    const range = life.range ?? 40
    const halfW = b ? b.w / 2 : range
    const halfH = b ? b.h / 2 : range * 0.35
    const cx = b ? b.x + b.w / 2 : home.x
    const cy = b ? b.y + b.h / 2 : home.y
    let px = home.x
    let py = home.y
    let clock = 0
    let flip = false
    /* 512 random legs, and then leg 512 walks back to the starting point so the whole walk loops. */
    let tw = t
    for (let pass = 0; pass < 2; pass++) {
      px = home.x
      py = home.y
      clock = 0
      for (let k = 0; k <= 512; k++) {
        /* The leg back to the starting point, which closes the loop. */
        const homing = k === 512
        let tx = homing ? home.x : cx + (rnd(k * 2 + 1, seed) * 2 - 1) * halfW
        let ty = homing ? home.y : cy + (rnd(k * 2 + 2, seed) * 2 - 1) * halfH
        /* The floor check. Try other spots from a fixed list and take the first one that's
         * walkable. */
        if (!homing && floor && (!floor(tx, ty) || !clearPath(px, py, tx, ty))) {
          let found = false
          for (let try_ = 0; try_ < 12; try_++) {
            const ax = cx + (rnd(k * 40 + try_ * 2 + 3001, seed) * 2 - 1) * halfW
            const ay = cy + (rnd(k * 40 + try_ * 2 + 3002, seed) * 2 - 1) * halfH
            if (floor(ax, ay) && clearPath(px, py, ax, ay)) {
              tx = ax
              ty = ay
              found = true
              break
            }
          }
          /* Every spot is blocked, so it stays where it is for this leg. */
          if (!found) {
            tx = px
            ty = py
          }
        }
        const dist = Math.hypot(tx - px, ty - py)
        const sp = (life.speedMin ?? 14) + rnd(k + 977, seed) * ((life.speedMax ?? 26) - (life.speedMin ?? 14))
        const moveT = dist / Math.max(sp, 0.5)
        const pause = (life.pauseMin ?? 1.2) + rnd(k + 5501, seed) * ((life.pauseMax ?? 4.7) - (life.pauseMin ?? 1.2))
        if (tw < clock + moveT) {
          const u = moveT > 0 ? (tw - clock) / moveT : 1
          const x = px + (tx - px) * u
          const y = py + (ty - py) * u
          flip = tx < px
          const hop = (life.bob ?? 1.5) * Math.abs(Math.sin(tw * Math.PI * (life.bobRate ?? 3.5)))
          return {
            dx: x - home.x,
            dy: y - home.y - hop,
            flip: (life.faceMotion ?? true) && flip,
            alpha: 1,
            facing: facingFrom(tx - px, ty - py),
            moving: true,
            rot,
            art: 0,
          }
        }
        clock += moveT
        if (tw < clock + pause) {
          flip = tx < px
          // Standing still, still facing the way the last dash went.
          return {
            dx: tx - home.x,
            dy: ty - home.y,
            flip: (life.faceMotion ?? true) && flip,
            alpha: 1,
            facing: facingFrom(tx - px, ty - py),
            moving: false,
            rot,
            art: 0,
          }
        }
        clock += pause
        px = tx
        py = ty
      }
      /* The time is past the end, so clock now holds the length of one full loop. The second pass
       * wraps the time back inside it. */
      if (!(clock > 0)) break
      tw = tw % clock
    }
    return still
  }

  if (life.kind === 'cross') {
    const cycle = life.cycle ?? 35
    const travel = Math.min(life.travel ?? 9, cycle)
    const u = (t % cycle) / travel
    if (u > 1) return { dx: 0, dy: 0, flip: false, alpha: 0, facing: 'south', moving: false, rot, art: 0 }
    const b = life.bounds
    const fx = life.fromX ?? (b ? b.x - 20 : home.x - 200)
    const fy = life.fromY ?? (b ? b.y + b.h * 0.3 : home.y)
    const tx = life.toX ?? (b ? b.x + b.w + 20 : home.x + 200)
    const ty = life.toY ?? (b ? b.y + b.h * 0.6 : home.y)
    const x = fx + (tx - fx) * u
    const y = fy + (ty - fy) * u + (life.swayAmp ?? 18) * Math.sin(u * Math.PI * 2 * (life.swayWaves ?? 1.4))
    // Fade in and out over the first and last tenth of the pass, so it doesn't pop.
    const a = life.fade === false ? 1 : Math.min(1, Math.min(u, 1 - u) / 0.1)
    return {
      dx: x - home.x,
      dy: y - home.y,
      flip: (life.faceMotion ?? true) && tx < fx,
      alpha: Math.max(0, a),
      facing: facingFrom(tx - fx, ty - fy),
      // A pass is moving the whole way across, with no stopping.
      moving: true,
      rot,
      art: 0,
    }
  }

  if (life.kind === 'orbit') {
    const p = life.period ?? 12
    const a = (t / p) * Math.PI * 2
    const rx = life.radiusX ?? 24
    const ry = life.radiusY ?? rx * 0.4
    const hop = (life.bob ?? 0) * Math.abs(Math.sin(t * Math.PI * (life.bobRate ?? 3)))
    return {
      dx: Math.cos(a) * rx,
      dy: Math.sin(a) * ry - hop,
      flip: (life.faceMotion ?? true) && Math.sin(a) < 0,
      alpha: 1,
      // It faces along the edge of the circle, which is the way it's heading.
      facing: facingFrom(-Math.sin(a) * rx, Math.cos(a) * ry),
      // An orbit never stops going around.
      moving: true,
      rot,
      art: 0,
    }
  }

  const p = life.period ?? 4
  const a = (t / p) * Math.PI * 2
  return {
    dx: Math.sin(a) * (life.driftX ?? 2),
    dy: Math.cos(a * 0.7) * (life.driftY ?? 1),
    flip: false,
    alpha: 1,
    facing: 'south',
    // A drift sways forever without settling, so its animation keeps playing.
    moving: true,
    rot,
    art: 0,
  }
}
