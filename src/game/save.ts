// The save for one student's run. It lives in the browser, saves itself on every write, and other
// code can subscribe to changes.

import type { Transcript } from '../vine/verify'
import type { VesselRecord } from './world/sail'
import { refuseSlot, refuseClass } from './run/refusal'

const KEY = 'blhs_save_v2'
const OLD_V1 = 'blhs_save_v1'
const ROSTER_KEY = 'blhs_saves'   // Old multi-save keys, removed on load.
const ACTIVE_KEY = 'blhs_active'
/* Key for the one-run guard. It holds one id, one class code and a count, and it's never wiped. */
const GUARD_KEY = 'blhs_run_guard'

const newId = () => 'r' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)

export type Season = 'Fall' | 'Winter' | 'Spring'
export const SEASONS: Season[] = ['Fall', 'Winter', 'Spring']

/**
 * One graded thing: an island voyage, a class beat or a core beat. The GPA is worked out from
 * these.
 */
export type LedgerEntry = {
  id: string
  title: string
  kind: 'island' | 'class' | 'core'
  credit: number
  grade: number
  year: number
  season: Season
  retaken?: boolean
  tags?: string[]
  /* How many attempts this row has had, counted when the ledger is written. */
  attempts?: number
  /* The grade from the first attempt. It's kept next to the best grade and never overwritten. */
  firstGrade?: number
  /* Two numbers per question: points earned and points possible, keyed by the question's id. The
   * answers themselves are never stored here, because they are students' responses and the event
   * log already has them. */
  marks?: Record<string, [number, number]>
  /** The rank ladder this row counts a year toward, if it counts toward one. */
  rank?: string
}

export type IslandState = 'misty' | 'discovered' | 'available' | 'active' | 'completed'

/* One row per place per year saying the student saw it, and whether they got off the boat. */
export type Exposure = { place: string; year: number; docked: boolean }

/* The completion record. Rows only get added, one per programme per year. */
export type Completion = {
  programme: string
  year: number
  /* null means finished without a grade. It must never be saved as 0, because a 0 prints as an F
   * and that is a grade somebody earned. */
  grade: number | null
  rank?: string
  at: number
  /* The same two fields a ledger row has, so a voyage and a class can be reported the same way.
   * `attempts` is counted here and `firstGrade` never changes. */
  attempts?: number
  firstGrade?: number | null
}

/* One year's plan sheet: a programme in each season slot, plus the two focus classes. */
export type YearPlan = {
  slots: Partial<Record<Season, string>>   // Season to programme id (roster/roster.ts).
  classes: string[]                        // Up to 2 class ids.
  stamped: boolean                         // True once the plan is stamped and locked for the year.
}

/* Where the run was, and which version of the map and world it was saved against. */
export type RunPosition = {
  /** The id of the map the player was standing on. */
  map: string
  /** The published MAPVIS version of that map, if it came from the platform. */
  mapVersion?: number
  /** The world layout's own version, so moving the ocean around is caught too. */
  worldVersion?: number
  /**
   * The named anchor the player last passed through. A name can be checked later and a pixel
   * position can't.
   */
  anchor?: string
  /** Position in painting pixels. This is the first thing thrown away when a version changes. */
  x?: number
  y?: number
  at: number
}

/* The transcript at graduation, frozen once so the printed code keeps matching. */
export type FrozenRun = {
  transcript: Transcript
  /** The verification code, worked out once from the frozen transcript. */
  code: string
  /** The year the run ended on. It's 4 for a full run. */
  year: number
  at: number
}

