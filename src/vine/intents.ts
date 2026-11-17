/* The list of things the engine can be asked to do. A grape sends these over as plain data. */
import type { CheckStep, SessionMode } from './contract'
import { UI_PANELS } from '../game/ui-bus'

/* ---- what the engine can be asked to do ---------------------------------- */

export type Intent =
  /* Dialogue. When the speaker is standing on the map, `who` is their anchor name, so the camera
   * and the portrait both come from that one name. */
  | { kind: 'say'; who?: string; text: string; portrait?: string }
  | { kind: 'choose'; prompt?: string; options: string[] }

  /* guide_to draws an arrow to a place. null takes the arrow down. */
  | { kind: 'guide_to'; anchor: string | null }
  /* highlight lights up a thing where it stands, with no arrow and no path to it. */
  | { kind: 'highlight'; anchor: string | null; on?: boolean }
  /* Walk the player to an anchor. `off` moves the end spot a little to the side of the anchor's
   * mark. */
  | { kind: 'walk_to'; anchor: string; off?: Offset }
  | { kind: 'look_at'; anchor: string | null; ms?: number }

  /* The director words start here. pose sets the player's body pose and which way they face, and
   * doesn't move them. */
  | { kind: 'pose'; pose?: string; facing?: string }

  /* Moving other characters on the map: send them somewhere, turn them, change their look, and let
   * them go. */
  /* Send a character to an anchor at a named walking pace. */
  | { kind: 'actor_move'; actor: string; to: string; off?: Offset; facing?: string; pace?: Pace }
  /* A character walks ahead and the player follows. It ends when both have arrived. */
  | { kind: 'lead_to'; actor: string; to: string; off?: Offset; pace?: Pace }
  /* Put a character at a spot without walking there. They face the player unless told otherwise. */
  | { kind: 'place'; actor: string; at: string; off?: Offset; facing?: string }
  | { kind: 'actor_face'; actor: string; facing: string }
  | { kind: 'actor_look'; actor: string; look: string }
  | { kind: 'actor_release'; actor?: string }

  /* Travel along a named path drawn in the editor, as the player, a driven character, or the ship. */
  | { kind: 'route'; path: string; who?: string; backwards?: boolean }

  /* Point the camera at a named shot. null gives the camera back. */
  | { kind: 'framing'; shot: string | null; ms?: number }

  /* The standard shots the engine works out by itself: island, walk, close, ship and sail. */
  | { kind: 'view'; view: ViewShot; ms?: number }

  /* Pause for a while, or wait until the player walks into a named region. */
  | { kind: 'wait'; ms: number }
  | { kind: 'wait_for'; anchor: string; ms?: number }

  /* Play one named sound effect from the sound library, once. */
  | { kind: 'sound'; name: string; gain?: number }

  /* Marks a stretch as something to watch instead of play. The black bars come in and the on-screen
   * controls go away. */
  | { kind: 'movie'; on: boolean }

  /* The one short line telling the student what to do right now. null hands it back. */
  | { kind: 'objective'; text: string | null }

  /* The island's whole list of tasks for the student, while `objective` is one sentence about right
   * now. It replaces any list declared before, so an `@on_start` that runs again on every map load
   * can declare the same list and the ticks come back from the save. */
  | { kind: 'island_tasks'; tasks: IslandTask[] }

  /* Tick one task done, using the id its island gave it. The tick is kept in the save, so reloading
   * halfway through an island keeps what was finished. */
  | { kind: 'task_done'; id: string }

  /* Step the player off a docked boat onto the dock. */
  | { kind: 'ashore' }

  /* The panels that open over the game. The list is kept short and closed on purpose. */
  /* With wait, open comes back when the panel is closed instead of when it opens. */
  | { kind: 'open'; ui: 'planner' | 'handbook' | 'cords' | 'chart' | 'wardrobe' | 'settings' | 'wall' | 'yearbook' | 'tour'; wait?: boolean }

  /* A scored activity. `beat` names one the engine knows how to build. */
  /* An island can also bring its own activity. `items` is the activity the island declares, instead
   * of one named from the engine's table. It uses this word instead of a new one because every new
   * word has to be added to both copies of vine.py and to the vocabulary count in three places. */
  /* `as_plain` is still accepted because the published Python sends it, but it doesn't change
   * anything. A beat is only drawn one way. */
  | { kind: 'play'; beat: string; as_plain?: boolean; title?: string; place?: string; items?: CheckStep[] }

  /* Changing the world as the run goes. A placement is a MAPVIS id tied to an anchor, so a grape
   * calls it by name like everything else. */
  | { kind: 'show'; anchor: string; visible: boolean }
  | { kind: 'fx'; name: string; anchor?: string; data?: unknown }

  /* Scene changes. `at` is the anchor the player arrives on in the new map. Without it, every door
   * into a room drops the player on that room's one default spawn. */
  /* cover names the occasion for the loading screen, not the picture itself. */
  | { kind: 'enter'; map: string; at?: string; cover?: string }
  /* Sail to another island. The engine handles the whole trip, so a member never names a route, a
   * berth or a camera. */
  | { kind: 'sail_to'; map: string }
  | { kind: 'cutscene'; script: string }
  /* The run is over and the screen goes back to the title. */
  | { kind: 'end_run' }

  /* Run state. `get` only takes the paths progress.ts can answer, so a grape can't ask a question
   * the engine would have to make up an answer for. */
  | { kind: 'get'; path: RunPath }
  | { kind: 'set_flag'; flag: string }
  /* The row an island adds to the student's record when it finishes a programme. */
  | {
    kind: 'award'
    /** The roster programme this grade completes, if it completes one. */
    programme?: string
    grade?: number
    /** Extra cord tags added on top of the programme's own. They never replace them. */
    tags?: string[]
    fact?: string
    sticker?: string
    badge?: string
  }

  /* Logging. Every interaction that matters sends a typed event, and a grape adds to the record
   * instead of writing it. */
  | { kind: 'log'; event: string; data?: Record<string, unknown> }

