/* The intents an island can call that don't need a map loaded. These are the ones that touch the
 * save, the UI and the event log. */
import type { IntentEngine, RunPath } from '../vine/intents'
import type { SessionMode } from '../vine/contract'
import { requestBeat, requestUi, requestUiAndWait } from './ui-bus'
import { NotBuilt } from '../vine/intents'
import { track } from './telemetry'
import {
  collectFact, collectSticker, grantBadge, islandLedgerId, loadSave, markTaskDone,
  recordCompletion, recordGrade, setFlag, setIslandState,
} from './save'
import { cordsOf, gpaOf } from './progress'
import { grant } from './grant'
import { beatPassedIn, coreBeatId, hasCoreBeat } from './beats/beats'
import { programmeById } from './roster/roster'
import { shownName } from './roster/placeholders'
import { classById } from './planner/catalog'
import { letterOf } from './progress'
import { nextObjective } from './run/objective'
import { play as playSfx } from './audio'
import { setCinema } from './stage/cinema'
import { setObjectiveSaid } from './hud/objective-bus'
import { islandTaskList, islandTaskTicked, setIslandTasks } from './hud/island-tasks'

/* Every path an island can read about the run. It's a Record so that adding a new RunPath won't
 * compile until it's listed here too. */
const READABLE_PATHS: Record<RunPath, true> = {
  year: true, gpa: true, tokens: true, cords: true, flags: true, islands: true,
  handle: true, mode: true, graduated: true, cord_board: true, trophies: true,
  phase: true, picks: true, advisory: true, planned: true, rank: true,
}
const READABLE = Object.keys(READABLE_PATHS).sort()

