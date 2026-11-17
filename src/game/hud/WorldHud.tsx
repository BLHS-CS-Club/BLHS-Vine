import { useEffect, useRef, useState } from 'react'
import { Hud } from './Hud'
import { Dialogue } from './Dialogue'
import { WorldCutscene } from '../cutscene/WorldCutscene'
import { PlaceCard } from '../stage/PlaceCard'
import { MovieBars } from '../stage/MovieBars'
import { SkipVoyage } from '../world/SkipVoyage'
import { ObjectivePanel } from './Objective'
import { HeadBack } from './HeadBack'
import { HelpButton } from './Help'
import { ChartButton } from '../world/ChartPanel'
import { CameraToggle } from './CameraToggle'
import { loadSave, subscribeSave } from '../save'
import { useNav } from '../../app/SceneManager'
import { holdWorld } from '../world-bus'
import { warmPortraits } from '../ui/controls'

// The scenes this HUD shows up over. The beach isn't listed because IntroScene mounts its own Hud,
// so it can step aside for the intro cutscene.
const WORLD_SCENES = new Set(['pmap'])

export function WorldHud() {
  const { current } = useNav()
  const [, bump] = useState(0)
  useEffect(() => subscribeSave(() => bump((v) => v + 1)), [])
  /* Load the one drawn portrait before anybody talks. It happens here and not in the dialogue box,
   * because by the time the box mounts, its line is already on screen. */
  useEffect(() => { warmPortraits() }, [])
  const s = loadSave()

  /* The control lock. While a panel is open the world is held, so the character stops walking. */
  const release = useRef<null | (() => void)>(null)
  const blurWorld = (on: boolean) => {
    if (on) release.current ??= holdWorld('hud:panel')
    else { release.current?.(); release.current = null }
  }
  useEffect(() => () => { release.current?.(); release.current = null }, [])

  const inWorld = WORLD_SCENES.has(current)
  if (!inWorld) return null

  /* Some of this mounts from the first frame, and some waits until there's a run. */
  return (
    <>
      {s?.introDone && <Hud onBlurWorld={blurWorld} />}
      {/* Dialogue is mounted over every world scene, so `say` and `choose` work from any painted
        * map without the map knowing about React. */}
      <Dialogue />
      {/* The cutscene pieces are mounted over every world scene too, so a script can play anywhere. */}
      <WorldCutscene />
      {/* The arrival card lives here and not inside the scene. Going through a door tears the scene
        * down and rebuilds it, so a card inside the scene would flicker. */}
      <PlaceCard />
      {/* The one sentence telling the player what to do next, on every world scene. */}
      <ObjectivePanel />
      {/* The way back home, which an island shows once it has nothing left to ask for. It comes
        * before the movie bars in this list on purpose, so the bars cover it during a cutscene. */}
      <HeadBack />
      {/* The question mark. It sits outside the Hud's check, so a student without a run can still
        * get help. */}
      <HelpButton />
      {/* The chart button, on its own, right above the help button. */}
      <ChartButton />
      {/* The camera switch, alone in the other corner. */}
      <CameraToggle />
      {/* The movie bars come last so they draw on top of the other HTML pieces, which all step back
        * behind them. They draw nothing until an island calls `movie(True)`. */}
      <MovieBars />
      {/* The skip button for a voyage, drawn on top of the bars. */}
      <SkipVoyage />
    </>
  )
}
