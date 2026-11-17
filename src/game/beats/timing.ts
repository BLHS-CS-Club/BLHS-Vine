// One way to time answers, used everywhere: from the moment a question can be answered to the first
// answer.

/** The name of this timing rule. It goes on every event so an export says what the times mean. */
export const LATENCY_CONVENTION = 'first-answer'

/**
 * Saves the time of the first answer to a question. Later answers to the same question don't change
 * it.
 */
export function markFirst(stamps: Record<string, number>, id: string, now = Date.now()): void {
  if (stamps[id] === undefined) stamps[id] = now
}

/** A question with no saved time reports the time up to now instead of zero. */
export function latencyOf(t0: number, stamps: Record<string, number>, id: string, now = Date.now()): number {
  return (stamps[id] ?? now) - t0
}