export type SaveGame = {
  v: 2
  id: string
  participantId?: string        // Set when joining (net.ts). The server keys on it.
  handle: string
  pronouns: string
  boatName: string
  thorLook?: string
  /* The outfit worn over the coat, or nothing for the plain panther. It's only one slot because
   * each outfit is a whole edited character, not a layer, so two can't be worn at once. */
  thorWear?: string
  castaway?: boolean
  classCode?: string
  year: number
  season: Season
  beat: string
  introDone: boolean
  graduated?: boolean           // The run is over. Set by the fourth endYear.
  plans: Record<number, YearPlan>  // The year sheets, keyed by year 1 to 4.
  flags: string[]               // One-shot beats already seen, like `vignette:y1`.
  /* Keyed by programme id and saved with the year, because a club can be taken again later. A row
   * from a different year counts as nothing ticked, so a new year starts fresh. The island sends
   * its task list again every time it loads. */
  tasks?: Record<string, { year: number; done: string[] }>
  tokens: Season[]
  ledger: LedgerEntry[]
  /* Old field. Read it through `ranksOf()` in `progress.ts`, never directly. Years come from the
   * completion record, so a stored count can't disagree with the ledger. */
  ranks: Record<string, number>
  /**
   * The current state of each programme, used for its color on the chart. It's keyed by programme
   * id from `roster/roster.ts`, never by a map id or a place id.
   */
  islands: Record<string, IslandState>
  /** Every place this student was shown, per year. It's optional because older saves don't have it. */
  exposure?: Exposure[]
  /** Rows only get added, one per programme per year. Stamping a plan never writes here. */
  completions?: Completion[]
  /** Where the run was and which version of the world it was saved against. */
  where?: RunPosition
  /* The ship is saved as a berth name, not a position. Resuming in the middle of a voyage puts the
   * ship back at a dock, because a dock is a named anchor on a known map and a spot on open water
   * isn't. */
  vessel?: VesselRecord
  /** The transcript frozen at graduation. It's written once and never overwritten. */
  diploma?: FrozenRun
  stickers: string[]
  facts: string[]
  badges: string[]
  savedAt: number
}

const fresh = (): SaveGame => ({
  v: 2, id: newId(), handle: '', pronouns: '', boatName: '', year: 1, season: 'Fall',
  beat: 'intro:i1', introDone: false, plans: {}, flags: [],
  tokens: [...SEASONS], ledger: [], ranks: {}, islands: {}, exposure: [], completions: [],
  stickers: [], facts: [], badges: [],
  savedAt: 0,
})

// Fields that were added later get a default value when an older save is read. The save is never
// wiped for being an older shape.
const norm = (s: SaveGame): SaveGame => {
  if (!s.plans) s.plans = {}
  if (!s.flags) s.flags = []
  if (!s.exposure) s.exposure = []
  if (!s.completions) s.completions = []
  return s
}

let cache: SaveGame | null | undefined
const listeners = new Set<() => void>()
export function subscribeSave(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
const emit = () => { for (const fn of listeners) fn() }

// Another tab changed the run, so this tab drops its copy and subscribers redraw.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { cache = undefined; emit() }
  })
}

/* What the last read found: no save, a good save, or a damaged one. */
export type SaveHealth = 'none' | 'ok' | 'damaged'
let health: SaveHealth = 'none'
export const saveHealth = (): SaveHealth => { loadSave(); return health }

/* A save that can't be read anymore gets copied to another key instead of being written over. */
const WRECK_KEY = 'blhs_save_damaged'
export const damagedSave = (): string | null => {
  try { return localStorage.getItem(WRECK_KEY) } catch { return null }
}
function keepTheWreck(raw: string) {
  try { if (!localStorage.getItem(WRECK_KEY)) localStorage.setItem(WRECK_KEY, raw) } catch { /* Nowhere to keep it. */ }
}

const readRaw = (): SaveGame | null => {
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { health = 'damaged'; return null }
  if (!raw) { health = 'none'; return null }
  const wrecked = (): null => { health = 'damaged'; keepTheWreck(raw!); return null }
  try {
    const s = JSON.parse(raw) as SaveGame
    /* A save from a newer version of the game is still read and cleaned up, never treated as
     * missing. */
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || typeof (s.v as unknown) !== 'number') return wrecked()
    if (s.v < 2) return wrecked()
    health = 'ok'
    return norm(s)
  } catch { return wrecked() }
}

// Moves an older save shape into the single save. It tries the old roster's most recent entry
// first, then v1.
function migrate(): SaveGame | null {
  try {
    const rosterRaw = localStorage.getItem(ROSTER_KEY)
    if (rosterRaw) {
      const arr = JSON.parse(rosterRaw) as SaveGame[]
      // Use the roster's own active save first. If there isn't one, use the newest entry.
      const activeId = localStorage.getItem(ACTIVE_KEY)
      localStorage.removeItem(ROSTER_KEY); localStorage.removeItem(ACTIVE_KEY)
      const valid = arr.filter((s) => s && s.v === 2)
      const best = valid.find((s) => s.id === activeId)
        ?? valid.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0]
      if (best) { localStorage.setItem(KEY, JSON.stringify(best)); return best }
    }
    const v1 = localStorage.getItem(OLD_V1)
    if (v1) {
      const s = JSON.parse(v1)
      localStorage.removeItem(OLD_V1)
      const migrated = { ...fresh(), ...s, v: 2 as const, id: newId() }
      localStorage.setItem(KEY, JSON.stringify(migrated))
      return migrated
    }
  } catch { /* Fall through. */ }
  return null
}

