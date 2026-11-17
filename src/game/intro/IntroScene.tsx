import { useCallback, useEffect, useRef, useState } from 'react'
import BeachIso, { type BeachStage } from '../BeachIso'
import { CutsceneRuntime } from '../cutscene/runtime'
import { CutsceneOverlay } from '../cutscene/CutsceneOverlay'
import { introI1I2 } from './introScript'
import { I3Session } from './I3Session'
import { loadSave, writeSave } from '../save'
// Don't clear the save for ?fresh=1 in this file. main.tsx handles it once at boot, and only for
// dev or captain, so a real player's run never gets erased.
import { track } from '../telemetry'
import { GearButton, SettingsPanel } from '../../app/SettingsPanel'
import { Hud } from '../hud/Hud'
import { HelpButton } from '../hud/Help'
import { useNav } from '../../app/SceneManager'
import { SEA_ARRIVAL, enterMap } from '../pmap/route'
import { warmMap } from '../pmap/warm'
import { setCinema } from '../stage/cinema'

// The intro plays on the beach itself, with the cutscene runtime running on the Pixi clock.

export default function IntroScene() {
  const [rt, setRt] = useState<CutsceneRuntime | null>(null)
  const live = useRef<CutsceneRuntime | null>(null)
  const [, bump] = useState(0)
  const nav = useNav()
  const navRef = useRef(nav)
  useEffect(() => { navRef.current = nav }, [nav])
// An unfinished intro always plays again. This black cover stays up until the script's own fade
// starts.
  const willPlayIntro = useRef(!loadSave()?.introDone)
  const [preCover, setPreCover] = useState(willPlayIntro.current)

  // BeachIso calls this once each time it boots, and StrictMode mounts twice in dev. So each call
  // makes a fresh runtime and replaces the old one, which is tied to a stage that's already
  // destroyed.
  const onStage = useCallback((stage: BeachStage) => {
    const runtime = new CutsceneRuntime(stage)
    stage.onTick((ms) => runtime.tick(ms))
    live.current = runtime
    setRt(runtime)
    // While the cutscene is in control, the beach turns off its clickable things.
    runtime.subscribe(() => stage.call('setHeld', { on: runtime.ui.active }))
    // An unfinished intro always replays the script, and the saved name and choices skip past I-3.
    // The free-roam beach has no way to reach the ship, so a run dropped there partway through the
    // intro would be stuck for good.
    const save = loadSave()
    if (!save?.introDone) {
      track('cutscene_start', { id: 'intro' })
      runtime.play(introI1I2, () => {
        /* The beach part is over. Mark the intro done and send the ship to the hub. */
        writeSave({ beat: 'sea:arrive', introDone: true })
        track('cutscene_complete', { id: 'intro-beach-act' })
        track('sail_started')
        /* Always change the address and the scene together, through enterMap. PmapScene reads where
         * to go from the URL when it mounts, and route.ts explains more. */
        const go = navRef.current?.go
        /* Turn the movie bars on before the cover lifts, so the corner never flashes. */
        setCinema(true)
        if (go) enterMap(go, SEA_ARRIVAL, { kind: 'scene', image: '/art/ui/loading-islands.png', title: 'THE BLHS ISLANDS', holdMs: 2600 })
      })
      /* Load the hub's map in the background while the player is still on the beach. */
      void warmMap(SEA_ARRIVAL.map)
      // Pass the black screen from this cover to the script's own fade so there's no gap.
      window.setTimeout(() => setPreCover(false), 400)
    } else {
      setPreCover(false)
    }
  }, [])

  useEffect(() => rt?.subscribe(() => bump((v) => v + 1)), [rt])

  const uiGate = rt?.ui.uiGate?.id ?? null

  // A student coming back at beat intro:i4 already filled in the parchment. The I-3 gate finishes
  // on its own from the save instead of asking again, and the replay skips ahead to the walk to the
  // port.
  useEffect(() => {
    if (uiGate !== 'i3-session' || !rt) return
    const s = loadSave()
    if (s && !s.introDone && s.beat === 'intro:i4' && s.handle) rt.resolveUi('i3-session')
  }, [uiGate, rt])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [blurred, setBlurred] = useState(false)
  const inCutscene = rt?.ui.active ?? false

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', inset: 0 }} className={blurred ? 'hud-blur' : undefined}>
        <BeachIso onStage={onStage} />
      </div>
      {rt && (
        <CutsceneOverlay rt={rt}>
          {uiGate === 'set-sail' && (
            <div className="i5-setsail">
              <button
                className="i3-plank i5-plank"
                onClick={() => { track('sail_confirmed'); rt.resolveUi('set-sail') }}
              >Set Sail</button>
            </div>
          )}
          {uiGate === 'i3-session' && (
            <I3Session
              onDone={(r) => {
                // Save castaway too, because net.ts uses it to keep demo runs local.
                writeSave({ handle: r.handle, pronouns: r.pronouns, boatName: r.boatName, thorLook: r.thorLook, castaway: r.castaway, beat: 'intro:i4' })
                rt.resolveUi('i3-session')
              }}
            />
          )}
        </CutsceneOverlay>
      )}
      {/* Outside the cutscene the player gets the real HUD and the pause menu. The gear button
        * stays too, where players expect it. */}
      {!inCutscene && <Hud onBlurWorld={setBlurred} />}
      {/* The help button stays during the cutscene, since that's when players need it. */}
      <HelpButton />
      {!inCutscene && <GearButton onClick={() => setSettingsOpen(true)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {preCover && <div style={{ position: 'absolute', inset: 0, background: '#05070a', zIndex: 60 }} />}
    </div>
  )
}