export const engine: IntentEngine = {
  /* Opens a panel. Throws if nothing is mounted to show it. */
  openUi(ui, wait) {
    /* `requestUiAndWait` fails in exactly the same case as `requestUi`, so one error message covers
     * both. When waiting, the promise resolves once the panel closes. */
    if (wait) {
      const p = requestUiAndWait(ui)
      if (p) return p
    } else if (requestUi(ui)) return
    throw new NotBuilt('open', `nothing is mounted to open "${ui}" here. `
      + 'A panel needs the world HUD, which does not mount until a run has started.')
  },

  playBeat(beat, decl) {
    return requestBeat(beat, decl)
  },

  /* Tells an island how many times it was finished before. `taken` only counts earlier completions,
   * so it's 0 the first year (say hello) and 1 the second year (say welcome back). */
  rankOf(programme: string | null) {
    const s = loadSave()
    const rows = (s?.completions ?? []).filter((c) => c.programme === programme)
    const years = [...new Set(rows.map((c) => c.year))].sort((a, b) => a - b)
    const graded = rows.map((c) => c.grade).filter((g): g is number => typeof g === 'number')
    return {
      taken: years.length,
      years,
      best: graded.length ? Math.max(...graded) : null,
      rung: programme ? (s?.ranks?.[programme] ?? 0) : 0,
    }
  },

  /* The fixed list of questions an island can ask about the run. */
  read(path: RunPath): unknown {
    const s = loadSave()
    switch (path) {
      case 'year': return s?.year ?? 1
      case 'gpa': return s ? gpaOf(s) : 0
      case 'tokens': return s?.tokens.length ?? 0
      case 'cords': return s ? cordsOf(s).filter((c) => c.earned).map((c) => c.id) : []
      /* The whole cord board, the same rows the tracker shows. */
      case 'cord_board': return s ? cordsOf(s) : []
      /* Stickers and badges stay as two separate lists, because the rest of the save treats them as
       * different things. */
      case 'trophies': return s
        ? { stickers: [...s.stickers], badges: [...s.badges] }
        : { stickers: [], badges: [] }
      /* The advisory beat this year still needs, or null. */
      /* Advisory stays on offer until the player passes it. Failing it with an F doesn't count as
       * done, or the year could never close. */
      case 'advisory': return s && hasCoreBeat(s.year) && !beatPassedIn(s, s.year)
        ? coreBeatId(s.year)
        : null
      case 'flags': return s ? [...s.flags] : []
      /* The real answer comes from `performIntent`, which knows which island is asking. This empty
       * answer is for anything that asks without an island. */
      case 'rank': return { taken: 0, years: [], best: null, rung: 0 }
      /* Whether this year's plan has been stamped. */
      case 'planned': return !!(s && s.plans[s.year]?.stamped)
      case 'islands': return s ? { ...s.islands } : {}
      /* With no run there's no name and no graduation, so these give back null instead of a made-up
       * value. */
      case 'handle': return s?.handle ?? null
      case 'graduated': return !!s?.graduated
      case 'mode': return engine.mode()
      /* Which phase of the year the run is in, taken from the objective sequencer. */
      case 'phase': return nextObjective(s)?.phase ?? null
      /* The classes, seasons and grades the student picked this year. */
      case 'picks': {
        if (!s) return { classes: [], seasons: [], graded: [], gpa: null }
        const plan = s.plans[s.year] ?? { slots: {}, classes: [], stamped: false }
        return {
          classes: plan.classes.map((id) => ({ id, name: classById(id)?.name ?? id })),
          seasons: Object.entries(plan.slots)
            .filter(([, id]) => !!id)
            .map(([season, id]) => ({
              season, id,
              name: shownName(id as string, programmeById(id as string)?.name ?? (id as string)),
            })),
          graded: s.ledger.filter((r) => r.year === s.year)
            .map((r) => ({ title: r.title, grade: letterOf(r.grade), kind: r.kind })),
          gpa: gpaOf(s),
        }
      }
    }
    /* A path nobody answers throws an error instead of giving back undefined. Undefined would reach
     * the member's Python as None and crash somewhere else in their code. The error lists every
     * valid path so a typo is easy to spot. */
    throw new NotBuilt('get', `nothing answers "${String(path)}". It can answer: ${READABLE.join(', ')}`)
  },

  /* Saves a flag. Throws if there's no run to save it in. */
  setFlag(flag) {
    if (!loadSave()) throw new NotBuilt('set_flag', `there is no run to remember "${flag}" in`)
    setFlag(flag)
  },

  /* One call for everything an island can give out: a grade, a completion, a sticker or a badge. */
  award(a) {
    /* Nothing gets written unless a run exists, so an award can't end up half saved. */
    if (!loadSave())
      throw new NotBuilt('award', 'there is no run to write this onto. '
        + 'Start a run first, or use the standalone harness only for logic that does not score.')

    /* Show the student one card on screen for the whole award. */
    const before = loadSave()
    writeAward(a)
    grant(before, loadSave(), saidOf(a))
  },

  log(event, data) {
    track(event, data)
  },

  /* Waits for a number of milliseconds. Works in any scene, with or without a map loaded. */
  wait(ms) {
    return new Promise<void>((r) => setTimeout(r, ms))
  },

  /* Plays a sound effect by name. */
  sound(name, gain) {
    playSfx(name, gain)
  },

  /* Turns the black movie bars on or off everywhere. */
  movie(on) {
    /* These bars belong to the island. The engine must never take them down on its own. */
    setCinema(on, 'island')
    /* When the bars go away, the objective line goes back to showing the year's objective. */
    if (!on) setObjectiveSaid(null)
  },

  /* Sets the line that tells the student what to do next. It's part of the screen around the game,
   * so it doesn't need a map and lives here instead of on the world. */
  objective(text) {
    setObjectiveSaid(text)
  },

  /* The list of tasks goes on a bus because it only matters while its island is loaded. The ticks
   * go in the save, keyed by programme and year, so closing the tab halfway through keeps the
   * progress. */
  islandTasks(tasks, by) {
    const programme = by?.grape ?? ''
    if (!programme)
      throw new NotBuilt('island_tasks', 'the engine could not tell which island is asking, '
        + 'so its tasks would have nowhere to be filed')
    setIslandTasks(programme, tasks)
  },

  taskDone(id, by) {
    const programme = by?.grape ?? ''
    if (!programme)
      throw new NotBuilt('task_done', 'the engine could not tell which island is asking, '
        + `so "${id}" would have nowhere to be filed`)
    /* A tick gets saved with the run, so it needs a run, the same as a flag. */
    const s2 = loadSave()
    if (!s2) throw new NotBuilt('task_done', `there is no run to remember "${id}" in`)
    /* The id must be one of the tasks the island listed. A misspelled id would be saved forever,
     * tick nothing the student can see, and leave the island stuck one task short with no clue why. */
    const list = islandTaskList()
    if (!list || list.programme !== programme)
      throw new NotBuilt('task_done', `"${programme}" has not said what its tasks are yet. `
        + 'Call island_tasks before ticking one off.')
    if (!list.tasks.some((t) => t.id === id))
      throw new NotBuilt('task_done', `"${programme}" has no task called "${id}". `
        + `It has: ${list.tasks.map((t) => t.id).join(', ')}`)
    markTaskDone(programme, s2.year, id)
    islandTaskTicked()
  },

  /* The game only has one mode. The method stays because an island can still ask for it. */
  mode(): SessionMode {
    return 'game'
  },
}