export function loadSave(): SaveGame | null {
  if (cache !== undefined) return cache
  const read = readRaw()
  cache = read ?? migrate()
  if (!read && cache) health = 'ok'      // A moved-over save is a good save, not a damaged one.
  return cache
}

export function hasSave() { return loadSave() !== null }

/* Writing: a failed write is recorded instead of thrown, and the run keeps playing. */
export type SaveFault = { kind: 'quota' | 'blocked'; at: number; message: string }
let fault: SaveFault | null = null
/** The last write that didn't make it to storage, or null. A banner reads this. */
export const saveFault = (): SaveFault | null => fault

function commit(s: SaveGame): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    fault = null
    return true
  } catch (e) {
    const name = (e as { name?: string })?.name ?? ''
    /* These are the two errors a Chromebook actually throws. They're kept apart because the fix is
     * different: a full profile can be helped by syncing, but blocked storage can't be helped at
     * all, so the player has to be told. */
    const kind = /quota|QUOTA/i.test(name) ? 'quota' as const : 'blocked' as const
    fault = { kind, at: Date.now(), message: String((e as Error)?.message ?? name) }
    return false
  }
}

/**
 * Updates the run. It merges onto the save in storage instead of this tab's copy, so a tab left
 * open and idle can never undo progress made in another tab. It creates the save on the first
 * write.
 */
export function writeSave(patch: Partial<SaveGame>) {
  const base = readRaw() ?? cache ?? fresh()
  const next = { ...base, ...patch, savedAt: Date.now() }
  /* Every write passes through here, so this is where the guard records the participant. */
  if (patch.participantId) rememberParticipant(next)
  commit(next)
  cache = next; emit()
  return next
}

/* If a write failed and the run is only in memory, try saving one last time when the page closes. */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (fault && cache) commit(cache)
  })
}

/** Begin Adventure or Restart: starts a brand new run and replaces any old one. */
export function beginAdventure(): SaveGame {
  const s = fresh()
  commit(s)
  health = 'ok'
  cache = s; emit()
  return s
}

/** Wipes the run. Restart Adventure sends the student back to Begin. */
export function clearSave() {
  try {
    localStorage.removeItem(KEY); localStorage.removeItem(OLD_V1)
    localStorage.removeItem(ROSTER_KEY); localStorage.removeItem(ACTIVE_KEY)
    localStorage.removeItem(WRECK_KEY)
  } catch { /* Storage is blocked, so there's nothing to remove. */ }
  /* `GUARD_KEY` is left out of that list on purpose. The record that this device already joined a
   * class is what keeps it to one run per device. */
  health = 'none'
  cache = null; emit()
}

/* The guard that keeps one device to one participant, so a restart can't create a second row on the
 * server. */
export type RunGuard = {
  /** The first participant id the server gave this device. */
  participantId: string
  classCode?: string
  /** How many times a restart was allowed anyway. Only a captain can do that. */
  restarts: number
  firstAt: number
}

export function runGuard(): RunGuard | null {
  try {
    const raw = localStorage.getItem(GUARD_KEY)
    if (!raw) return null
    const g = JSON.parse(raw) as RunGuard
    return typeof g?.participantId === 'string' ? g : null
  } catch { return null }
}

function putGuard(g: RunGuard) {
  try { localStorage.setItem(GUARD_KEY, JSON.stringify(g)) } catch { /* Storage is blocked. The guard does what it can. */ }
}

/* Records the first participant this device had, only once, and never the captain. */
function rememberParticipant(s: SaveGame) {
  const pid = s.participantId
  if (!pid || pid === 'captain' || runGuard()) return
  putGuard({ participantId: pid, classCode: s.classCode, restarts: 0, firstAt: Date.now() })
}

