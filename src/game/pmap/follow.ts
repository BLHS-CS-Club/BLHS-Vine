/* Walking behind someone. Each frame, followStep decides whether the follower moves and how fast. */

/**
 * How far apart two characters are on the ground. The painting is squashed up and down, so the y
 * distance is stretched back out first.
 */
export function groundApart(
  a: { x: number; y: number }, b: { x: number; y: number }, yScale: number,
): number {
  const ys = yScale || 1
  return Math.hypot(a.x - b.x, (a.y - b.y) / ys)
}

export interface FollowFrame {
  /** Where the character being followed is standing this frame. */
  leader: { x: number; y: number }
  /** How fast the leader is really moving, or null once the leader has stopped. */
  leaderSpeed: number | null
  /** Where the follower is standing this frame. */
  me: { x: number; y: number }
  /**
   * The distance the follower keeps from the leader, in ground pixels. It's two body lengths on
   * every map so far.
   */
  gap: number
  /** The speed the walk started at. It's used once the leader has stopped. */
  restSpeed: number
  /** The follower's own top speed. This is the scene's SPD, not map.speed. */
  ownSpeed: number
  yScale: number
}

export interface FollowStep {
  /** Stand still this frame. The follower is inside the gap and would walk into the leader. */
  hold: boolean
  /**
   * The fraction of a frame handed to the walking code, so the speed and the walk animation slow
   * down together.
   */
  paceScale: number
  /** The real gap this frame, so a test harness can read the same number. */
  apart: number
}

/* Stop inside the gap. Otherwise match the leader's speed, but never go faster than the follower's
 * own top speed. */
export function followStep(f: FollowFrame): FollowStep {
  const apart = groundApart(f.leader, f.me, f.yScale)
  if (apart <= f.gap) return { hold: true, paceScale: 0, apart }
  const want = f.leaderSpeed ?? f.restSpeed
  const own = f.ownSpeed || 1
  return { hold: false, paceScale: Math.max(0, Math.min(1, want / own)), apart }
}