/* An activity an island brought with it. `programme` is filled in by performIntent from the
 * island's registration and never read from the message, so a member can't write to another
 * programme's row. The items are ordinary `CheckStep`s, so one scorer handles both kinds. */
export type BeatDeclaration = {
  items: CheckStep[]
  title?: string
  place?: string
  programme?: string
}

/* How fast a driven character moves, as a word instead of a number. */
export type Pace = 'stroll' | 'walk' | 'run'
export const PACES: Pace[] = ['stroll', 'walk', 'run']
/* walk is the map's own speed. A stroll is about two thirds of it, the pace of someone crossing a
 * room without hurrying, and a run is one and a half times walk. */
export const PACE_OF: Record<Pace, number> = { stroll: 0.62, walk: 1, run: 1.5 }

/* One row on an island's task list: a name, an id to tick it with, and an optional line saying
 * where it happens. Whether a row is done isn't stored here. That lives in the save. */
export type IslandTask = {
  /** The island's own name for the task, which `task_done` is called with. */
  id: string
  /** What the student reads. */
  name: string
  /** One short line under an unfinished row saying where it happens. */
  note?: string
}

/** The most rows an island can put on the sheet, so the list stays short. */
export const TASKS_MAX = 8
/** The longest a row's name or note can be, in characters. It works like TEXT_MAX. */
export const TASK_TEXT_MAX = 72

/** Says why this task list can't be drawn, or gives back null when it can. */
export function refuseTasks(tasks: unknown): string | null {
  if (!Array.isArray(tasks) || !tasks.length)
    return 'island_tasks needs a list with at least one task in it'
  if (tasks.length > TASKS_MAX)
    return `island_tasks takes at most ${TASKS_MAX} tasks, and this one has ${tasks.length}`
  const seen = new Set<string>()
  for (const t of tasks as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') return 'every task has to be a dict with an id and a name'
    const id = typeof t.id === 'string' ? t.id.trim() : ''
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    if (!id) return 'every task needs an id, which is the word you tick it with'
    if (!name) return `the task "${id}" needs a name, which is what a student reads`
    /* Two rows with the same id would make one tick mean two things, so it's refused on the line
     * that made it. */
    if (seen.has(id)) return `two tasks are both called "${id}", so ticking one would tick the other`
    seen.add(id)
    if (name.length > TASK_TEXT_MAX)
      return `the name of "${id}" is ${name.length} characters, and a row holds ${TASK_TEXT_MAX}`
    const note = typeof t.note === 'string' ? t.note.trim() : ''
    if (note.length > TASK_TEXT_MAX)
      return `the note on "${id}" is ${note.length} characters, and a row holds ${TASK_TEXT_MAX}`
  }
  return null
}

export type Offset = [number, number]

