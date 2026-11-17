/* Tests that keep the play screen clean. Everything that's been given shows up, and nothing extra
 * does. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { SaveGame } from '../save'
import {
  ALWAYS_ON, CHART_FLAG, HANDBOOK_FLAG, HUD_INVENTORY, hudGrants, type HudElement,
} from './inventory'

/* Four saves, one for each kind of student this screen has to work for. They're named for the state
 * the run is in. */
const run = (over: Partial<SaveGame> = {}): SaveGame => ({
  v: 2, id: 'r_t', handle: 'BraveTide', pronouns: 'they/them', boatName: 'Kestrel',
  year: 1, season: 'Fall', beat: 'maw:arrive', introDone: true,
  plans: {}, flags: [], tokens: ['Fall', 'Winter', 'Spring'],
  ledger: [], ranks: {}, islands: {}, exposure: [], completions: [],
  stickers: [], facts: [], badges: [], savedAt: 0,
  ...over,
} as unknown as SaveGame)

const FRESH = run()
const AFTER_FOUNDING = run({ flags: [CHART_FLAG, HANDBOOK_FLAG] })
const MID_YEAR_TWO = run({
  year: 2, flags: [CHART_FLAG, HANDBOOK_FLAG], tokens: ['Spring'],
  ledger: [{ id: 'x', title: 'CTE', kind: 'island', credit: 1, grade: 3.4, year: 1, season: 'Fall', tags: ['cte'] }],
} as Partial<SaveGame>)
const GRADUATED = run({ year: 4, graduated: true, flags: [CHART_FLAG, HANDBOOK_FLAG], tokens: [] } as Partial<SaveGame>)

describe('the HUD assembles as the game grants things', () => {
  /* Nothing is in the corner until the game has handed it over. */
  it('gives a brand new run NOTHING in the corner', () => {
    const g = hudGrants(FRESH)
    expect(g).toEqual({ chart: false, handbook: false, tokens: false, cape: false })
  })

  it('and gives a run with no save at all nothing, without throwing', () => {
    expect(hudGrants(null)).toEqual({ chart: false, handbook: false, tokens: false, cape: false })
  })

  it('hands over the chart and the binder when the run says they were handed over', () => {
    const g = hudGrants(AFTER_FOUNDING)
    expect(g.chart).toBe(true)
    expect(g.handbook).toBe(true)
    expect(g.tokens).toBe(true)
  })

  it('puts the cape within reach at the first cord in progress and not before', () => {
    expect(hudGrants(AFTER_FOUNDING).cape).toBe(false)
    expect(hudGrants(MID_YEAR_TWO).cape).toBe(true)
  })

  /* The season pips go away at graduation. Everything else stays. */
  it('takes the pips away at graduation and leaves everything else', () => {
    const g = hudGrants(GRADUATED)
    expect(g.tokens).toBe(false)
    expect(g.chart).toBe(true)
    expect(g.handbook).toBe(true)
  })

  it('never takes back anything the table calls permanent', () => {
    /* A permanent row must never go from true back to false. So every permanent row is checked
     * against saves that have strictly more progress than the one that gave it. */
    for (const row of HUD_INVENTORY.filter((r) => r.permanent)) {
      if (!row.has(AFTER_FOUNDING)) continue
      expect(row.has(MID_YEAR_TWO), `${row.el} was granted and then taken back`).toBe(true)
      expect(row.has(GRADUATED), `${row.el} was granted and then taken back`).toBe(true)
    }
  })
})

describe('the absence list is enforced rather than intended', () => {
  it('has a row for every element the corner can hold, and no orphans', () => {
    const rows = HUD_INVENTORY.map((r) => r.el).sort()
    const els: HudElement[] = ['chart', 'handbook', 'tokens', 'cape']
    expect(rows).toEqual([...els].sort())
    /* TypeScript already catches a new member with no row. This check catches a row that got
     * deleted or duplicated. */
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('gives every element a sentence to say when it arrives', () => {
    /* If something appears partway through a session with no explanation, a student raises their
     * hand, and the teacher usually won't be free to answer. */
    for (const row of HUD_INVENTORY) {
      expect(row.says.length, `${row.el} arrives without saying what it is`).toBeGreaterThan(12)
      expect(row.rule.length, `${row.el} has no stated rule`).toBeGreaterThan(12)
    }
  })

  /* This is the test that catches a new floating element. Anything drawn on the play screen has to
   * be named in ALWAYS_ON, and the test reads the component file itself to check. */
  it('lets nothing float that the absence list does not name', () => {
    const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
    /* The play screen is whatever WorldHud mounts, so the components in its render are everything
     * that can be on screen while the player is in control. */
    const hud = read('src/game/hud/WorldHud.tsx')
    const mounted = [...hud.matchAll(/<([A-Z][A-Za-z]*)\s*\/?>/g)].map((m) => m[1])
    const KNOWN: Record<string, string> = {
      Hud: 'chart', Dialogue: 'dialogue', WorldCutscene: 'dialogue',
      PlaceCard: 'place-card', ObjectivePanel: 'objective',
      /* The question mark button, listed here like everything else. */
      HelpButton: 'help',
      /* The chart's own button. It sits right above the help button and opens only the map. */
      ChartButton: 'chart',
      /* The movie bars are on the list because they mount on the play screen, even though they draw
       * nothing until an island asks for them. */
      MovieBars: 'movie-bars',
      SkipVoyage: 'skip-voyage',
      CameraToggle: 'camera-view',
      /* The button to leave a finished island. It only draws once an island is finished. */
      HeadBack: 'head-back',
    }
    const strangers = mounted.filter((m) => !(m in KNOWN))
    expect(strangers,
      'a component mounted on the play screen with no entry in the absence list. '
      + 'Part IV §40.6 forbids a floating readout; add it to ALWAYS_ON with its '
      + 'diegetic justification, or do not float it.').toEqual([])
    for (const m of mounted) {
      expect(ALWAYS_ON as readonly string[], `${m} maps to a name the absence list does not carry`)
        .toContain(KNOWN[m])
    }
  })

  it('names the five things that must never appear, so a reader meets them here too', () => {
    /* The things that must never show up, each with what the game uses in its place. */
    const forbidden = {
      'GPA bar': 'the room fills; the number lives on the Handbook Cords page',
      'XP or level': 'per-track ranks, JV to Varsity to Captain',
      'quest log': 'one live objective, which is the heading sentence',
      minimap: 'the chart, a Handbook tab',
      leaderboard: 'study integrity, not taste: competition is what Kahoot is built on',
    }
    expect(Object.keys(forbidden)).toHaveLength(5)
    for (const why of Object.values(forbidden)) expect(why.length).toBeGreaterThan(10)
  })
})
