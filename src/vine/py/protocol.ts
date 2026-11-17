/* Every message sent to and from the Python worker. There are three kinds going in and five coming
 * out, all JSON. */
import type { Intent, IntentResult } from '../intents'

/* The message format version. Both sides check it, so a stale cached worker file gets reported. */
export const PROTOCOL = 1

/* Messages from the engine to the island. */
export type ToWorker =
  /* The island's whole package as files, so a traceback names the member's own file. */
  | {
    t: 'load'; v: number; island: string; entry: string
    files: Record<string, string>
    /* The island's own island.json, so manifest()["programme"] works and the id only has to be
     * written in one place. */
    manifest: Record<string, unknown>
  }
  /* Run one registered handler. Only one runs at a time, with one message in and one message out. */
  | { t: 'call'; handler: string }
  | { t: 'resume'; result: IntentResult }

/* Messages from the island to the engine. */
export type FromWorker =
  /* The island imported with no errors, and these are the handlers it registered. */
  | { t: 'ready'; v: number; handlers: string[] }
  | { t: 'intent'; intent: Intent }
  /* print(). It's the first thing a beginner types, so it gets its own message. */
  | { t: 'print'; text: string }
  /* The handler finished, and the island stays loaded for the next press. */
  | { t: 'done' }
  /* The island stopped but the engine kept going. error is the line to show the player, and
   * traceback is the whole thing. */
  | { t: 'crash'; error: string; traceback: string }

/* What the pump leaves in `_step`, before the version number is added. */
export type PyStep =
  | { t: 'ready'; handlers: string[] }
  | { t: 'intent'; intent: Intent }
  | { t: 'done' }