/* The name that means the player, both as a speaker and as a place to stand. */
export const PLAYER = 'thor'
/** How far a step aside can go from a station's own mark, in painting pixels across and down. */
export const OFFSET_LIMIT = 96
export const offsetFault = (o: unknown): string | null => {
  if (o === undefined || o === null) return null
  if (!Array.isArray(o) || o.length !== 2) return 'off is two numbers, across and down'
  const [dx, dy] = o as unknown[]
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'off is two numbers, across and down'
  if (Math.abs(dx as number) > OFFSET_LIMIT || Math.abs(dy as number) > OFFSET_LIMIT)
    return `off is a step aside, not a journey: keep both numbers inside ${OFFSET_LIMIT}`
  return null
}

/* The occasions a door can declare. The cover registry turns each one into a picture. */
/* A cover says what it's for, not what it looks like. */
export type CoverOccasion = 'ceremony' | 'passing'
export const COVER_OCCASIONS: CoverOccasion[] = ['ceremony', 'passing']

/** The shots the engine sets up by itself, based on the painting and the window. */
export type ViewShot = 'island' | 'walk' | 'close' | 'ship' | 'sail'
export const VIEW_SHOTS: ViewShot[] = ['island', 'walk', 'close', 'ship', 'sail']

export type RunPath =
  | 'year' | 'gpa' | 'tokens' | 'cords' | 'flags' | 'islands'
  | 'handle' | 'mode' | 'graduated'
  /* Every cord with its rule and progress line, and what's on the trophy wall. */
  | 'cord_board' | 'trophies'
  /* Which step of the year the player is on, and what they actually picked in it. */
  | 'phase' | 'picks'
  /* Whether this year's advisory is still owed. The answer is a beat id or null. */
  | 'advisory'
  /* Whether this year's plan sheet is stamped. */
  | 'planned'
  /* How many times this island has been finished before and how well, as `{ taken, years, best,
   * rung }`. Like `flags`, it answers about the island that asked, so a club taken again doesn't
   * replay year one word for word. */
  | 'rank'

/* ---- what comes back ------------------------------------------------------ */

/* Every reply has the same shape, so a refusal comes back as an answer instead of an exception. */
export type IntentResult =
  | { ok: true; value?: unknown }
  | { ok: false; why: string }

export const ok = (value?: unknown): IntentResult => ({ ok: true, value })
export const no = (why: string): IntentResult => ({ ok: false, why })

/* ---- who carries them out ------------------------------------------------- */

/* The half of the words that needs a map. Whichever scene is showing implements it. */
export interface IntentWorld {
  /* The map this scene is showing, so `enter` knows when there's nothing to do. */
  mapId(): string
  /* Whether this map has an anchor with that name. */
  hasAnchor(name: string): boolean
  say(who: string | undefined, text: string, portrait?: string): Promise<void>
  choose(prompt: string | undefined, options: string[]): Promise<number>
  /**
   * Every map this game can open, so a mistyped destination is refused by name instead of playing a
   * loading screen into nothing. It's empty when the scene can't tell.
   */
  knownMaps(): string[]
  guideTo(anchor: string | null): void
  /* Only the pool of light, which `guide_to` turns on as well. */
  highlight(anchor: string | null, on: boolean): void
  walkTo(anchor: string, off?: Offset): Promise<void>
  lookAt(anchor: string | null, ms?: number): Promise<void>
  show(anchor: string, visible: boolean): void
  /* Play a named effect and come back when it's finished. */
  fx(name: string, anchor?: string, data?: unknown): Promise<void>
  enter(map: string, at?: string, cover?: string): Promise<void>
  /** Sail to another island and come back when the player is standing on it. */
  sailTo(map: string): Promise<void>
  /** Put the player off a docked boat and onto the dock. */
  ashore(): Promise<void>
  cutscene(script: string): Promise<void>
  /** The run is over. Leave the world for the title screen. */
  endRun(): Promise<void>

