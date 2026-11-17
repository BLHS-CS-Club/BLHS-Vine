/* Turns logged events into one row of numbers per participant, for the teacher's export. */

/**
 * The envelope the client sends (LogEnvelope in src/vine/events.ts). Read it carefully, because
 * these rows come from a database and may come from an older build than this code.
 */
export type StoredEvent = {
  participantId: string | null
  sessionId: string | null
  at: string | number | Date
  payload: unknown
}

export type Measures = {
  participantId: string
  /** The arm exactly as the envelope carried it. The envelope is the one place it can't get lost. */
  arm: string | null
  events: number
  sessions: number
  firstAt: number | null
  lastAt: number | null
  /**
   * Clock time from the first event to the last. It includes breaks, so use activeMs for time on
   * task.
   */
  spanMs: number
  /**
   * Time on task: the gaps between back-to-back events in one session, each one capped at
   * IDLE_CAP_MS, added up.
   */
  activeMs: number
  /** How many heartbeats arrived. Zero means this run's length is only a guess. */
  heartbeats: number
  beatsCompleted: number
  /**
   * The average of the grade that was kept. That's the better of two tries, and it's the student's
   * own number.
   */
  meanGrade: number | null
  /**
   * The average of the first try only. It's the number the study uses, and it can be different from
   * meanGrade.
   */
  meanFirstGrade: number | null
  checksAnswered: number
  checksCorrect: number
  /** The highest try number any question on this run reached. 1 means no retakes. */
  maxTries: number
  retakes: number
  placesSeen: number
  programmesCompleted: number
  /**
   * How many times a member's island or the engine threw an error. Failures are counted because if
   * one arm fails more than the other, that would look like a real difference unless somebody
   * counts them.
   */
  failures: number
  /* Events this code didn't recognize. They get counted instead of quietly thrown away. */
  unknown: number
  /** Captain and dev sessions are sent for debugging and left out of a study export. */
  dev: boolean
}

/* The longest gap between two events that can still count as time on task. */
export const IDLE_CAP_MS = 60_000

/**
 * Turns a stored row's time into milliseconds, whatever the database driver gave back. api/_dose.ts
 * reads the same rows and uses this too, so the two files can't disagree about a timezone.
 */
