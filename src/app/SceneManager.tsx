import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  cover, subscribeTransition, transitionState, transitionVersion, TransitionOverlay,
  type TransitionSpec,
} from './transitions'
import { setContext, startHeartbeat, track } from '../game/telemetry'
import { CLAIM_BEAT_MS, PLAYING_SCENES, claimPlaying, markTabLive, releasePlaying } from './entry'

// Scenes register by id, and every scene change goes through one covered transition.

export type SceneRegistry = Record<string, () => ReactNode>

type Nav = { go: (to: string, spec?: TransitionSpec) => void; current: string }
const NavCtx = createContext<Nav | null>(null)
export function useNav() {
  const c = useContext(NavCtx)
  if (!c) throw new Error('useNav must be used inside <SceneManager>')
  return c
}

/** Gives back the navigator if there is one, or null if not, so a caller can work without it. */
export function useNavMaybe(): Nav | null {
  return useContext(NavCtx)
}

export function SceneManager({ initial, registry, overlay }: { initial: string; registry: SceneRegistry; overlay?: ReactNode }) {
  const [current, setCurrent] = useState(initial)
  /* The transition state lives at module scope, so this only re-renders the overlay. */
  const [, setTrVersion] = useState(0)
  useEffect(() => subscribeTransition(() => setTrVersion(transitionVersion())), [])

  const go = useCallback((to: string, spec?: TransitionSpec) => {
    if (to === current) return
    if (!registry[to]) { console.warn('SceneManager: scene not registered:', to); return }
    void cover(spec ?? { kind: 'fade' }, () => {
      setCurrent(to)
      // Give the new scene two frames to mount before the cover lifts.
      return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    })
  }, [current, registry])

  const nav = useMemo<Nav>(() => ({ go, current }), [go, current])
  const Scene = registry[current]

  /* Start the run's clock once, here, because this component stays mounted through every scene. */
  useEffect(() => { startHeartbeat() }, [])
  useEffect(() => {
    setContext({ scene: current })
    track('scene_shown', { scene: current })
    /* Mark this tab as the one playing the run, so a refresh mid-play comes back to the same map. */
    markTabLive()
  }, [current])

  /* Only one tab holds the run. A playing scene renews a claim in localStorage every few seconds,
   * and leaving the world gives it up right away. The title reads the claim because both tabs write
   * the whole save on every change, so the older copy could overwrite the newer one and lose a
   * class without any warning. */
  useEffect(() => {
    if (!PLAYING_SCENES.has(current)) { releasePlaying(); return }
    claimPlaying()
    const beat = window.setInterval(claimPlaying, CLAIM_BEAT_MS)
    return () => { window.clearInterval(beat); releasePlaying() }
  }, [current])

  return (
    <NavCtx.Provider value={nav}>
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#06121a' }}>
        {Scene ? Scene() : null}
        {/* UI that belongs to no scene (the world HUD) sits above the scene and below the covers. */}
        {overlay}
        <TransitionOverlay st={transitionState()} version={transitionVersion()} />
      </div>
    </NavCtx.Provider>
  )
}