  /* The director half. Each word plays out something MAPVIS already lets you author. */
  pose(pose: string | undefined, facing: string | undefined): Promise<void>
  actorMove(actor: string, to: string, off?: Offset, facing?: string, pace?: Pace): Promise<void>
  /** A character walks ahead, the player follows, and it ends when both stop. */
  leadTo(actor: string, to: string, off?: Offset, pace?: Pace): Promise<void>
  /** Put a character at an anchor without walking, facing the player by default. */
  place(actor: string, at: string, off?: Offset, facing?: string): void
  actorFace(actor: string, facing: string): void
  actorLook(actor: string, look: string): void
  actorRelease(actor?: string): void
  route(path: string, who: string, backwards: boolean): Promise<void>
  framing(shot: string | null, ms?: number): Promise<void>
  /* The shots the engine works out by itself. It's awaited because the next line would otherwise
   * talk over a camera pull-out that hasn't finished. */
  view(shot: ViewShot, ms?: number): Promise<void>
  waitFor(anchor: string, ms?: number): Promise<boolean>
}

/* The engine half. It's handed over once at boot, not once per scene, because the save file and the
 * logger stay the same when the camera changes. */
export interface IntentEngine {
  /* With `wait`, this gives back a promise the caller can await. Without it nothing comes back, so
   * existing stations keep working as they are. */
  openUi(ui: 'planner' | 'handbook' | 'cords' | 'chart' | 'wardrobe' | 'settings' | 'wall' | 'yearbook' | 'tour', wait?: boolean): void | Promise<void>
  /* `decl` is only there when the island brought its own activity. Without it, the engine looks the
   * id up in its own table. */
  playBeat(beat: string, decl?: BeatDeclaration): Promise<number | null>
  read(path: RunPath): unknown
  /**
   * How this programme has been finished before: how many times, which years, the best grade, and
   * the rung of any ladder it keeps.
   */
  rankOf(programme: string | null): { taken: number; years: number[]; best: number | null; rung: number }
  setFlag(flag: string): void
  award(a: {
    programme?: string; grade?: number; tags?: string[]
    fact?: string; sticker?: string; badge?: string
  }): void
  log(event: string, data?: Record<string, unknown>): void
  mode(): SessionMode
  /* The two director words that don't need a map: a pause and a sound. */
  wait(ms: number): Promise<void>
  sound(name: string, gain?: number): void
  /* Raise or drop the movie bars. They belong to the window, not to a map. */
  movie(on: boolean): void
  /* The panel saying what to do next sits around the window, not on a map, so an island run in the
   * standalone harness can still set it. */
  objective(text: string | null): void
  /* The task sheet beside it is outside the map too, so a standalone harness can still show it.
   * `islandTasks` replaces the list and `taskDone` ticks one row. */
  islandTasks(tasks: IslandTask[], by?: IntentBy): void
  taskDone(id: string, by?: IntentBy): void
}

/* Which island is speaking, so its flags get its own name in front of them. */
export type IntentBy = { grape: string }

/* The longest pause a scene can be asked to hold. */
export const WAIT_CEILING_MS = 30_000

/* The longest it can wait for the player to walk somewhere. */
export const WAIT_FOR_CEILING_MS = 120_000

export type IntentHost = {
  world: IntentWorld | null
  engine: IntentEngine
  /** Left out for the vine's own content. Otherwise it's the island's programme id. */
  by?: IntentBy
}

/* ---- the one place an intent is performed --------------------------------- */