export type RestartVerdict = { allowed: true } | { allowed: false; why: string }

/**
 * Whether this device can start its run over. The rule is one run per participant, and this is
 * where it lives.
 */
export function canRestart(): RestartVerdict {
  const g = runGuard()
  if (!g) return { allowed: true }
  return {
    allowed: false,
    why: g.classCode
      ? `You already started this game with the code ${g.classCode}. `
        + 'Ask your teacher if you need to start over.'
      : 'You already started this game on this device. '
        + 'Ask your teacher if you need to start over.',
  }
}

/* A forced restart is counted instead of happening silently. Resetting a demo machine is a real
 * need, and the count lets someone check how many devices were reset when a class's numbers don't
 * add up. */
export function restartRun(force = false): RestartVerdict {
  const verdict = canRestart()
  if (!verdict.allowed && !force) return verdict
  const g = runGuard()
  if (g) putGuard({ ...g, restarts: g.restarts + 1 })
  clearSave()
  return { allowed: true }
}

/** The teacher's reset: the device forgets it ever joined. Students never get this. */
export function releaseGuard() {
  try { localStorage.removeItem(GUARD_KEY) } catch { /* Nothing to release. */ }
}

// The functions the game's systems save through. Each one needs a run to exist and gives back null
// if there isn't one.

/* The only place the ledger gets written. It keeps the best grade, the first grade and the attempt
 * count. */
export function recordGrade(e: LedgerEntry) {
  const s = loadSave()
  if (!s) return null
  const i = s.ledger.findIndex((x) => x.id === e.id)
  const ledger = [...s.ledger]
  if (i >= 0) {
    const was = ledger[i]
    const attempts = (was.attempts ?? 1) + 1
    const firstGrade = was.firstGrade ?? was.grade
    /* Once the retake is used, the row stays marked retaken even if the new grade is worse. */
    /* `retaken` means the school's one Universal Retake is used up. It only counts as used when the
     * attempt before already passed. Trying again after failing is only getting back to a pass, so
     * it doesn't use the retake. */
    /* A D or better, the same as `PASSING_GRADE` in `progress.ts`. It's typed out here because
     * importing it would make a circular import, and `save.test.ts` checks that the two match. */
    const wasPassing = was.grade >= 1.0
    const spent = was.retaken || (wasPassing && !!e.retaken)
    /* The caller's `retaken` is only a request, so it's removed from the incoming row. This
     * function decides whether the retake was used. */
    const { retaken: _asked, ...fresh } = e
    ledger[i] = e.grade > was.grade
      ? { ...fresh, ...(spent ? { retaken: true } : {}), attempts, firstGrade }
      /* The flag only gets added, never saved as false. A row that hasn't been retaken has no
       * `retaken` key at all, and adding one would change the shape of every row that's been
       * written twice. */
      : { ...was, ...(spent ? { retaken: true } : {}), attempts, firstGrade }
  } else {
    ledger.push({ ...e, attempts: 1, firstGrade: e.grade })
  }
  return writeSave({ ledger })
}

/* Called when the student is shown a place, and again with docked=true when they land there. */
export function recordExposure(place: string, docked = false) {
  const s = loadSave()
  if (!s || !place) return null
  const rows = [...(s.exposure ?? [])]
  const i = rows.findIndex((x) => x.place === place && x.year === s.year)
  if (i >= 0) {
    if (rows[i].docked || !docked) return s
    rows[i] = { ...rows[i], docked: true }
  } else {
    rows.push({ place, year: s.year, docked })
  }
  return writeSave({ exposure: rows })
}

/* Writes one row per programme per year. If this year's row exists, it updates that row instead of
 * adding another. */
