import type { GrapeEvent, LogEnvelope } from './events'
import type { SessionMode } from './contract'

const SCHEMA_VERSION = 1
const QUEUE_KEY = 'blhs_log_queue'

export interface LoggerIdentity {
  participantId: string
  mode: SessionMode
  /**
   * True for a captain or god-mode session. Its events get sent marked dev:true and are left out of
   * the data exports.
   */
  dev?: boolean
  /**
   * Castaway and demo sessions never send anything, and their queue gets emptied right here in the
   * browser.
   */
  localOnly?: boolean
}

export interface LoggerConfig {
  appVersion: string
  sessionId: string
  participantId: string
  mode: SessionMode
  endpoint?: string
  flushIntervalMs?: number
}

// Events wait in a queue in localStorage and get sent in batches, each stamped with whoever the
// player is right now.
export class Logger {
  private cfg: LoggerConfig
  private identity: LoggerIdentity
  private queue: LogEnvelope[]
  private timer: number
  private inflight = false

  constructor(cfg: LoggerConfig) {
    this.cfg = cfg
    this.identity = { participantId: cfg.participantId, mode: cfg.mode }
    this.queue = loadQueue()
    this.timer = window.setInterval(() => void this.flush(), cfg.flushIntervalMs ?? 5000)
    window.addEventListener('pagehide', () => void this.flush())
  }

  /** Joining a class, or being detected as a captain or castaway, changes who the events belong to. */
  setIdentity(id: Partial<LoggerIdentity>) {
    this.identity = { ...this.identity, ...id }
  }

  log(event: GrapeEvent) {
    this.queue.push({
      schemaVersion: SCHEMA_VERSION,
      appVersion: this.cfg.appVersion,
      sessionId: this.cfg.sessionId,
      participantId: this.identity.participantId,
      mode: this.identity.mode,
      ...(this.identity.dev ? { dev: true } : {}),
      eid: Math.random().toString(36).slice(2, 10),
      event,
    })
    saveQueue(this.queue)
  }

  /** Set once the endpoint says it has no database, so this page stops asking. */
  private offline = false

  async flush() {
    if (this.offline) { this.queue = []; return }
    if (this.queue.length === 0) return
    // Castaway and demo send nothing. Empty the queue anyway so it doesn't grow forever.
    if (this.identity.localOnly) {
      console.debug('[log]', this.queue.length, 'events dropped (demo mode logs nothing)')
      this.queue = []
      saveQueue(this.queue)
      return
    }
    if (!this.cfg.endpoint) {
      console.debug('[log]', this.queue.length, 'events queued (no endpoint)')
      return
    }
    // Only one flush at a time. The 5 second timer and pagehide can both fire together, and two
    // flushes would send the same batch twice.
    if (this.inflight) return
    this.inflight = true
    try {
      // Send in chunks, because a keepalive request body can only be about 64 kibibytes.
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, 100)
        const body = JSON.stringify(batch)
        const res = await fetch(this.cfg.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: body.length < 40_000,
        })
        /* A 503 marked offline means the server has no database right now. */
        if (res.status === 503) {
          const said = await res.json().catch(() => null) as { offline?: boolean } | null
          if (said?.offline) {
            console.info('[log] the study endpoint is offline on this deploy, so nothing is being sent')
            this.offline = true
            this.queue = []
            saveQueue(this.queue)
            break
          }
        }
        if (!res.ok) break
        // Events logged while the fetch was running sit after the batch in the queue. Keep them.
        this.queue = this.queue.slice(batch.length)
        saveQueue(this.queue)
      }
    } catch {
      // The network is down. Keep the queue and try again on the next flush.
    } finally {
      this.inflight = false
    }
  }

  dispose() {
    window.clearInterval(this.timer)
  }
}

function loadQueue(): LogEnvelope[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as LogEnvelope[]) : []
  } catch {
    return []
  }
}

function saveQueue(queue: LogEnvelope[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // Storage isn't available. Drop the queue quietly instead of crashing the game.
  }
}
