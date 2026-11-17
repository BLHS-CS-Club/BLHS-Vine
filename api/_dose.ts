/* Works out the dose: how long a student was really looking at the game, added up from heartbeats. */
import { atMs, eventName, type Env, type StoredEvent } from './_summary.js'

/* How often the game sends a heartbeat. The same number lives in src/game/telemetry.ts, because the
 * client can't import from the api. */
export const HEARTBEAT_MS = 15_000

/* The biggest gap between beats, measured in heartbeats, that still counts as the student being
 * there. */
export const GAP_INTERVALS = 2.5
export const gapCapMs = (everyMs = HEARTBEAT_MS) => Math.round(everyMs * GAP_INTERVALS)

/**
 * The ways a dose can be split up. Every beat carries these keys through `setContext`: PmapScene
 * stamps `map` and the SceneManager stamps `scene`.
 */
export type DoseCut = 'map' | 'scene' | 'place' | 'session'

export type DoseSlice = {
  key: string
  onTaskMs: number
  beats: number
}

export type ParticipantDose = {
  /**
   * The handle, filled in by the endpoint. The math here keys on the participant id, and the
   * endpoint swaps in the handle because a participant id never leaves a handler in this api.
   */
  handle?: string
  participantId: string
  arm: string | null
  dev: boolean
  /** Heartbeats counted, after duplicate batches are dropped. */
  beats: number
  sessions: number
  /**
   * The main number: the gaps between back-to-back beats in one run, added up. Only gaps no longer
   * than the cap count.
   */
  onTaskMs: number
  /** The gaps longer than the cap, added up. Each one means the student walked away. */
  awayMs: number
  /**
   * How many times the student walked away. A run with breaks is different from a run of the same
   * length without them, and the export needs to tell them apart.
   */
  breaks: number
  firstAt: number | null
  lastAt: number | null
  /**
   * Time from the first beat to the last. This isn't the dose. It's here so the two can be
   * compared.
   */
  spanMs: number
  byMap: DoseSlice[]
  byScene: DoseSlice[]
  bySession: DoseSlice[]
  /** How many of these sessions were timed with the server's clock instead of the client's. */
  serverClocked: number
}

export type DoseReport = {
  /**
   * How many heartbeat rows were read. It tells "no rows came in" apart from "rows came in and
   * added up to nothing", which look the same in a table.
   */
  beatRows: number
  cadenceMs: number
  gapCapMs: number
  participants: ParticipantDose[]
  totals: { participants: number; beats: number; onTaskMs: number; awayMs: number; breaks: number }
}

