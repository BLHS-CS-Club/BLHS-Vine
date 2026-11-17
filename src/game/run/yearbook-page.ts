/* The yearbook page for one year, as plain data: five sections in a fixed order. */
import type { SaveGame } from '../save'
import { writeSave } from '../save'
import { cordsOf, gpaOf, letterOf } from '../progress'
import { wallOf } from './wall'
import { placeById } from '../roster/roster'
import { nudgeLine, yearStatus } from './year'

export type YearbookRow = {
  key: string
  title: string
  meta: string
  /* A number from 0 to 1 when the row is only partly done. A cord at 0.4 is 40 percent of the way
   * there, not a locked achievement. */
  progress?: number
  /** The school's own words for what this row is, when the school has them. */
  rule?: string
  /** The row is finished, so a drawn stamp goes on it. */
  done?: boolean
  /* A face from one of the platform's sprite sheets for this row, as `[piece, face]`. This lets a
   * season show its drawn pip instead of a word. */
  face?: [string, string]
}

export type YearbookSection = {
  id: YearbookSectionId
  heading: string
  rows: YearbookRow[]
  /** Shown INSTEAD of the rows when there are none. The section itself never disappears. */
  empty: string
  /** Shown under the heading when the rows aren't really about this year. */
  caveat?: string
}

/* The five sections, always in this order, whether or not they have anything in them. */
export const YEARBOOK_SECTIONS = ['paper', 'seasons', 'waters', 'marks', 'threads'] as const
export type YearbookSectionId = typeof YEARBOOK_SECTIONS[number]

/* Which way the GPA moved since last year. This is decided here, not in the view. */
export type GpaMove = 'first' | 'up' | 'down' | 'held'

export type YearbookPage = {
  year: number
  /** The page has been turned, so this is a past year and not the current one. */
  turned: boolean
  /** This is the year the run is actually in. */
  current: boolean
  /* The year is finished, so the page can be turned. */
  ready: boolean
  /** The run is over, so this is the last page. */
  final: boolean
  /** The credit-weighted GPA for the transcript up to and including this year. */
  gpa: number | null
  /** The same GPA up to the year before, or null in year one. */
  priorGpa: number | null
  /** This year's GPA on its own, so a change in the total can be traced to this year. */
  yearGpa: number | null
  letter: string
  move: GpaMove
  sections: YearbookSection[]
  nudge: string
}

/** Every year that has a page, oldest first. Year one has a page as soon as the run starts. */
export const yearbookYears = (s: SaveGame): number[] =>
  Array.from({ length: Math.max(1, Math.min(4, s.year)) }, (_, i) => i + 1)

/** Whether this year's page has been turned, using the flag the turn saves. */
export const yearTurned = (s: SaveGame, year: number): boolean =>
  s.flags.includes(`yearbook:y${year}`)

/* The credit-weighted GPA for part of a transcript, using the game's one weighting. */
export const gpaThrough = (s: SaveGame, upTo: number): number | null =>
  gpaOf({ ...s, ledger: s.ledger.filter((e) => e.year <= upTo) })

const meanOfYear = (s: SaveGame, year: number): number | null =>
  gpaOf({ ...s, ledger: s.ledger.filter((e) => e.year === year) })

/* Stickers don't have names anywhere. `collectSticker` takes a string id and there's no sticker
 * table, so the label is the id turned into readable words. This is the one place to change once a
 * sticker catalog exists. */