/* A voyage is counted the same way as a class. A null grade means it was done but not scored. */
export function recordCompletion(programme: string, grade: number | null, rank?: string) {
  const s = loadSave()
  if (!s || !programme) return null
  const rows = [...(s.completions ?? [])]
  const i = rows.findIndex((c) => c.programme === programme && c.year === s.year)
  if (i < 0) {
    rows.push({ programme, year: s.year, grade, at: Date.now(), attempts: 1, firstGrade: grade, ...(rank ? { rank } : {}) })
    return writeSave({ completions: rows })
  }
  const was = rows[i]
  const attempts = (was.attempts ?? 1) + 1
  /* Never overwritten, the same as the ledger's first grade. */
  const firstGrade = was.firstGrade === undefined ? was.grade : was.firstGrade
  /* A finish with no grade never replaces a grade and never loses to one. It only says the thing
   * was done, and the row already says that. */
  const better = grade !== null && (was.grade === null || grade > was.grade)
  rows[i] = {
    ...was,
    ...(better ? { grade } : {}),
    attempts,
    firstGrade,
    /* A better grade doesn't change which ladder the year counted toward. So a later write with no
     * track keeps the one already on the row. */
    ...(rank ? { rank } : was.rank ? { rank: was.rank } : {}),
  }
  return writeSave({ completions: rows })
}

/** Whether this student finished this programme in this year. The voyage asks this. */
export const completedIn = (s: SaveGame, programme: string, year: number): boolean =>
  (s.completions ?? []).some((c) => c.programme === programme && c.year === year)

/** Every year this student finished this programme. The count is how high they are on the ladder. */
export const yearsCompleted = (s: SaveGame, programme: string): number[] =>
  (s.completions ?? []).filter((c) => c.programme === programme).map((c) => c.year).sort()

/* Saves where the run is, on every map change. This only saves it. The rules for resuming, and the
 * check that reads it, are in `run/resume.ts`. A position with no map is refused instead of saved
 * empty. */
export function recordPosition(p: Omit<RunPosition, 'at'>) {
  const s = loadSave()
  if (!s || !p.map) return null
  return writeSave({ where: { ...p, at: Date.now() } })
}

/* A vessel record is a berth name and a leg count, never a spot on the water. That way a ship can
 * never be restored in the middle of the sea, and the rule is built into the shape of the data. */
export function recordVessel(v: VesselRecord) {
  const s = loadSave()
  if (!s || !v?.berthedAt) return null
  return writeSave({ vessel: v })
}

/* Frozen once. A second call does nothing and gives back what's already there, because the code
 * printed on the diploma has to keep matching the roster even if the player keeps sailing after
 * graduating. */
export function freezeRun(d: FrozenRun): SaveGame | null {
  const s = loadSave()
  if (!s) return null
  if (s.diploma) return s
  return writeSave({ diploma: d })
}

export function spendToken(season: Season): ReturnType<typeof writeSave> | null {
  const s = loadSave()
  if (!s) return null
  const i = s.tokens.indexOf(season)
  if (i < 0) return null
  const tokens = [...s.tokens]; tokens.splice(i, 1)
  return writeSave({ tokens })
}

/* The ledger id for a programme's voyage. It only depends on the programme and the year, so it
 * stays the same. */
export const islandLedgerId = (programme: string, year: number) => `island:${programme}:y${year}`

/** Sets the state of one programme in this run, keyed by programme id. */
export function setIslandState(id: string, state: IslandState) {
  const s = loadSave()
  if (!s) return null
  const next = writeSave({ islands: { ...s.islands, [id]: state } })
  if (state === 'completed') {
    /* Don't count this as a second try. `recordCompletion` counts attempts, so adding a row for a
     * programme that already has one this year would turn one finish into two tries. If there's no
     * ledger row, the grade is null and not 0, because finishing without a score isn't an F. */
    if ((s.completions ?? []).some((c) => c.programme === id && c.year === s.year)) return next
    const row = s.ledger.find((e) => e.id === islandLedgerId(id, s.year))
    return recordCompletion(id, row ? row.grade : null) ?? next
  }
  return next
}

export function collectFact(id: string) {
  const s = loadSave()
  if (!s || s.facts.includes(id)) return s
  return writeSave({ facts: [...s.facts, id] })
}

export function collectSticker(id: string) {
  const s = loadSave()
  if (!s || s.stickers.includes(id)) return s
  return writeSave({ stickers: [...s.stickers, id] })
}

export function grantBadge(id: string) {
  const s = loadSave()
  if (!s || s.badges.includes(id)) return s
  return writeSave({ badges: [...s.badges, id] })
}

/* What an island has ticked off this year. A list from a different year counts as nothing. It never
 * throws and never writes, so a caller with no run gets an empty list. */
export function tasksDoneIn(programme: string, year: number): string[] {
  const row = loadSave()?.tasks?.[programme]
  return row && row.year === year ? row.done : []
}