/* The one place an intent gets carried out. There's a case for every word in the Intent type. */
export async function performIntent(i: Intent, host: IntentHost): Promise<IntentResult> {
  const { world, engine, by } = host
  /* Each island gets its own corner of the flag list. `set_flag("met")` on atc saves "atc:met", so
   * no other island can reach it or clash with it. The vine's own flags have no prefix, because
   * every save already has them that way. */
  const scoped = (flag: string) => (by ? `${by.grape}:${flag}` : flag)
  /* If an intent needs a map and this scene has none, send back a refusal instead of throwing. A
   * grape in the standalone harness should say there's no world here, not crash the worker. */
  const w = (): IntentWorld => {
    if (!world) throw new NoWorld(i.kind)
    return world
  }
  try {
    switch (i.kind) {
      case 'say':
        await w().say(i.who, i.text, i.portrait)
        return ok()
      case 'choose': {
        /* Catch the arguments in the wrong order, like `choose("Want a go?", [...])`. It's the most
         * likely beginner mistake, and if a string got through to the renderer it would blank the
         * whole game, not only the island. */
        if (!Array.isArray(i.options))
          return no('choose wants a LIST of options first and the prompt after it: '
            + 'choose(["Yes", "No"], prompt="Want a go?"). '
            + `It was given ${typeof i.options === 'string' ? `the text "${i.options}"` : typeof i.options}.`)
        if (!i.options.length) return no('choose was given an empty list, so there is nothing to press')
        const bad = i.options.findIndex((o) => typeof o !== 'string' || !o.trim())
        if (bad >= 0) return no(`choose option ${bad + 1} is not a line of text, so nothing can be drawn on it`)
        if (i.prompt !== undefined && typeof i.prompt !== 'string')
          return no('the prompt for choose is the sentence above the buttons, so it wants text')
        return ok(await w().choose(i.prompt, i.options))
      }
      case 'guide_to':
        /* null isn't a name, so it isn't checked against the map. Taking the arrow down is
         * something you ask for on purpose. */
        if (i.anchor && !w().hasAnchor(i.anchor)) return no(`no anchor named "${i.anchor}" on ${w().mapId()}`)
        w().guideTo(i.anchor)
        return ok()
      case 'highlight': {
        /* The same check `guide_to` does. null means let go, not a name someone forgot. */
        const lit = i.on === false ? null : i.anchor
        if (lit && !w().hasAnchor(lit)) return no(`no anchor named "${lit}" on ${w().mapId()}`)
        w().highlight(lit, !!lit)
        return ok()
      }
      case 'walk_to':
        if (!w().hasAnchor(i.anchor)) return no(`no anchor named "${i.anchor}" on ${w().mapId()}`)
        if (offsetFault(i.off)) return no(offsetFault(i.off) as string)
        await w().walkTo(i.anchor, i.off)
        return ok()
      case 'look_at':
        /* The anchor is checked here too. null means let the camera go. */
        if (i.anchor && !w().hasAnchor(i.anchor)) return no(`no anchor named "${i.anchor}" on ${w().mapId()}`)
        await w().lookAt(i.anchor, i.ms)
        return ok()
      case 'show':
        if (!w().hasAnchor(i.anchor)) return no(`no anchor named "${i.anchor}" on ${w().mapId()}`)
        w().show(i.anchor, i.visible)
        return ok()
      case 'fx':
        /* The anchor is checked here so the refusal reads like every other word's. */
        if (i.anchor && !w().hasAnchor(i.anchor)) return no(`no anchor named "${i.anchor}" on ${w().mapId()}`)
        await w().fx(i.name, i.anchor, i.data)
        return ok()
      case 'enter':
        /* cover is either one of the engine's own occasions or the code name of a picture the
         * destination map ships. A code name follows MAPVIS's rule: lower case letters, digits and
         * underscores, starting with a letter. A name that can't exist gets refused with a message. */
        /* A map that doesn't exist gets a message, not a twelve second loading screen into nothing.
         * The list comes from the world the game really loaded plus this map's own doors, not a
         * table someone keeps by hand. If the scene can't answer, the name isn't checked. */
        if (typeof i.map !== 'string' || !i.map.trim())
          return no('enter wants the name of a map to go to')
        {
          const maps = w().knownMaps()
          if (maps.length && !maps.includes(i.map.trim()))
            return no(`there is no map called "${i.map}". `
              + `This game has: ${[...maps].sort().join(', ')}`)
        }
        if (i.cover !== undefined) {
          const c = typeof i.cover === 'string' ? i.cover.trim() : ''
          if (!c) return no('cover wants an occasion or the code name of a cover, not an empty string')
          if (!COVER_OCCASIONS.includes(c as CoverOccasion) && !/^[a-z][a-z0-9_]{0,47}$/.test(c))
            return no(`"${c}" is neither an occasion (${COVER_OCCASIONS.join(', ')}) nor a legal cover name. `
              + 'A cover name is lower case letters, digits and underscores, starting with a letter.')
          await w().enter(i.map, i.at, c)
          return ok()
        }
        await w().enter(i.map, i.at)
        return ok()
      case 'sail_to':
        if (typeof i.map !== 'string' || !i.map.trim()) return no('sail_to wants the name of a map to sail to')
        await w().sailTo(i.map.trim())
        return ok()
      case 'end_run':
        await w().endRun()
        return ok()
      case 'cutscene':
        await w().cutscene(i.script)
        return ok()

      /* ---- the director class -------------------------------------------- */

      case 'pose':
        /* Both fields are optional, but a call with neither one doesn't ask for anything. */
        if (!i.pose && !i.facing) return no('pose needs a pose, a facing, or both')
        await w().pose(i.pose, i.facing)
        return ok()

      /* An actor is an anchor name, so these words check it the same way show does. */
      case 'actor_move':
        if (!w().hasAnchor(i.actor)) return no(`no anchor named "${i.actor}" on ${w().mapId()}`)
        /* The player can be a destination even though they're never an anchor, the same exception
         * `place` makes. No map has a post for wherever the player stopped walking. */
        if (i.to !== PLAYER && !w().hasAnchor(i.to)) return no(`no anchor named "${i.to}" on ${w().mapId()}`)
        /* A pace that isn't on the list is a typo. Refuse it by name and show the list, like every
         * other named thing in this file. */
        if (i.pace && !PACES.includes(i.pace))
          return no(`"${i.pace}" is not a pace. They are: ${PACES.join(', ')}`)
        if (offsetFault(i.off)) return no(offsetFault(i.off) as string)
        await w().actorMove(i.actor, i.to, i.off, i.facing, i.pace)
        return ok()
      case 'lead_to':
        if (!w().hasAnchor(i.actor)) return no(`no anchor named "${i.actor}" on ${w().mapId()}`)
        if (!w().hasAnchor(i.to)) return no(`no anchor named "${i.to}" on ${w().mapId()}`)
        if (i.pace && !PACES.includes(i.pace))
          return no(`"${i.pace}" is not a pace. They are: ${PACES.join(', ')}`)
        if (offsetFault(i.off)) return no(offsetFault(i.off) as string)
        await w().leadTo(i.actor, i.to, i.off, i.pace)
        return ok()
      case 'place':
        if (!w().hasAnchor(i.actor)) return no(`no anchor named "${i.actor}" on ${w().mapId()}`)
        /* The player is a place but not an anchor, so the player is the only name that skips the
         * check. */
        if (i.at !== PLAYER && !w().hasAnchor(i.at))
          return no(`no anchor named "${i.at}" on ${w().mapId()}`)
        if (offsetFault(i.off)) return no(offsetFault(i.off) as string)
        w().place(i.actor, i.at, i.off, i.facing)
        return ok()
      case 'actor_face':
        /* The player can be the actor here too. Without `actor_face("thor", x)`, when someone walks
         * up and speaks, the student keeps facing wherever their last walk pointed, and the only
         * fix would be typing a compass direction into an island. */
        if (i.actor !== PLAYER && !w().hasAnchor(i.actor))
          return no(`no anchor named "${i.actor}" on ${w().mapId()}`)
        w().actorFace(i.actor, i.facing)
        return ok()
      case 'actor_look':
        if (!w().hasAnchor(i.actor)) return no(`no anchor named "${i.actor}" on ${w().mapId()}`)
        w().actorLook(i.actor, i.look)
        return ok()
      case 'actor_release':
        /* Releasing everyone is the no-argument case. It's always allowed, even on a map where
         * nothing was driven, because it only tidies up. */
        if (i.actor && !w().hasAnchor(i.actor)) return no(`no anchor named "${i.actor}" on ${w().mapId()}`)
        w().actorRelease(i.actor)
        return ok()

      case 'route':
        await w().route(i.path, i.who ?? 'player', i.backwards === true)
        return ok()

      case 'framing':
        await w().framing(i.shot, i.ms)
        return ok()

      case 'view':
        if (!VIEW_SHOTS.includes(i.view))
          return no(`"${i.view}" is not a shot this engine composes. They are: ${VIEW_SHOTS.join(', ')}`)
        await w().view(i.view, i.ms)
        return ok()

      /* wait_for answers whether the player actually got there, so an island can branch on it. */
      case 'wait_for':
        if (!w().hasAnchor(i.anchor)) return no(`no anchor named "${i.anchor}" on ${w().mapId()}`)
        return ok(await w().waitFor(i.anchor, i.ms))

      case 'wait':
        /* A negative or huge pause is a typo. To the student, a scene frozen for an hour looks the
         * same as a crash. */
        if (!Number.isFinite(i.ms) || i.ms < 0) return no(`wait wants a number of milliseconds and got ${JSON.stringify(i.ms)}`)
        await engine.wait(Math.min(i.ms, WAIT_CEILING_MS))
        return ok()
      case 'sound':
        engine.sound(i.name, i.gain)
        return ok()
      case 'ashore':
        await w().ashore()
        return ok()
      case 'movie':
        /* No map needed on purpose. The bars belong to the window, so an island opening in the
         * standalone harness can still mark a stretch as watched instead of played. */
        engine.movie(i.on === true)
        return ok()
      case 'objective':
        /* No map needed. This is one sentence, and a blank one means the same as none. */
        engine.objective(typeof i.text === 'string' && i.text.trim() ? i.text.trim() : null)
        return ok()

      case 'island_tasks': {
        const why = refuseTasks(i.tasks)
        if (why) throw new NotBuilt('island_tasks', why)
        /* Trim here so nothing later has to. `by` comes along so the ticks are filed under the
         * island that owns them. */
        engine.islandTasks((i.tasks as IslandTask[]).map((t) => ({
          id: t.id.trim(), name: t.name.trim(),
          ...(typeof t.note === 'string' && t.note.trim() ? { note: t.note.trim() } : {}),
        })), by)
        return ok()
      }

      case 'task_done': {
        const id = typeof i.id === 'string' ? i.id.trim() : ''
        if (!id) throw new NotBuilt('task_done', 'task_done needs the id of the task to tick')
        engine.taskDone(id, by)
        return ok()
      }

      case 'open': {
        /* An unknown panel name has to be refused here. Nothing would open, and with `wait=True`
         * the world would be stuck with no controls until the bus gives up after ten minutes.
         * Without `wait` it would quietly do nothing and still say ok. */
        if (!(UI_PANELS as readonly string[]).includes(i.ui)) {
          return no(`"${String(i.ui)}" is not a panel this game has. `
            + `It has: ${[...UI_PANELS].sort().join(', ')}`)
        }
        /* Always awaited. Without `wait` the engine gives back nothing, and this is a normal
         * synchronous call. */
        await engine.openUi(i.ui, i.wait === true)
        return ok()
      }
      case 'play': {
        /* The programme comes from `by`, never from the payload, the same place `scoped` gets it
         * for flags. Otherwise an island could write a grade onto another programme's row. */
        return ok(await engine.playBeat(i.beat,
          i.items ? { items: i.items, title: i.title, place: i.place, programme: by?.grape } : undefined))
      }
      case 'get':
        /* An island reads back its own corner of the flags too. Otherwise an island that wrote
         * "met" would read back "atc:met" mixed in with every other island's flags and recognize
         * none of them. */
        if (i.path === 'flags' && by) {
          const mine = `${by.grape}:`
          return ok((engine.read('flags') as string[])
            .filter((f) => f.startsWith(mine)).map((f) => f.slice(mine.length)))
        }
        /* Same rule as `flags`: a question about the island itself is answered about the island
         * that asked, so an island never needs to know its own id. */
        if (i.path === 'rank') return ok(engine.rankOf(by?.grape ?? null))
        return ok(engine.read(i.path))
      case 'set_flag':
        engine.setFlag(scoped(i.flag))
        return ok()
      case 'award': {
        /* A grade is out of four, and the message says so. */
        if (i.grade !== undefined && i.grade !== null) {
          if (typeof i.grade !== 'number' || !Number.isFinite(i.grade))
            return no(`award's grade wants a number from 0 to 4, or None for "finished, not graded". `
              + `It was given ${typeof i.grade}.`)
          if (i.grade < 0 || i.grade > 4)
            return no(`award's grade is out of FOUR, like a GPA, and it was given ${i.grade}. `
              + 'If you marked out of a hundred, divide by twenty five.')
        }
        if (i.programme !== undefined && (typeof i.programme !== 'string' || !i.programme.trim()))
          return no('the programme for award is the id of the thing being finished, so it wants a name')
        engine.award(i)
        return ok()
      }
      case 'log':
        engine.log(i.event, i.data)
        return ok()
    }
    /* This line can't run while the switch covers every case. The assignment makes the compiler
     * complain if a new word gets added to Intent without a case here. */
    const never: never = i
    return no(`unknown intent ${JSON.stringify(never)}`)
  } catch (e) {
    if (e instanceof NoWorld) return no(`${e.what} needs a map, and this scene has none`)
    /* NotBuilt ends up here too. Its message is already the refusal, so pass it on as it is. */
    return no(e instanceof Error ? e.message : String(e))
  }
}

class NoWorld extends Error {
  constructor(readonly what: string) { super(what) }
}

/* Thrown by a word the engine can't do yet, so the caller gets a refusal. */
export class NotBuilt extends Error {
  constructor(readonly what: string, detail?: string) {
    super(detail ? `${what} is not built yet. ${detail}` : `${what} is not built yet`)
  }
}
