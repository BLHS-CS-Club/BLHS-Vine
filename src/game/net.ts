// Talks to the server: joining a class, syncing the save, and sending the event log.

import { loadSave, writeSave, type SaveGame } from './save'
import { isCaptain } from './captain'

// The participant id is stored on the current save, one per run. Sync and logging read it from
// there, not from a key shared by the whole device.
export function participantId(): string | null { return loadSave()?.participantId ?? null }

export type JoinResult =
  | { ok: true; participantId: string; className?: string; handle?: string; returning?: boolean }
  | { ok: false; reason: 'offline' | 'unknown_code' | 'class_closed' | 'error' }

export type CheckResult =
  | { ok: true; className?: string }
  | { ok: false; reason: 'offline' | 'unknown_code' | 'class_closed' | 'error' }

/** Checks a class code and gets the class name, without creating a participant. */
export async function checkClass(code: string): Promise<CheckResult> {
  if (isCaptain()) return { ok: true, className: "the Captain's own class" }
  try {
    const r = await fetch(`/api/join?code=${encodeURIComponent(code)}`)
    if (r.status === 503) return { ok: false, reason: 'offline' }
    if (r.status === 404) return { ok: false, reason: 'unknown_code' }
    if (r.status === 403) return { ok: false, reason: 'class_closed' }
    if (!r.ok) return { ok: false, reason: 'error' }
    const d = await r.json()
    return { ok: true, className: d.className }
  } catch {
    return { ok: false, reason: 'offline' }
  }
}

/* Whether there's a class server to join. It asks once and remembers the answer until the page
 * reloads. */
let classesLive: boolean | null = null
export async function classesAreOpen(): Promise<boolean> {
  if (classesLive !== null) return classesLive
  if (isCaptain()) { classesLive = true; return true }
  try {
    const r = await fetch('/api/join?code=', { method: 'GET' })
    /* A JSON reply means a real server answered. Anything else is the game's own page coming back. */
    const ct = r.headers.get('content-type') ?? ''
    classesLive = r.status !== 503 && ct.includes('json')
  } catch {
    classesLive = false
  }
  return classesLive
}

/** Lets the browser proofs and the tests ask the server again. */
export function forgetClassProbe() { classesLive = null }

export async function joinClass(code: string, handle: string): Promise<JoinResult> {
  if (isCaptain()) {
    // The captain pass gets into any class without asking the server.
    writeSave({ participantId: 'captain', classCode: code.toUpperCase() })
    return { ok: true, participantId: 'captain', className: "the Captain's own class" }
  }
  try {
    const r = await fetch('/api/join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, handle }),
    })
    if (r.status === 503) return { ok: false, reason: 'offline' }
    if (r.status === 404) return { ok: false, reason: 'unknown_code' }
    if (r.status === 403) return { ok: false, reason: 'class_closed' }
    if (!r.ok) return { ok: false, reason: 'error' }
    const d = await r.json()
    writeSave({ participantId: d.participantId, classCode: code.toUpperCase(), handle: d.handle ?? handle })
    return { ok: true, participantId: d.participantId, className: d.className, handle: d.handle ?? handle, returning: d.returning }
  } catch {
    return { ok: false, reason: 'offline' }
  }
}

// ---- state sync: push save writes after a short pause, pull on boot for other devices ----
let pushTimer: number | null = null
// Once the server answers 503 offline, stop pushing for the rest of this page load. Every push
// after that would fail too.
let stateOffline = false
export function startStateSync() {
  const push = () => {
    if (stateOffline) return
    const pid = participantId()
    const s = loadSave()
    // Demo runs stay local. Captain runs stay local even on a real joined save, because
    // cheat-edited state must never sync into a student's run on the server.
    if (!pid || pid === 'captain' || isCaptain() || !s || s.castaway) return
    void fetch('/api/state', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantId: pid, save: s }),
      keepalive: true,
    }).then((r) => { if (r.status === 503) stateOffline = true })
      .catch(() => { /* Offline: the local save is still the real one. */ })
  }
  // save.ts fires on every write. Wait for a pause so a burst of writes becomes one POST.
  import('./save').then(({ subscribeSave }) => {
    subscribeSave(() => {
      if (pushTimer !== null) clearTimeout(pushTimer)
      pushTimer = window.setTimeout(push, 1500)
    })
  })
  window.addEventListener('pagehide', push)
}

export async function pullState(): Promise<boolean> {
  const pid = participantId()
  if (!pid || pid === 'captain' || isCaptain()) return false
  try {
    const r = await fetch(`/api/state?participantId=${encodeURIComponent(pid)}`)
    if (!r.ok) return false
    const d = await r.json()
    const local = loadSave()
    // The newer save wins, so a Chromebook that was asleep for a week doesn't overwrite newer
    // progress.
    if (d.save && (!local || (d.save.savedAt ?? 0) > (local.savedAt ?? 0))) {
      writeSave(d.save as Partial<SaveGame>)
      return true
    }
  } catch { /* Offline. */ }
  return false
}
