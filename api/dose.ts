// Turns a class's heartbeats into how long each student was really in the game.
import { json, readBody } from './_db.js'
import { store } from './_store.js'
import { dose, doseMinutes, gapCapMs, HEARTBEAT_MS } from './_dose.js'
import { summarise } from './_summary.js'

export default async function handler(req: any, res: any) {
  const db = store()
  if (!db) return json(res, 503, { offline: true })

  let q: Record<string, string> = {}
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x')
    for (const [k, v] of url.searchParams) q[k] = v
  } else if (req.method === 'POST') {
    const body = (await readBody(req)) as Record<string, unknown>
    q = Object.fromEntries(Object.entries(body ?? {}).map(([k, v]) => [k, String(v ?? '')]))
  } else {
    return json(res, 405, { error: 'method' })
  }

  const cls = await db.getClassByKey(String(q.classId ?? ''), String(q.teacherKey ?? ''))
  if (!cls) return json(res, 403, { error: 'bad_key' })

  const events = await db.readEvents(cls.id)
  const report = dose(events)
  /* Also work out the time from every event, next to the heartbeat time, so each can be checked
   * against the other. */
  const byPid = new Map(summarise(events).map((m) => [m.participantId, m]))

  /* Look up the handle here, so the participant id never leaves the server. */
  const handles = new Map((await db.roster(cls.id)).map((r) => [r.participant_id ?? '', r.handle]))
  const want = String(q.handle ?? '').toLowerCase()

  const participants = report.participants
    .map(({ participantId, ...p }) => ({
      ...p,
      handle: handles.get(participantId) ?? null,
      onTaskMinutes: doseMinutes(p.onTaskMs),
      awayMinutes: doseMinutes(p.awayMs),
      /** The same run timed from every event instead of from heartbeats. */
      allEventsActiveMs: byPid.get(participantId)?.activeMs ?? 0,
    }))
    .filter((p) => !want || (p.handle ?? '').toLowerCase() === want)

  return json(res, 200, {
    class: { name: cls.name, code: cls.code, studyMode: cls.study_mode },
    /* The two numbers the dose math depends on. They're in the response so a reviewer can see what
     * it assumed. */
    cadenceMs: HEARTBEAT_MS,
    gapCapMs: gapCapMs(),
    /* The raw heartbeat count. It tells an empty class apart from a class whose heartbeats never
     * got sent. */
    beatRows: report.beatRows,
    eventRows: events.length,
    totals: report.totals,
    participants,
  })
}