/* The saves that award makes, pulled out into their own function so award can wrap them with the
 * card. */
type AwardArgs = Parameters<IntentEngine['award']>[0]

function writeAward(a: AwardArgs) {
    if (a.fact) collectFact(a.fact)
    if (a.sticker) collectSticker(a.sticker)
    if (a.badge) grantBadge(a.badge)

    const s = loadSave()
    if (!s) return
    const year = s.year
    const g = programmeById(a.programme)

    /* If the programme isn't on the roster, warn about it and keep the grade anyway. */
    if (a.programme && !g) {
      console.warn(`[award] no programme named "${a.programme}" on the roster; the grade is kept and the island is not marked finished`)
      track('award_unknown_programme', { programme: a.programme })
    }

    /* Naming a programme without a grade is how a member says the island is finished. */
    if (typeof a.grade !== 'number') {
      if (g) {
        /* Save null here, not 0. A 0 is a real grade for getting everything wrong and prints as an
         * F, while null means finished with no scoring. */
        recordCompletion(g.id, null, g.rankTrack ?? undefined)
        setIslandState(g.id, 'completed')
        track('programme_completed', { programme: g.id, place: g.place, grade: null, year })
      }
      return
    }
    /* A programme that isn't on the roster still gets saved, as a plain row with the name it was
     * given. */
    const tags = [...(g?.tags ?? []), ...(a.tags ?? [])]
    const entry = g
      ? {
        id: islandLedgerId(g.id, year), title: g.name, kind: 'island' as const, credit: 1,
        ...(g.rankTrack ? { rank: g.rankTrack } : {}),
      }
      : {
        /* The id is built from what was awarded and the year, so replaying the island updates the
         * same row instead of adding a new one. */
        id: `award:y${year}:${a.programme ?? a.sticker ?? a.badge ?? a.fact ?? 'unnamed'}`,
        title: a.programme ? `Awarded (${a.programme})` : 'Awarded',
        kind: 'core' as const,
        /* This row has 0 credit. `gpaOf` weights grades by credit, so the grade is kept on the
         * record but doesn't change the GPA. That way a typo in a programme id can't move a
         * student's GPA. */
        credit: 0,
      }

    recordGrade({
      ...entry,
      grade: a.grade,
      year,
      season: s.season,
      ...(tags.length ? { tags } : {}),
    })
    if (g) {
      recordCompletion(g.id, a.grade, g.rankTrack ?? undefined)
      setIslandState(g.id, 'completed')
      /* Log the completion to the event log as well as the save. */
      track('programme_completed', { programme: g.id, place: g.place, grade: a.grade, year })
    }
}

/* What the card says, in words a 14 year old reads easily. */
function saidOf(a: AwardArgs): { what: string; detail?: string } {
  const g = programmeById(a.programme)
  if (g) {
    return {
      what: `${g.name} is done.`,
      detail: typeof a.grade === 'number' ? `It goes on your transcript.` : undefined,
    }
  }
  if (a.badge) return { what: 'You earned a badge.', detail: a.badge }
  /* A sticker's card also says badge, because the trophy wall where stickers would go isn't built. */
  if (a.sticker) return { what: 'You earned a badge.', detail: a.sticker }
  if (a.fact) return { what: 'That went in the Handbook.' }
  return { what: 'That counted.' }
}
