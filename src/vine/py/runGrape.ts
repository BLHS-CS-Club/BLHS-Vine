/* The engine side of running a member's Python island in a worker, one intent at a time. */
import { no, performIntent, type Intent, type IntentHost, type IntentResult } from '../intents'
import { PROTOCOL, type FromWorker, type ToWorker } from './protocol'
import type { LoadedGrape } from './grape-source'

/* Nobody normally gets near this limit. It's there so a `while True:` loop that keeps yielding
 * stops the island instead of freezing the browser tab. It's the same number as in run-station.ts. */
const MAX_STEPS = 10_000

/* Two timers: one for the island starting up, and one for the member's Python answering. */
const BOOT_MS = 20_000
const TURN_MS = 5_000

export type GrapeReport = {
  steps: number
  /* Intents the engine refused. They're kept so a member can see what their island asked for that
   * this scene can't do. */
  refused: { intent: string; why: string }[]
  /* Set when the island stopped before finishing. The engine itself is fine. */
  error?: string
  traceback?: string
}

export type GrapeReady = GrapeReport & { handlers: string[] }

export type GrapeSession = {
  /** Resolves when the island has imported. If `error` is set, it didn't. */
  ready: Promise<GrapeReady>
  /** Every handler the island registered, once ready has resolved. */
  handlers: () => string[]
  /** Run one handler all the way to the end. */
  call: (handler: string) => Promise<GrapeReport>
  /** Whether a handler is running right now. Ask this before a press, not after. */
  busy: () => boolean
  /* Shuts the worker down. A worker left running holds a Python heap, and a scene that closes in
   * the middle of a say must not leave one behind. */
  stop: () => void
}

export function openGrape(
  island: LoadedGrape,
  host: IntentHost,
  opts: {
    onPrint?: (text: string) => void; bootMs?: number; turnMs?: number
    /* The engine's own islands can skip adding the programme name to their flags. */
    unscoped?: boolean
  } = {},
): GrapeSession {
  /* Use new URL(..., import.meta.url) instead of a plain string path, because that's the form vite
   * follows to build a real file in production. */
  const worker = new Worker(new URL('./grape.worker.ts', import.meta.url), { type: 'module' })

  /* Every intent gets the island's own programme id attached, so each island's flags stay separate. */
  const scoped: IntentHost = opts.unscoped
    ? { ...host }
    : { ...host, by: { grape: island.manifest.programme } }

  let handlers: string[] = []
  let dead: { error: string; traceback?: string } | null = null
  let stopped = false
  /* Whoever is waiting for the next message. There's only ever one, which is how the
   * one-call-at-a-time rule gets enforced. */
  let waiting: { report: GrapeReport; settle: (r: GrapeReport) => void } | null = null
  let clock: ReturnType<typeof setTimeout> | null = null

  const disarm = () => { if (clock) { clearTimeout(clock); clock = null } }
  const arm = (ms: number, why: string) => {
    disarm()
    /* The island stopped answering, so the call ends here instead of hanging. */
    clock = setTimeout(() => kill(why), ms)
  }

  /** Ends whatever call is running and leaves the worker alive. */
  function finish(error?: string, traceback?: string) {
    const w = waiting
    waiting = null
    disarm()
    if (!w) return
    if (error) { w.report.error = error; w.report.traceback = traceback }
    w.settle(w.report)
  }

  /** The island is gone and so is the worker. Anything still waiting gets an answer. */
  function kill(error: string, traceback?: string) {
    if (stopped) return
    stopped = true
    dead = { error, traceback }
    worker.terminate()
    finish(error, traceback)
  }

/* What a call that got shut down finishes with, so nobody mistakes it for a clean finish. */
  const CLOSED = 'this island was closed before it finished'

  let readyResolve!: (r: GrapeReport) => void
  const ready = new Promise<GrapeReady>((resolve) => {
    /* This runs right away, so it's set before anything below can use it. */
    readyResolve = (r) => resolve({ ...r, handlers })
  })

  const send = (result: IntentResult) => {
    arm(opts.turnMs ?? TURN_MS, 'the island stopped answering')
    worker.postMessage({ t: 'resume', result } satisfies ToWorker)
  }

  const step = async (intent: Intent) => {
    const w = waiting
    if (!w) return
    if (++w.report.steps > MAX_STEPS) {
      kill(`the island yielded ${MAX_STEPS} times without finishing`)
      return
    }
    /* If an island yields something that isn't an intent, it has a typo, and it should hear about
     * it on the line that did it. */
    if (!intent || typeof intent !== 'object' || typeof intent.kind !== 'string') {
      send(no(`yielded ${JSON.stringify(intent)}, which is not an intent`))
      return
    }
    /* Turn the timer off here. performIntent is where a `say` waits on a person, and they can take
     * as long as they like. */
    disarm()
    const result = await performIntent(intent, scoped)
    /* The scene closed, or this call ended, while the player was reading a line, so there's nothing
     * to go back to. */
    if (stopped || waiting !== w) return
    if (!result.ok) w.report.refused.push({ intent: intent.kind, why: result.why })
    send(result)
  }

  worker.onerror = (e) => kill(`the island's worker did not load: ${e.message}`)
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as FromWorker
    switch (msg.t) {
      case 'print': opts.onPrint?.(msg.text); return
      case 'ready':
        disarm()
        if (msg.v !== PROTOCOL) {
          kill(`the page speaks protocol ${PROTOCOL} and the worker speaks ${msg.v}. Reload the page.`)
          return
        }
        handlers = msg.handlers
        finish()
        return
      case 'done': finish(); return
      /* The island stopped but the worker didn't. The module stays imported and its other handlers
       * still work, so one broken beat doesn't break a member's whole island. */
      case 'crash': finish(msg.error, msg.traceback); return
      case 'intent': void step(msg.intent)
    }
  }

  /* Loading is the first thing waiting on an answer, so it goes through the same one-at-a-time slot
   * as every call after it. */
  waiting = { report: { steps: 0, refused: [] }, settle: (r) => readyResolve(r) }
  arm(opts.bootMs ?? BOOT_MS, 'micropython did not start, or the island never finished importing')
  worker.postMessage({
    t: 'load',
    v: PROTOCOL,
    island: island.island,
    entry: island.manifest.entry,
    files: island.files,
    manifest: { ...island.manifest },
  } satisfies ToWorker)

  return {
    ready,
    handlers: () => handlers,
    call(handler: string): Promise<GrapeReport> {
      const report: GrapeReport = { steps: 0, refused: [] }
      /* A call after shutdown gets answered here instead of being sent to a dead worker. */
      if (stopped || dead) {
        return Promise.resolve({ ...report, error: dead?.error ?? CLOSED, traceback: dead?.traceback })
      }
      /* One message in, one message out. A second press while the first handler is paused on a
       * `say` would resume the wrong generator. */
      if (waiting) return Promise.resolve({ ...report, error: 'this island is already busy' })

      return new Promise<GrapeReport>((settle) => {
        waiting = { report, settle }
        arm(opts.turnMs ?? TURN_MS, 'the island stopped answering')
        worker.postMessage({ t: 'call', handler } satisfies ToWorker)
      })
    },
    busy: () => waiting !== null,
    stop() {
      if (stopped) return
      stopped = true
      worker.terminate()
      finish(CLOSED)
    },
  }
}
