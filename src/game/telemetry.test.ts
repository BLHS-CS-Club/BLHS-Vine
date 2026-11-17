// what the game sends, and that a practice link sends nothing and leaves the shared queue alone
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const QUEUE = 'blhs_log_queue'
const RAW = 'https://raw.githubusercontent.com/BLHS-CS-Club/BLHS-Island-Explorer/main/examples/03-remember/'

/* events another tab of the real player queued and has not sent yet */
const waiting = JSON.stringify([{ schemaVersion: 1, appVersion: 't', sessionId: 's0', participantId: 'p_real', mode: 'game', eid: 'e1', event: { type: 'game', name: 'earlier', grapeId: 'vine', at: 1 } }])

const was = window.location.href
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 } as Response))
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', was)
})

const loadAt = async (search: string) => {
  window.history.replaceState(null, '', `/${search}`)
  vi.resetModules()
  return await import('./telemetry')
}

describe('a practice link', () => {
  it('sends nothing, and the queue it shares with the real tab is byte for byte what it was', async () => {
    localStorage.setItem(QUEUE, waiting)
    const t = await loadAt(`?scene=pmap&map=atc-1&grape=${encodeURIComponent(RAW)}`)
    t.track('scene_shown', { scene: 'pmap' })
    t.track('station_used', { anchor: 'host' })
    t.startHeartbeat()
    /* long past every flush and every heartbeat */
    await vi.advanceTimersByTimeAsync(60_000)
    t.stopHeartbeat()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(QUEUE)).toBe(waiting)
    /* and no anonymous id is minted for a visitor either */
    expect(localStorage.getItem('blhs_anon_id')).toBeNull()
  })
})

describe('everywhere else', () => {
  it('queues every event the way it always has', async () => {
    const t = await loadAt('?scene=pmap&map=atc-1')
    t.track('scene_shown', { scene: 'pmap' })
    const q = JSON.parse(localStorage.getItem(QUEUE)!)
    expect(q.map((e: { event: { name: string } }) => e.event.name)).toContain('scene_shown')
  })

  it('and a same origin island is everywhere else too', async () => {
    const t = await loadAt('?scene=pmap&map=atc-1&grape=%2Fgrapes%2Fatc%2F')
    t.track('scene_shown', { scene: 'pmap' })
    expect(JSON.parse(localStorage.getItem(QUEUE)!)).toHaveLength(1)
  })
})
