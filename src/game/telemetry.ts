import { Logger } from '../vine/logging'
import { loadSave, subscribeSave } from './save'
import { isCaptain } from './captain'

// One logger shared by the whole front end. Its participant id follows whatever save is loaded.

function anonId(key: string) {
  let v = localStorage.getItem(key)
  if (!v) { v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem(key, v) }
  return v
}

const logger = new Logger({
  appVersion: import.meta.env?.VITE_APP_VERSION ?? 'dev',
  sessionId: Math.random().toString(36).slice(2, 10),
  participantId: anonId('blhs_anon_id'),
  mode: 'game',
  /* Logs go to the same endpoint in dev and in production, so time on task can be checked in both. */
  endpoint: import.meta.env?.VITE_LOG_ENDPOINT ?? '/api/log',
})

function syncIdentity() {
  const s = loadSave()
  logger.setIdentity({
    participantId: s?.participantId ?? anonId('blhs_anon_id'),
    mode: 'game',
    dev: isCaptain(),
    localOnly: !!s?.castaway,
  })
}
syncIdentity()
subscribeSave(syncIdentity)

export function track(name: string, data?: Record<string, unknown>) {
  logger.log({ type: 'game', name, data, grapeId: 'vine', at: Date.now() })
}

/* The heartbeat: one log event every fifteen seconds while the tab is visible, to measure time on
 * task. */
const HEARTBEAT_MS = 15_000

let where: Record<string, unknown> = {}

/** What the student is looking at. It's added to every heartbeat until it changes. */
export function setContext(next: Record<string, unknown>) {
  where = { ...where, ...next }
}

let timer = 0
let onVisible: (() => void) | null = null

export function startHeartbeat() {
  if (timer) return
  const beat = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    track('heartbeat', { ...where, everyMs: HEARTBEAT_MS })
  }
  timer = window.setInterval(beat, HEARTBEAT_MS)
  /* Send a heartbeat right away when the tab becomes visible again. */
  onVisible = () => { if (document.visibilityState === 'visible') beat() }
  document.addEventListener('visibilitychange', onVisible)
  beat()
}

export function stopHeartbeat() {
  if (timer) { window.clearInterval(timer); timer = 0 }
  /* Remove the listener along with the timer. Otherwise a stopped heartbeat would still fire when
   * the player comes back to the tab. */
  if (onVisible) { document.removeEventListener('visibilitychange', onVisible); onVisible = null }
}
