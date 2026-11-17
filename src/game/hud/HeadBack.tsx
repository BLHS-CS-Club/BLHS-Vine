/* The "Island finished. Head back." button. It's part of the game's interface, not the dialogue, so
 * any island that lists its tasks and finishes them all gets this button without the member writing
 * any code for it. */
import { useEffect, useState } from 'react'
import { loadSave, subscribeSave, tasksDoneIn } from '../save'
import { islandForProgramme } from '../roster/roster'
import { islandTaskList, onIslandTasks } from './island-tasks'
import { cinemaOn, onCinema } from '../stage/cinema'
import { dialogueState, onDialogue } from '../dialogue'
import { homeListenerCount, requestHeadBack } from '../world/home-bus'
import { onSceneDrawn, onStageBusy, placeCardUp, sceneDrawn } from '../stage/stage-bus'
import { Plank } from '../ui/controls'
import { track } from '../telemetry'
import './headback.css'

export function HeadBack() {
  const [, bump] = useState(0)
  const redraw = () => bump((v) => v + 1)
  useEffect(() => subscribeSave(redraw), [])
  useEffect(() => onIslandTasks(redraw), [])
  useEffect(() => onCinema(redraw), [])
  useEffect(() => onDialogue(redraw), [])
  useEffect(() => onStageBusy(redraw), [])
  useEffect(() => onSceneDrawn(redraw), [])
  const [going, setGoing] = useState(false)
  const [why, setWhy] = useState<string | null>(null)

  const list = islandTaskList()
  const save = loadSave()
  const done = list ? tasksDoneIn(list.programme, save?.year ?? 1) : []
  /* The task list has to belong to the map that's drawn right now. The list is stored on a bus that
   * doesn't know which map is showing, so without this check a leftover list could put the button
   * on the home base. */
  const here = sceneDrawn()
  const onItsOwnIsland = !!list && !!here && islandForProgramme(list.programme)?.map === here
  const finished = !!list && onItsOwnIsland
    && list.tasks.length > 0 && list.tasks.every((t) => done.includes(t.id))

  /* Don't show it when there's no finished island, during a cutscene or dialogue (it shares the
   * bottom of the screen with the dialogue box), while an arrival card is up, or when no scene is
   * listening, because then a press could only be refused. */
  /* Open panels are handled in CSS through `data-panels` on the root. Closing a panel doesn't
   * re-render this component, so a button hidden here while a panel was up would stay hidden after
   * it closed. */
  const hidden = !finished
    || cinemaOn()
    || dialogueState() !== null
    || placeCardUp()
    || homeListenerCount() === 0
  if (hidden) return null

  return (
    <div className="hb-back">
      {why && <p className="hb-back-why" role="status">{why}</p>}
      <Plank
        size="md"
        busy={going}
        onClick={() => {
          if (going) return
          setGoing(true)
          setWhy(null)
          track('head_back_pressed', { programme: list!.programme })
          void requestHeadBack().then((a) => {
            setGoing(false)
            /* If the trip home is refused, show the reason. A button that seems to do nothing is
             * worse than a message. */
            if (!a.ok) setWhy(a.why)
          })
        }}
      >
        Island finished. Head back.
      </Plank>
    </div>
  )
}
