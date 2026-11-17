// Runs a station's generator of intents until it finishes. Each time the generator yields an
// intent, this carries it out and hands the result back in.
import { performIntent, type Intent, type IntentHost } from '../../vine/intents'

/* A limit for code that never finishes. A `while True:` in a member's island stops the island
 * instead of freezing the browser tab. */
const MAX_STEPS = 10_000

export type StationBody = Generator<Intent, void, unknown>

export type RunReport = {
  steps: number
  /* Intents the engine turned down. A debug overlay can use this list to show what an island asked
   * for that this map can't do. */
  refused: { intent: string; why: string }[]
  error?: string
}

export async function runStation(body: StationBody, host: IntentHost, label = 'station'): Promise<RunReport> {
  const report: RunReport = { steps: 0, refused: [] }
  /* What to hand back on the next resume: either the value from the intent that just finished, or
   * an error to throw at the yield that asked for it. */
  let send: unknown
  let raise: Error | null = null

  for (;;) {
    if (report.steps++ > MAX_STEPS) {
      report.error = `${label} yielded ${MAX_STEPS} times without finishing`
      console.error(`[station] ${report.error}`)
      try { body.return(undefined) } catch { /* If it won't close, it has already stopped. */ }
      return report
    }

    let step: IteratorResult<Intent, void>
    try {
      step = raise ? body.throw(raise) : body.next(send)
    } catch (e) {
      /* The body threw an error, either its own or one thrown into it that it didn't catch. Keep
       * its own message instead of wrapping it, because that's the helpful one. */
      report.error = e instanceof Error ? e.message : String(e)
      console.error(`[station] ${label}:`, report.error)
      return report
    }
    raise = null
    if (step.done) return report

    const intent: Intent = step.value
    /* Yielding something that isn't an intent is probably a typo. Throw the error at the exact line
     * that yielded it. */
    if (!intent || typeof intent !== 'object' || typeof intent.kind !== 'string') {
      raise = new Error(`yielded ${JSON.stringify(intent)}, which is not an intent`)
      continue
    }

    const result = await performIntent(intent, host)
    if (result.ok) {
      send = result.value
    } else {
      report.refused.push({ intent: intent.kind, why: result.why })
      send = undefined
      raise = new Error(`${intent.kind}: ${result.why}`)
    }
  }
}
