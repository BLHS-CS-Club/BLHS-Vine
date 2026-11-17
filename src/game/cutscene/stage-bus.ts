// A scene posts the cutscene it's running here so the overlay can draw it. Only one cutscene can be
// posted at a time.
import type { CutsceneRuntime } from './runtime'

let live: CutsceneRuntime | null = null
const listeners = new Set<(rt: CutsceneRuntime | null) => void>()

const announce = () => { for (const fn of listeners) fn(live) }

/** A scene posts its cutscene. Call the function this gives back to take it down again. */
export function publishRuntime(rt: CutsceneRuntime): () => void {
  if (live && live !== rt) console.warn('[stage-bus] a second cutscene runtime replaced one that was still published')
  live = rt
  announce()
  return () => {
    if (live !== rt) return
    live = null
    announce()
  }
}

export const liveRuntime = () => live

export function onRuntime(fn: (rt: CutsceneRuntime | null) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