export const atMs = (v: string | number | Date): number => {
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* Every event name this code handles. Anything else is counted as unknown instead of dropped, so if
 * the client renames an event it shows up as a number in a column, and a measure doesn't quietly
 * drop to zero. */
const KNOWN = new Set([
  'heartbeat', 'core_beat_complete', 'retake_used', 'check_answered',
  'place_seen', 'programme_completed', 'island_failed', 'engine_error',
  'fx_missing', 'audio_missing', 'stage_call_missing', 'stage_actor_missing',
  'trigger_unanswered',
])

/**
 * The envelope as it sits inside a row's jsonb payload. It's exported because api/_dose.ts reads
 * the same fields from the same rows.
 */
export type Env = {
  participantId?: string
  mode?: string
  dev?: boolean
  eid?: string
  event?: { type?: string; name?: string; at?: number; data?: Record<string, unknown> }
}

/**
 * Gets the event's name whatever shape it came in. A vine event has `name`. A narrowly typed grape
 * event has `type` and no name.
 */
export function eventName(e: Env): string {
  const ev = e.event
  if (!ev) return ''
  return ev.type === 'game' ? String(ev.name ?? '') : String(ev.type ?? '')
}

/* When the event happened on the client. That can be different from when its row was written. */
const whenOf = (row: StoredEvent): number => {
  const at = (row.payload as Env | null)?.event?.at
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : atMs(row.at)
}

/* Adds everything up per participant. Duplicates are dropped by `eid` first, because the queue
 * survives the page closing in the middle of a POST and a batch can get sent twice. */
export function summarise(rows: StoredEvent[]): Measures[] {
  const seenEid = new Set<string>()
  const byPid = new Map<string, {
    m: Measures
    lastInSession: Map<string, number>
    grades: number[]
    firstGrades: number[]
    places: Set<string>
    programmes: Set<string>
    sessions: Set<string>
  }>()

  const ordered = [...rows].sort((a, b) => whenOf(a) - whenOf(b))

  for (const row of ordered) {
    const env = (row.payload ?? {}) as Env
    if (env.eid) {
      if (seenEid.has(env.eid)) continue
      seenEid.add(env.eid)
    }
    const pid = env.participantId ?? row.participantId
    if (!pid) continue
    const at = whenOf(row)
    const sid = row.sessionId ?? 'no-session'

    let bucket = byPid.get(pid)
    if (!bucket) {
      bucket = {
        m: {
          participantId: pid, arm: env.mode ?? null, events: 0, sessions: 0,
          firstAt: null, lastAt: null, spanMs: 0, activeMs: 0, heartbeats: 0,
          beatsCompleted: 0, meanGrade: null, meanFirstGrade: null,
          checksAnswered: 0, checksCorrect: 0, maxTries: 1, retakes: 0,
          placesSeen: 0, programmesCompleted: 0, failures: 0, unknown: 0, dev: false,
        },
        lastInSession: new Map(), grades: [], firstGrades: [],
        places: new Set(), programmes: new Set(), sessions: new Set(),
      }
      byPid.set(pid, bucket)
    }
    const { m } = bucket
    m.events++
    /* The arm comes in on the envelope, and the last one seen wins. */
    if (env.mode) m.arm = env.mode
    if (env.dev) m.dev = true
    bucket.sessions.add(sid)
    if (m.firstAt === null || at < m.firstAt) m.firstAt = at
    if (m.lastAt === null || at > m.lastAt) m.lastAt = at

    const prev = bucket.lastInSession.get(sid)
    if (prev !== undefined) m.activeMs += Math.min(Math.max(0, at - prev), IDLE_CAP_MS)
    bucket.lastInSession.set(sid, at)

    const name = eventName(env)
    const d = env.event?.data ?? {}
    if (name === 'heartbeat') m.heartbeats++
    if (name === 'core_beat_complete') {
      m.beatsCompleted++
      const g = num(d.grade); if (g !== null) bucket.grades.push(g)
      const fg = num(d.firstGrade) ?? num(d.grade); if (fg !== null) bucket.firstGrades.push(fg)
      const t = num(d.tries); if (t !== null) m.maxTries = Math.max(m.maxTries, t)
    }
    if (name === 'retake_used') m.retakes++
    if (name === 'check_answered') {
      m.checksAnswered++
      if (d.correct === true) m.checksCorrect++
      const t = num(d.tries); if (t !== null) m.maxTries = Math.max(m.maxTries, t)
    }
    /* Places seen and programmes completed are two separate counts. */
    if (name === 'place_seen' && typeof d.place === 'string') bucket.places.add(d.place)
    if (name === 'programme_completed' && typeof d.programme === 'string') bucket.programmes.add(d.programme)
    if (name === 'island_failed' || name === 'engine_error') m.failures++
    /* When the stage can't do something, that's a failure too. Examples are fx with no library,
     * audio with no sound system, or a stage call this scene has no answer for. */
    if (name === 'fx_missing' || name === 'audio_missing' || name === 'stage_call_missing'
      || name === 'stage_actor_missing' || name === 'trigger_unanswered') m.failures++
    if (!KNOWN.has(name)) m.unknown++
  }

  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null)
  const out: Measures[] = []
  for (const b of byPid.values()) {
    b.m.sessions = b.sessions.size
    b.m.spanMs = b.m.firstAt !== null && b.m.lastAt !== null ? b.m.lastAt - b.m.firstAt : 0
    b.m.meanGrade = mean(b.grades)
    b.m.meanFirstGrade = mean(b.firstGrades)
    b.m.placesSeen = b.places.size
    b.m.programmesCompleted = b.programmes.size
    out.push(b.m)
  }
  return out.sort((a, b) => a.participantId.localeCompare(b.participantId))
}

/* The export's columns, listed once so the header and the rows can't get out of sync. Everything
 * after `verification` comes from the events table instead of the browser's own state. */
export const EXPORT_COLUMNS = [
  'handle', 'arm', 'joined', 'last_seen', 'year', 'beat', 'graduated', 'verification',
  'sessions', 'events', 'heartbeats', 'active_minutes', 'span_minutes',
  'beats_completed', 'mean_grade', 'mean_first_grade',
  'checks_answered', 'checks_correct', 'max_tries', 'retakes',
  'places_seen', 'programmes_completed', 'failures', 'unknown_events', 'dev_session',
] as const

export type RosterLike = {
  handle: string; arm: string; created_at: string; last_seen: string | null
  year: string; beat: string; graduated?: boolean; code?: string | null
  participantId?: string
}

const minutes = (v: number) => Math.round(v / 600) / 100

/**
 * One row for every participant on the roster, even if they never logged an event. A student whose
 * network blocked the upload still has to show up, with zeros.
 */
export function exportRows(roster: RosterLike[], measures: Measures[]): (string | number)[][] {
  const byPid = new Map(measures.map((m) => [m.participantId, m]))
  return roster.map((r) => {
    const m = r.participantId ? byPid.get(r.participantId) : undefined
    return [
      r.handle, r.arm, r.created_at, r.last_seen ?? '', r.year, r.beat,
      r.graduated ? 'yes' : '', r.code ?? '',
      m?.sessions ?? 0, m?.events ?? 0, m?.heartbeats ?? 0,
      m ? minutes(m.activeMs) : 0, m ? minutes(m.spanMs) : 0,
      m?.beatsCompleted ?? 0, m?.meanGrade ?? '', m?.meanFirstGrade ?? '',
      m?.checksAnswered ?? 0, m?.checksCorrect ?? 0, m?.maxTries ?? '', m?.retakes ?? 0,
      m?.placesSeen ?? 0, m?.programmesCompleted ?? 0, m?.failures ?? 0, m?.unknown ?? 0,
      m?.dev ? 'yes' : '',
    ]
  })
}
