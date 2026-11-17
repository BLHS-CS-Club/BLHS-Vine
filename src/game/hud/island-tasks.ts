/* Holds the list of things the current island wants the student to do. It's shown as a list under
 * the objective bar. */
import type { IslandTask } from '../../vine/intents'

export type IslandTaskList = {
  /** The programme of the island that set this list. The checkmarks are looked up by it. */
  programme: string
  tasks: IslandTask[]
}

let list: IslandTaskList | null = null
const subs = new Set<() => void>()

const fire = () => {
  for (const s of [...subs]) {
    try { s() } catch (e) { console.error('[island-tasks] a listener threw', e) }
  }
}

/** The list the island on screen set, or null when no island has set one. */
export const islandTaskList = (): IslandTaskList | null => list

/** Runs the `island_tasks` command. It REPLACES the old list and never adds to it. */
export function setIslandTasks(programme: string, tasks: IslandTask[]) {
  /* If the island sends the exact same list again, nothing has changed, so skip redrawing the
   * sheet. */
  const same = list
    && list.programme === programme
    && list.tasks.length === tasks.length
    && list.tasks.every((t, i) => t.id === tasks[i].id && t.name === tasks[i].name && t.note === tasks[i].note)
  if (same) return
  list = { programme, tasks }
  fire()
}

/* The list goes away when the player leaves the island, since every row is something to do there. */
export function clearIslandTasks() {
  if (!list) return
  list = null
  fire()
}

/**
 * Subscribe to redraw when the list changes or a task gets checked off. The save's own subscribers
 * hear about the checkmark too.
 */
export function onIslandTasks(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

/** Call this when a task gets checked off, so the sheet redraws without waiting for a save event. */
export const islandTaskTicked = fire
