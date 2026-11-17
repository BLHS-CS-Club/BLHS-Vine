// A queue of spoken lines and questions for anything that isn't a cutscene, like a station.

export type DialogueLine = {
  /* An anchor name when the speaker stands somewhere on the map, so the camera and the portrait
   * both come from one string. Otherwise a plain id. */
  who?: string
  text: string
  portrait?: string
}

export type DialogueAsk = {
  prompt?: string
  options: string[]
}

export type DialogueState =
  | { kind: 'line'; line: DialogueLine; advance: () => void }
  | { kind: 'ask'; ask: DialogueAsk; pick: (i: number) => void }
  | null

/* The queue waits while the arrival card is up and starts again when it goes away. This is a value
 * import, not a type import, because this file runs the waiting itself. */
import { onStageBusy, placeCardUp } from './stage/stage-bus'

type Waiting =
  | { kind: 'line'; line: DialogueLine; done: () => void }
  | { kind: 'ask'; ask: DialogueAsk; done: (i: number) => void }

const queue: Waiting[] = []
let current: Waiting | null = null
const listeners = new Set<(s: DialogueState) => void>()

function view(): DialogueState {
  if (!current) return null
  if (current.kind === 'line') {
    const c = current
    return { kind: 'line', line: c.line, advance: () => finish(c, undefined) }
  }
  const c = current
  return { kind: 'ask', ask: c.ask, pick: (i: number) => finish(c, i) }
}

function announce() {
  const v = view()
  for (const fn of listeners) fn(v)
}

// Nothing speaks while an arrival card is up. The line waits its turn instead of getting dropped.
function pump() {
  if (current) return
  if (placeCardUp()) return
  current = queue.shift() ?? null
  announce()
}

function finish(who: Waiting, pick: number | undefined) {
  /* Ignore a click that shows up after the line already moved on. Without this, a double click on a
   * scene's last line would also answer the next one. */
  if (current !== who) return
  current = null
  if (who.kind === 'line') who.done()
  else who.done(typeof pick === 'number' ? pick : 0)
  pump()
}

export function say(line: DialogueLine): Promise<void> {
  return new Promise((resolve) => {
    queue.push({ kind: 'line', line, done: resolve })
    pump()
  })
}

export function choose(ask: DialogueAsk): Promise<number> {
  return new Promise((resolve) => {
    /* A question with no options answers -1 right away, so it doesn't wait for a button that was
     * never drawn. */
    if (!ask.options.length) { resolve(-1); return }
    queue.push({ kind: 'ask', ask, done: resolve })
    pump()
  })
}

/* Start the queue again as soon as the arrival card leaves, without waiting for the next say. */
if (typeof window !== 'undefined') onStageBusy(() => { if (!placeCardUp()) pump() })

export const dialogueState = view
export function onDialogue(fn: (s: DialogueState) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/* When a scene closes, finish everything still waiting. A station stuck on a promise that never
 * finishes keeps its world lock forever, and the next map opens with no controls. */
export function clearDialogue() {
  const stuck = [current, ...queue].filter(Boolean) as Waiting[]
  current = null
  queue.length = 0
  for (const w of stuck) {
    if (w.kind === 'line') w.done()
    else w.done(-1)
  }
  announce()
}
