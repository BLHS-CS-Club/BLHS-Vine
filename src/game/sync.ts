// Syncs the save with the server when the game boots. It gives back a promise, so the title
// screen's Continue button can wait and read the save the server sent.
import { startStateSync, pullState } from './net'

let started: Promise<boolean> | null = null

export function startSync(): Promise<boolean> {
  if (!started) {
    startStateSync()
    started = pullState().catch(() => false)
  }
  return started
}

/** Resolves when the boot pull finishes or when maxMs has passed, whichever comes first. */
export function syncReady(maxMs = 2500): Promise<void> {
  return Promise.race([
    startSync().then(() => undefined),
    new Promise<void>((r) => setTimeout(r, maxMs)),
  ])
}