/**
 * Ticks off one of an island's tasks. Ticking the same task twice is fine, because an island might
 * call it twice.
 */
export function markTaskDone(programme: string, year: number, id: string) {
  const s = loadSave()
  if (!s) return s
  const row = s.tasks?.[programme]
  const done = row && row.year === year ? row.done : []
  if (done.includes(id)) return s
  return writeSave({ tasks: { ...(s.tasks ?? {}), [programme]: { year, done: [...done, id] } } })
}

export function setFlag(id: string) {
  const s = loadSave()
  if (!s || s.flags.includes(id)) return s
  return writeSave({ flags: [...s.flags, id] })
}

export function hasFlag(id: string): boolean {
  return loadSave()?.flags.includes(id) ?? false
}

/**
 * Moves to the next year. The fourth time is the last one: it marks the run graduated instead of
 * refilling tokens, because senior year doesn't repeat.
 */
export function endYear() {
  const s = loadSave()
  if (!s) return null
  if (s.year >= 4) return writeSave({ graduated: true })
  return writeSave({ year: s.year + 1, season: 'Fall', tokens: [...SEASONS] })
}

// The year planner's functions. The sheet on the chart table saves through these.

const planOf = (s: SaveGame, year: number): YearPlan =>
  s.plans[year] ?? { slots: {}, classes: [], stamped: false }

/**
 * Puts a season token on an activity. It spends the token, or changes an already spent season if
 * the plan isn't stamped yet. Once the plan is stamped it refuses.
 */
export function assignSlot(year: number, season: Season, activityId: string) {
  const s = loadSave()
  if (!s) return null
  const plan = planOf(s, year)
  if (plan.stamped) return null
  /* The season lock is checked here and not only in the sheet's menu. */
  if (refuseSlot(activityId, season, s, year)) return null
  const tokens = [...s.tokens]
  if (!plan.slots[season]) {
    const i = tokens.indexOf(season)
    if (i < 0) return null                 // No token for that season. Shouldn't happen before stamping.
    tokens.splice(i, 1)
  }
  const next: YearPlan = { ...plan, slots: { ...plan.slots, [season]: activityId } }
  return writeSave({ plans: { ...s.plans, [year]: next }, tokens })
}

/**
 * Takes a token back off the sheet, only before the stamp, and that season's token goes back to the
 * player.
 */
export function clearSlot(year: number, season: Season) {
  const s = loadSave()
  if (!s) return null
  const plan = planOf(s, year)
  if (plan.stamped || !plan.slots[season]) return null
  const slots = { ...plan.slots }
  delete slots[season]
  return writeSave({
    plans: { ...s.plans, [year]: { ...plan, slots } },
    tokens: [...s.tokens, season],
  })
}

/**
 * Picks a focus class, at most 2 a year. The two-pick limit, the duplicate check and the grade
 * check all live in one refusal in `run/refusal.ts`, so the sheet shows the same message this
 * function enforces.
 */
export function pickClass(year: number, classId: string) {
  const s = loadSave()
  if (!s) return null
  const plan = planOf(s, year)
  if (refuseClass(classId, s, year)) return null
  return writeSave({ plans: { ...s.plans, [year]: { ...plan, classes: [...plan.classes, classId] } } })
}

export function dropClass(year: number, classId: string) {
  const s = loadSave()
  if (!s) return null
  const plan = planOf(s, year)
  if (plan.stamped || !plan.classes.includes(classId)) return null
  return writeSave({ plans: { ...s.plans, [year]: { ...plan, classes: plan.classes.filter((c) => c !== classId) } } })
}

/**
 * The harbor master's stamp: the year's plan gets locked, and the programmes in its slots turn
 * active.
 */
export function stampPlan(year: number, activeProgrammeIds: string[] = []) {
  const s = loadSave()
  if (!s) return null
  const plan = planOf(s, year)
  if (plan.stamped) return null
  const islands = { ...s.islands }
  /* The stamp only marks programmes as active, never completed, so a finished programme keeps its
   * color. */
  for (const id of activeProgrammeIds) if (islands[id] !== 'completed') islands[id] = 'active'
  return writeSave({
    plans: { ...s.plans, [year]: { ...plan, stamped: true } },
    islands,
  })
}