type Beat = {
  /** The time the client stamped on the beat. Very old rows don't have one. */
  client: number | null
  /** When the server wrote the row. That can be different from when the beat was sent. */
  server: number
  everyMs: number
  map: string | null
  scene: string | null
  place: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const posNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null

/* Picks which clock times a run. It uses the client's clock if every beat has a client time, and
 * the server's otherwise. */
function pickClock(beats: Beat[]): 'client' | 'server' {
  return beats.every((b) => b.client !== null) ? 'client' : 'server'
}

/**
 * Adds up the dose for each participant. It picks out the heartbeats itself, because the rows
 * passed in can be every event for a whole class.
 */
export function dose(rows: StoredEvent[]): DoseReport {
  const seenEid = new Set<string>()
  const byPid = new Map<string, {
    arm: string | null
    dev: boolean
    sessions: Map<string, Beat[]>
  }>()
  let beatRows = 0

  for (const row of rows) {
    const env = (row.payload ?? {}) as Env
    if (eventName(env) !== 'heartbeat') continue
    /* Skip a beat that was sent twice. The queue can send the same batch again. */
    if (env.eid) {
      if (seenEid.has(env.eid)) continue
      seenEid.add(env.eid)
    }
    const pid = env.participantId ?? row.participantId
    if (!pid) continue
    beatRows++

    let bucket = byPid.get(pid)
    if (!bucket) { bucket = { arm: null, dev: false, sessions: new Map() }; byPid.set(pid, bucket) }
    if (env.mode) bucket.arm = env.mode
    if (env.dev) bucket.dev = true

    const d = env.event?.data ?? {}
    const sid = row.sessionId ?? 'no-session'
    const list = bucket.sessions.get(sid) ?? []
    list.push({
      client: posNum(env.event?.at),
      server: atMs(row.at),
      everyMs: posNum(d.everyMs) ?? HEARTBEAT_MS,
      map: str(d.map), scene: str(d.scene), place: str(d.place),
    })
    bucket.sessions.set(sid, list)
  }

  const participants: ParticipantDose[] = []
  for (const [participantId, b] of byPid) {
    const m: ParticipantDose = {
      participantId, arm: b.arm, dev: b.dev,
      beats: 0, sessions: b.sessions.size, onTaskMs: 0, awayMs: 0, breaks: 0,
      firstAt: null, lastAt: null, spanMs: 0,
      byMap: [], byScene: [], bySession: [], serverClocked: 0,
    }
    const maps = new Map<string, DoseSlice>()
    const scenes = new Map<string, DoseSlice>()
    const places = new Map<string, DoseSlice>()
    const sessions = new Map<string, DoseSlice>()

    for (const [sid, raw] of b.sessions) {
      const clock = pickClock(raw)
      if (clock === 'server') m.serverClocked++
      const time = (x: Beat) => (clock === 'client' ? (x.client as number) : x.server)
      const beats = [...raw].sort((x, y) => time(x) - time(y))
      m.beats += beats.length

      const sSlice: DoseSlice = sessions.get(sid) ?? { key: sid, onTaskMs: 0, beats: 0 }
      sSlice.beats += beats.length
      sessions.set(sid, sSlice)

      for (let i = 0; i < beats.length; i++) {
        const at = time(beats[i])
        if (m.firstAt === null || at < m.firstAt) m.firstAt = at
        if (m.lastAt === null || at > m.lastAt) m.lastAt = at
        /* Count every beat where it happened, even when it doesn't close a gap. That way a map with
         * one beat and no measurable time still shows up with a zero. */
        touch(maps, beats[i].map)
        touch(scenes, beats[i].scene)
        touch(places, beats[i].place)
        if (i === 0) continue

        const gap = at - time(beats[i - 1])
        const cap = gapCapMs(beats[i].everyMs)
        if (gap > cap) { m.awayMs += gap; m.breaks++; continue }
        m.onTaskMs += gap
        /* Give each gap to the beat that ended it, so the slices add up to the exact total. */
        credit(maps, beats[i].map, gap)
        credit(scenes, beats[i].scene, gap)
        credit(places, beats[i].place, gap)
        sSlice.onTaskMs += gap
      }
    }

    m.spanMs = m.firstAt !== null && m.lastAt !== null ? m.lastAt - m.firstAt : 0
    m.byMap = sorted(maps)
    m.byScene = sorted(scenes)
    m.bySession = sorted(sessions)
    participants.push(m)
  }

  participants.sort((a, z) => a.participantId.localeCompare(z.participantId))
  return {
    beatRows,
    cadenceMs: HEARTBEAT_MS,
    gapCapMs: gapCapMs(),
    participants,
    totals: {
      participants: participants.length,
      beats: participants.reduce((n, p) => n + p.beats, 0),
      onTaskMs: participants.reduce((n, p) => n + p.onTaskMs, 0),
      awayMs: participants.reduce((n, p) => n + p.awayMs, 0),
      breaks: participants.reduce((n, p) => n + p.breaks, 0),
    },
  }
}

/* Gets the bucket for one slice key. A beat with no map goes in its own '(none)' bucket so it still
 * shows up. */
const slotFor = (into: Map<string, DoseSlice>, key: string | null): DoseSlice => {
  const k = key ?? '(none)'
  const slice = into.get(k) ?? { key: k, onTaskMs: 0, beats: 0 }
  into.set(k, slice)
  return slice
}

/**
 * Counts one beat here. Counting and adding time are separate calls because two beats at the same
 * moment add zero time, and that zero must not look like no beat at all.
 */
const touch = (into: Map<string, DoseSlice>, key: string | null) => { slotFor(into, key).beats++ }

const credit = (into: Map<string, DoseSlice>, key: string | null, ms: number) => {
  slotFor(into, key).onTaskMs += ms
}

/**
 * Sorts longest time first, because what people want from a dose table is which island kept the
 * student busy the longest.
 */
const sorted = (m: Map<string, DoseSlice>): DoseSlice[] =>
  [...m.values()].sort((a, b) => b.onTaskMs - a.onTaskMs || a.key.localeCompare(b.key))

/**
 * Turns milliseconds into minutes with two decimal places, the unit the exports use. It's the same
 * math as _summary's export columns, kept in one function.
 */
export const doseMinutes = (v: number) => Math.round(v / 600) / 100
