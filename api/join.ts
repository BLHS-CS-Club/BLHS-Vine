// Joining a class. GET checks that a code is real, and POST starts a student's run or picks it back
// up.
import { json, readBody } from './_db.js'
import { store } from './_store.js'
import { cleanHandle, newId } from './_logic.js'

export default async function handler(req: any, res: any) {
  const db = store()
  if (!db) return json(res, 503, { offline: true })

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x')
    const code = url.searchParams.get('code')
    if (!code) return json(res, 400, { error: 'code required' })
    const cls = await db.getClassByCode(code.toUpperCase())
    if (!cls) return json(res, 404, { error: 'unknown_code' })
    if (!cls.open) return json(res, 403, { error: 'class_closed' })
    return json(res, 200, { className: cls.name, open: cls.open })
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method' })
  const { code, handle } = (await readBody(req)) as { code?: string; handle?: string }
  if (!code || !handle) return json(res, 400, { error: 'code and handle required' })

  const cls = await db.getClassByCode(code.toUpperCase())
  if (!cls) return json(res, 404, { error: 'unknown_code' })

  const clean = cleanHandle(handle)

  // One student gets one run, so the same handle in the same class means that student is coming
  // back. This check comes before the open check on purpose. Closing a class stops new joins, but
  // it must never lock out a student who's in the middle of a run.
  const existing = await db.getParticipantByHandle(cls.id, clean)
  if (existing) {
    return json(res, 200, {
      participantId: existing.id, classId: cls.id, className: cls.name,
      handle: existing.handle, returning: true,
    })
  }

  if (!cls.open) return json(res, 403, { error: 'class_closed' })

  // This is a new participant. If someone grabbed the handle at the same moment, or two students
  // really share it, try it with a number on the end: 2, 3, then 4.
  for (let attempt = 0; attempt < 4; attempt++) {
    const finalHandle = attempt === 0 ? clean : `${clean}${1 + attempt}`
    const participantId = newId('p')
    /* The arm column is still filled in because the rows already in the database have it. Students
     * aren't split into two arms anymore. */
    const r = await db.insertParticipant({ id: participantId, class_id: cls.id, handle: finalHandle, arm: 'game' })
    if (r === 'ok') {
      return json(res, 200, { participantId, classId: cls.id, className: cls.name, handle: finalHandle })
    }
  }
  return json(res, 500, { error: 'join_failed' })
}