export const stickerLabel = (id: string): string =>
  id.replace(/^[a-z0-9_-]+:/, '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function yearbookPage(s: SaveGame, year: number = s.year): YearbookPage {
  const st = yearStatus(s, year)
  const gpa = gpaThrough(s, year)
  const priorGpa = year <= 1 ? null : gpaThrough(s, year - 1)
  const yearGpa = meanOfYear(s, year)
  const move: GpaMove =
    priorGpa === null || gpa === null ? 'first'
      : gpa > priorGpa ? 'up'
        : gpa < priorGpa ? 'down'
          : 'held'

  /* ---- the transcript, the only section that's truly about this year alone ---- */
  const paper: YearbookSection = {
    id: 'paper',
    heading: 'Your grades this year',
    /* Class rows don't show a season. `s.season` is always 'Fall' because nothing moves it forward,
     * and classes have no season in the catalog, so the word would be made up. The row shows
     * attempts instead, and the clubs and sports section below keeps the real seasons. */
    rows: s.ledger.filter((e) => e.year === year).map((e) => ({
      key: e.id,
      title: e.title,
      meta: [
        letterOf(e.grade),
        e.attempts && e.attempts > 1 && e.firstGrade !== undefined
          ? `${e.attempts} tries, first ${letterOf(e.firstGrade)}`
          : null,
        e.retaken ? 'retaken' : null,
      ].filter(Boolean).join(' · '),
    })),
    empty: 'Nothing was graded this year. A quiet one on the transcript.',
  }

  /* ---- what the three tokens were spent on ---- */
  const seasons: YearbookSection = {
    id: 'seasons',
    heading: 'Clubs and sports you picked',
    rows: st.voyages.map((v) => ({
      key: v.season,
      title: v.name,
      meta: `${v.season} · ${v.done ? 'finished' : v.playable ? 'not done yet' : 'not open yet'}`,
      done: v.done,
      /* The pip sheet draws fall, winter and spring as three different coins, the same ones the HUD
       * tokens use. That way a row shows its season without the student reading the word. */
      face: ['pip', v.season.toLowerCase()] as [string, string],
    })),
    empty: 'You did not join a club or a sport this year.',
  }

  /* The places the student saw this year. This is the part a student is most likely to be surprised
   * by. */
  const waters: YearbookSection = {
    id: 'waters',
    heading: 'Places you saw',
    rows: (s.exposure ?? []).filter((e) => e.year === year).map((e) => ({
      key: e.place,
      title: placeById(e.place)?.name ?? e.place,
      meta: e.docked ? 'you went inside' : 'you only saw it from outside',
      done: e.docked,
    })),
    empty: 'You did not see any new places this year.',
  }

  /* The badges section, plus a note that stickers aren't tied to a year. */
  /* This year's earned wall badges first, then any stickers an island gave out. */
  const wall = wallOf(s, year).filter((w) => w.earned)
  const marks: YearbookSection = {
    id: 'marks',
    heading: 'Badges on your wall',
    rows: [
      ...wall.map((w) => ({
        key: w.id,
        title: w.name,
        meta: w.says ?? 'done',
        done: true,
        face: ['stamp', 'awarded'] as [string, string],
      })),
      ...s.stickers.map((id) => ({
        key: `sticker:${id}`,
        title: stickerLabel(id),
        meta: 'you earned this',
        done: true,
        face: ['stamp', 'awarded'] as [string, string],
      })),
    ],
    empty: 'No badges on the wall yet. Finish a thing and its badge goes up.',
    caveat: s.year > 1 && s.stickers.length > 0
      ? 'stickers are from every year, not only this one'
      : undefined,
  }

  /* ---- the cords, with a note that they show today's progress ---- */
  const threads: YearbookSection = {
    id: 'threads',
    heading: 'Your cords',
    rows: cordsOf(s)
      .filter((c) => c.earned || c.progress > 0)
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 4)
      .map((c) => ({
        key: c.id,
        title: c.name,
        meta: c.earned ? 'earned' : c.detail,
        progress: c.progress,
        /* The school's own words for this cord's rule, passed through from cordsOf. */
        rule: c.rule,
        done: c.earned,
      })),
    empty: 'No cord started yet. There is time.',
    caveat: year < s.year ? 'as your cords stand today, not as they stood then' : undefined,
  }

  return {
    year,
    turned: yearTurned(s, year),
    current: year === s.year,
    ready: st.readyForYearbook,
    final: year >= 4 || !!s.graduated,
    gpa,
    priorGpa,
    yearGpa,
    letter: gpa !== null ? letterOf(gpa) : '',
    move,
    sections: [paper, seasons, waters, marks, threads],
    nudge: nudgeLine(st, s),
  }
}

/* How wide a cord's progress bar is, as a percent. It's kept out of the component so a test or a
 * summary can work it out too. The number comes from `cordsOf`. */
export const threadWidth = (s: SaveGame, cordId: string): number => {
  const c = cordsOf(s).find((x) => x.id === cordId)
  return c ? Math.round(Math.max(0, Math.min(1, c.progress)) * 100) : 0
}

/* Turning the page is one save, so a year can never end up half advanced. */
export function turnYearPage(s: SaveGame, year: number): SaveGame {
  const mark = `yearbook:y${year}`
  const flags = s.flags.includes(mark) ? s.flags : [...s.flags, mark]
  /* Turning the page never moves to the next year. In year four it marks the run as graduated. */
  return s.year >= 4 ? writeSave({ flags, graduated: true }) : writeSave({ flags })
}
