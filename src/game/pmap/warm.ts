/* Downloads a map's files into the browser cache ahead of time, so opening the map later is quick. */
import { mapvisHost } from '../world/composition'

/* The files a painted map opens with, biggest first. `atlas.png` is 338 KB on the hub and
 * `assets.json` is next, so even a warm-up that only gets halfway saves the most time. */
const FILES = [
  'atlas.png', 'assets.json', 'scene.png', 'map.json',
  'levels.png', 'atlas.json', 'occluders.png',
]

/* Try each map only once per page. A second try would download files the first one already got. */
const asked = new Set<string>()

/** How many bytes the warm-ups have downloaded on this page. It's only for the debug line. */
let warmed = 0

export const warmedBytes = () => warmed

/**
 * Asks the browser to download a published map's files. It never throws, and false means there was
 * nothing to do.
 */
export async function warmMap(mapId: string): Promise<boolean> {
  if (!mapId || asked.has(mapId)) return false
  asked.add(mapId)
  /* Only warm up from the platform when the page has ?src=platform. Otherwise the map comes from
   * the game's own copy on the same server, which is already fast. */
  const platform = typeof location !== 'undefined' && new URLSearchParams(location.search).get('src') === 'platform'
  const host = platform ? mapvisHost() : ''
  if (!host) return false
  try {
    const man = await fetch(`${host}/api/v1/maps/${encodeURIComponent(mapId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    const dir = `${host}/api/v1/maps/${encodeURIComponent(mapId)}/file/${man.version}`
    /* Download one file at a time, biggest first, so the scene that's running doesn't stutter. */
    for (const f of FILES) {
      const r = await fetch(`${dir}/${f}`).catch(() => null)
      if (r?.ok) warmed += Number(r.headers.get('content-length') || 0)
    }
    /* The art for each placement isn't downloaded here on purpose. `assets.json` lists those files
     * and there can be dozens, while the atlas is what the first frame needs. */
    console.info(`[warm] ${mapId} v${man.version} pulled ahead of the door`)
    return true
  } catch {
    /* Not published, no platform, offline or a blocked network all mean the same thing here. The
     * door opens at normal speed and nothing is broken. */
    return false
  }
}
