/* The objective panel. It's one short line at the top of the screen telling the player what to do
 * now. */
import type React from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { loadSave, subscribeSave, tasksDoneIn, type SaveGame } from '../save'
import { nextObjective, objectiveLine } from '../run/objective'
import { islandHeading, taskHeading, tasksDone, tasksOf, type Task } from '../run/tasks'
import { objectiveSaid, onObjectiveSaid, runEnding, worldObjective } from './objective-bus'
import { islandTaskList, onIslandTasks, type IslandTaskList } from './island-tasks'
import { onSceneDrawn, sceneDrawn } from '../stage/stage-bus'
import { track } from '../telemetry'
import { requestUi } from '../ui-bus'
import './objective.css'
import { onVoyage, voyage } from '../world/travel'
import { titleOfMap } from '../stage/covers'

export function ObjectivePanel() {
  const [, bump] = useState(0)
  const redraw = () => bump((v) => v + 1)
  useEffect(() => subscribeSave(redraw), [])
  useEffect(() => onObjectiveSaid(redraw), [])
  /* The map the player is standing on. The year's sentence reads differently on the objective's own
   * map than anywhere else, and this panel shows over every world scene. */
  const [map, setMap] = useState<string | null>(sceneDrawn())
  useEffect(() => { setMap(sceneDrawn()); return onSceneDrawn(setMap) }, [])

  /* Whether the sheet is open is all the state it has. It isn't saved, because nobody wants the
   * sheet to pop back open after a reload. */
  const [open, setOpen] = useState(false)
  const opens = useRef(0)
  const toggle = () => {
    setOpen((was) => {
      if (!was) track('task_sheet_opened', { at: ++opens.current })
      return !was
    })
  }

  /* A voyage wins over every other sentence. The destination island's `start` runs while the ship
   * is still on the water, so without this the line would say "Find the club president." in the
   * middle of the sea. */
  const [going, setGoing] = useState(voyage())
  useEffect(() => onVoyage(setGoing), [])

  /* Which line wins, in order: the voyage, then what the island said, then the scene, then the
   * year. */
  const said = objectiveSaid()
  const world = worldObjective()
  const o = nextObjective(loadSave())
  const travelling = going ? `Sailing to ${titleOfMap(going.to)}.` : null
  const text = travelling ?? said ?? world ?? objectiveLine(o, map)
  /* `end_run` turns this on while the departure plays, and it turns off when the departure ends. */
  const ending = runEnding()

  /* Track this once per sentence, not once per render, so the events show which objective was on
   * screen and when it changed. */
  useEffect(() => {
    if (!text) return
    track('objective_shown', { text, said: !!said, phase: o?.phase ?? null })
    /* The phase and the flag go along in the event, but only a new sentence fires it. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  /* `end_run` turns on `ending` while the ship leaves, so the year's closing line doesn't sit on
   * top of the departure. The panel is unmounted, not hidden, so screen readers stop reading it
   * too. */
  if (!text || ending) return null

  return (
    <div className="ob-wrap">
      {/* Only this line is read out to screen readers, never the sheet under it. */}
      <div className="ob-live" role="status" aria-live="polite">{text}</div>
      {/* Styled as the narrow carved plaque, not the big parchment band. */}
      <button
        type="button"
        className="ob-panel"
        title={text}
        aria-expanded={open}
        aria-label={`${text} Press to see everything this year asks for.`}
        onClick={(e) => { e.stopPropagation(); toggle() }}
      >
        {text}
        {/* The little arrow is the only hint that the bar can be pressed. */}
        <span className="ob-more" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <TaskSheet onClose={() => setOpen(false)} />}
    </div>
  )
}

/* Each row opens the thing it names. The schedule and every pick open the year sheet, and Advisory
 * opens Advisory. The last row only says where to find the person, since it's a place in the world.
 * A finished or barred row can't be pressed. */
/** Which panel a row opens, or null for a row that no panel on screen can finish. */
function openerOf(t: Task): 'planner' | 'advisory' | null {
  if (t.done || t.barred) return null
  if (t.id === 'plan' || t.id.startsWith('class:') || t.id.startsWith('voyage:')) return 'planner'
  if (t.id === 'core') return 'advisory'
  /* The last row is a place in the world, not a panel, so it stays plain text. */
  return null
}

/* An island's own list goes in this same sheet, using the same row shape. An island row can never
 * be pressed, because the thing it names happens in the room. */
function islandRows(list: IslandTaskList, save: SaveGame | null): Task[] {
  const ticked = new Set(tasksDoneIn(list.programme, save?.year ?? 1))
  return list.tasks.map((t) => ({
    id: `island:${t.id}`,
    name: t.name,
    done: ticked.has(t.id),
    ...(ticked.has(t.id) || !t.note ? {} : { note: t.note }),
  }))
}

function TaskSheet({ onClose }: { onClose: () => void }) {
  const [, bump] = useState(0)
  const redraw = () => bump((v) => v + 1)
  useEffect(() => subscribeSave(redraw), [])
  useEffect(() => onIslandTasks(redraw), [])
  const save = loadSave()
  /* The island's rows go first and the year's rows stay underneath. This is the only task sheet in
   * the game, and replacing the year's rows would hide Advisory, every pick and the row that
   * finishes the year. */
  const island = islandTaskList()
  const here = island ? islandRows(island, save) : []
  const year = tasksOf(save)
  const list = [...here, ...year]
  /* Each heading counts only its own rows. One count over both lists would say "1 of 8 done" to a
   * student on an island with two things to do. */
  const mine = tasksDone(here.length ? here : year)
  const theirs = tasksDone(year)

  /* The close listener sits on the window in the capture phase, so `stopPropagation` on the sheet
   * can't stop it. That's why it checks whether the press landed inside the sheet. Capture is what
   * lets a press anywhere else close the sheet without the world underneath having to help. */
  const sheet = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (sheet.current?.contains(e.target as Node)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true), 0)
    window.addEventListener('keydown', key, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  if (!list.length) return null

  return (
    <div className="ob-sheet kit-surface-band" ref={sheet}>
      <p className="ob-sheet-head">
        {island ? islandHeading(island.programme) : taskHeading(save?.year ?? 1)}
        <span className="ob-sheet-count">{mine.done} of {mine.total} done</span>
      </p>
      <ul className="ob-tasks">
        {list.map((t, i) => (
          <Fragment key={t.id}>
            {/* The year's own heading, printed once, right where the island's rows end. */}
            {here.length > 0 && i === here.length && (
              <li className="ob-sheet-sub" aria-hidden="true">
                {taskHeading(save?.year ?? 1)}
                <span className="ob-sheet-count">{theirs.done} of {theirs.total} done</span>
              </li>
            )}
          <li
            className={`ob-task${t.done ? ' is-done' : ''}${t.barred && !t.done ? ' is-barred' : ''}${openerOf(t) ? ' is-live' : ''}`}
            {...(openerOf(t)
              ? {
                role: 'button' as const,
                tabIndex: 0,
                onClick: () => { requestUi(openerOf(t)!); onClose() },
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  requestUi(openerOf(t)!)
                  onClose()
                },
              }
              : {})}
          >
            {/* The marks are plain text characters, not emoji, because emoji aren't allowed. */}
            <span className="ob-mark" aria-hidden="true">{t.done ? '✓' : t.barred ? '–' : '▢'}</span>
            <span className="ob-task-body">
              <span className="ob-task-name">{t.name}</span>
              {t.note && <span className="ob-task-note">{t.note}</span>}
            </span>
            <span className="ob-sr">{t.done ? ' done' : t.barred ? ' not open yet' : ' still to do'}</span>
          </li>
          </Fragment>
        ))}
      </ul>
    </div>
  )
}
