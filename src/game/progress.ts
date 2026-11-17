// Works out the GPA, ranks and graduation cords from the run's ledger of classes and activities.

import type { SaveGame } from './save'
import { rankTrackOf } from './roster/roster'

export function gpaOf(s: SaveGame): number | null {
  if (!s.ledger.length) return null
  let pts = 0, cr = 0
  for (const e of s.ledger) { pts += e.grade * e.credit; cr += e.credit }
  return cr ? Math.round((pts / cr) * 100) / 100 : null
}

export const letterOf = (g: number) =>
  g >= 3.85 ? 'A' : g >= 3.5 ? 'A-' : g >= 3.15 ? 'B+' : g >= 2.85 ? 'B' : g >= 2.5 ? 'B-' :
  g >= 2.15 ? 'C+' : g >= 1.85 ? 'C' : g >= 1.5 ? 'C-' : g >= 1.0 ? 'D' : 'F'

/** The one passing rule used everywhere. A D or better earns the credit and an F earns nothing. */
export const PASSING_GRADE = 1.0
const passed = (e: SaveGame['ledger'][number]) => e.grade >= PASSING_GRADE

/** The rank ladder. The number is how many years the student has spent on one programme's track. */
export const rankName = (years: number) =>
  years >= 3 ? 'Captain' : years >= 2 ? 'Varsity' : years >= 1 ? 'JV' : null

/** How many years the student has put into each rank track, counted from the completion record. */
export function ranksOf(s: SaveGame): Record<string, number> {
  const years = new Map<string, Set<number>>()
  for (const c of s.completions ?? []) {
    if (!c.rank) continue
    const set = years.get(c.rank) ?? new Set<number>()
    set.add(c.year)
    years.set(c.rank, set)
  }
  const out: Record<string, number> = { ...s.ranks }
  for (const [track, set] of years) out[track] = Math.max(out[track] ?? 0, set.size)
  return out
}

export type CordProgress = {
  id: string
  name: string
  colors: string                 // The real cord colors, for the tracker art.
  /* The school's own words, copied exactly. This is the only text a student reads as the
   * requirement. If the school gave no words, it says that instead. */
  rule: string
  /** Where those words came from, clear enough that someone could go find it. */
  source: string
  /* What this game actually counts, when that's different from the school's rule. It's shown next
   * to the rule, never instead of it. Leave it out when the game counts the real requirement. */
  model?: string
  /* Whether the school has published any requirements for this award. `false` means the award is
   * real but the rules are unknown, and the board has to show that differently from "you haven't
   * earned it yet". */
  published: boolean
  // True when this cord is only decided at graduation instead of earned along the way.
  settlesAtGraduation?: boolean
  earned: boolean
  progress: number               // 0 to 1 toward earning it, for the fraying thread art.
  detail: string                 // Live status line, like "3 of 5 AP classes passed".
}

// The source line under a cord. It names a school document the student could go and find.
const AWARDS = 'the BLHS awards list, from Ms. Pinzon'

/** What the game says about there being no cord for reaching Captain. */
export const NO_ATHLETIC_CORD =
  'Bonney Lake awards no cord for reaching Captain. Your rank is printed on your diploma instead. ' +
  `Source: ${AWARDS}.`

const count = (s: SaveGame, f: (e: SaveGame['ledger'][number]) => boolean) => s.ledger.filter(f).length

/** Passed credits in the student's best single world language, and which language it is. */
function languageCredits(s: SaveGame): { best: number; family: string | null } {
  const byFamily = new Map<string, number>()
  for (const e of s.ledger) {
    if (!e.tags?.includes('lang') || !passed(e)) continue
    const m = /^class:([a-z]+)-\d+$/.exec(e.id)
    if (!m) continue
    byFamily.set(m[1], (byFamily.get(m[1]) ?? 0) + 1)
  }
  let best = 0, family: string | null = null
  for (const [k, n] of byFamily) if (n > best) { best = n; family = k }
  return { best, family }
}

/** Checks every cord and seal against the run right now. */
export function cordsOf(s: SaveGame): CordProgress[] {
  const gpa = gpaOf(s) ?? 0
  const finished = s.introDone && s.year >= 4 // Cords based on final GPA are only decided at graduation.
  const cte = count(s, (e) => !!e.tags?.includes('cte') && passed(e))
  const ap = count(s, (e) => !!e.tags?.includes('ap') && passed(e))
  const apSeminar = count(s, (e) => e.id === 'class:ap-seminar' && passed(e))
  const apResearch = count(s, (e) => e.id === 'class:ap-research' && passed(e))
  const lang = languageCredits(s)
  // Key Club's rank track comes from the roster instead of being typed out here.
  const keyYears = ranksOf(s)[rankTrackOf('key-club') ?? 'keyclub'] ?? 0

  return [
    {
      id: 'highest-honors', name: 'Highest Honors', colors: 'double gold',
      rule: 'GPA 3.76-4.0', source: AWARDS, published: true,
      model: 'Counted at graduation, from your GPA across all four years.',
      settlesAtGraduation: true,
      earned: finished && gpa >= 3.76, progress: Math.min(1, gpa / 3.76),
      // A student with no grades yet is told so, instead of being shown 0.00.
      /* A GPA that already meets the target says so, instead of looking like it's short. */
      detail: !gpa ? 'No GPA yet. You need 3.76.'
        : gpa >= 3.76 ? `GPA ${gpa.toFixed(2)}. On track, counted at graduation.`
          : `GPA ${gpa.toFixed(2)} of 3.76`,
    },
    {
      id: 'high-honors', name: 'High Honors', colors: 'black & silver',
      rule: 'GPA 3.5-3.759', source: AWARDS, published: true,
      model: 'Counted at graduation. You can only get one of these two, and Highest Honors comes first.',
      settlesAtGraduation: true,
      earned: finished && gpa >= 3.5 && gpa < 3.76,
      /* A GPA above 3.76 doesn't count toward this cord. It earns a different one. */
      progress: gpa >= 3.76 ? 0 : Math.min(1, gpa / 3.5),
      detail: !gpa ? 'No GPA yet. You need 3.5.'
        /* This cord has a top limit as well as a bottom one. A 3.9 is Highest Honors and not this
         * cord, so the bar here must not show full. */
        : gpa >= 3.76 ? `GPA ${gpa.toFixed(2)}. Above this one: you are on Highest Honors.`
          : gpa >= 3.5 ? `GPA ${gpa.toFixed(2)}. On track, counted at graduation.`
            : `GPA ${gpa.toFixed(2)} of 3.5`,
    },
    {
      id: 'career-readiness', name: 'Career Readiness', colors: 'green, teal & purple',
      rule: 'Must have completed at least two CTE credits', source: AWARDS, published: true,
      model: 'Pass two CTE classes. CTE is Career and Technical Education, like Culinary Arts. A D passes.',
      earned: cte >= 2, progress: Math.min(1, cte / 2),
      /* The count stops at the target, the same as `progress` does. So four passed CTE classes show
       * "2 of 2", never "4 of 2". */
      detail: `${Math.min(cte, 2)} of 2 CTE credits`,
    },
    {
      id: 'key-club', name: 'Key Club', colors: 'navy',
      rule: 'Active International Key Club member for at least 2 years, including senior year; GPA over 3.0; '
        + '40+ volunteer hours each year over 4 years (over 160 hours total); attend 15 meetings each year and 5+ service events',
      source: AWARDS, published: true,
      model: 'This game only counts your years in Key Club and your GPA. '
        + 'It does not count hours, meetings or events.',
      earned: keyYears >= 2 && s.year >= 4 && gpa >= 3.0,
      /* The bar only measures years in Key Club, because good grades alone don't put a student on
       * the way to this cord. The GPA requirement goes in the sentence instead, as something the
       * cord can still fail on. */
      progress: Math.min(keyYears, 2) / 2,
      detail: [
        `${Math.min(keyYears, 2)} of 2 years`,
        !gpa ? 'no GPA yet'
          : gpa >= 3.0 ? `GPA ${gpa.toFixed(2)}, over the 3.0 it needs`
            : `GPA ${gpa.toFixed(2)}, under the 3.0 it needs`,
      ].join(' · '),
    },
    {
      id: 'ap-honors', name: 'AP Honors', colors: 'AP blue',
      rule: 'Pass 5 or more AP courses', source: AWARDS, published: true,
      model: 'Passing means a D or better, the same as any other class. The class counts, not the AP exam.',
      earned: ap >= 5, progress: Math.min(1, ap / 5),
      detail: `${Math.min(ap, 5)} of 5 AP classes passed`,
    },
    {
      id: 'ap-capstone', name: 'AP Capstone', colors: 'capstone silver',
      rule: 'AP Seminar & Research plus 4 additional AP classes', source: AWARDS, published: true,
      model: 'Pass six AP classes in all. Two of them have to be AP Seminar and AP Research. The exams are not counted.',
      earned: apSeminar >= 1 && apResearch >= 1 && ap >= 6,
      progress: Math.min(1, (apSeminar + apResearch) / 2 * 0.5 + Math.min(1, Math.max(0, ap - 2) / 4) * 0.5),
      // Use words instead of check mark symbols, because this text gets printed and a symbol might
      // not print right.
      detail: `Seminar ${apSeminar ? 'passed' : 'not yet'}, Research ${apResearch ? 'passed' : 'not yet'}, ${ap} APs passed`,
    },
    {
      id: 'seal-biliteracy', name: 'Seal of Biliteracy', colors: 'gold medal',
      rule: 'Awarded to students who show proficiency in English and at least one other language before high school graduation',
      source: `${AWARDS} · RCW 28A.300.575 · WAC 392-410-350 (OSPI)`, published: true,
      model: 'Take four credits of the same world language. '
        + 'Graduating counts as the English part.',
      earned: lang.best >= 4,
      progress: Math.min(1, lang.best / 4),
      detail: lang.family
        ? `${lang.best} of 4 credits in one language (${lang.family})`
        : '0 of 4 credits in one language',
    },
    // Two real awards that have no published requirements. They're listed with a note saying so,
    // and can never be earned.
    ...['Valedictorian', 'Salutatorian'].map((name, i) => ({
      id: name.toLowerCase(),
      name,
      colors: 'color not announced',
      rule: 'Bonney Lake High School has not published criteria for this award.',
      source: `${AWARDS}, which marks this a known gap`,
      /* Handbook.tsx already puts "In this game: " in front of this text, so don't start it with
       * "In this game" again. */
      model: `it would go to the ${i === 0 ? 'highest' : 'second-highest'} GPA in the class, `
        + 'which is this game\'s guess rather than a rule from Bonney Lake.',
      published: false,
      earned: false,
      progress: 0,
      detail: 'Not awarded in this game.',
    })),
  ]
}

/**
 * Finds cords that just reached halfway for the first time and aren't earned yet, so the game can
 * point them out.
 */
export function newlyCloseCords(before: SaveGame, after: SaveGame): CordProgress[] {
  const prev = new Map(cordsOf(before).map((c) => [c.id, c.progress]))
  return cordsOf(after).filter((c) => c.progress >= 0.5 && (prev.get(c.id) ?? 0) < 0.5 && !c.earned)
}

/**
 * Sums up the run for the end screen the student turns in. The same function runs in the browser to
 * stamp the diploma and on the server over the synced save, which is how the verification code can
 * be checked.
 */
export function transcriptOf(s: SaveGame): import('../vine/verify').Transcript {
  return {
    participantId: s.participantId ?? 'castaway',
    handle: s.handle,
    gpa: gpaOf(s),
    cords: cordsOf(s).filter((c) => c.earned).map((c) => c.id).sort(),
    ranks: ranksOf(s),
    islandsCompleted: Object.values(s.islands).filter((st) => st === 'completed').length,
    /* Places seen and programmes finished are two separate numbers. One counts what the student
     * looked at and the other counts what they finished, so neither can stand in for the other. */
    placesSeen: new Set((s.exposure ?? []).map((e) => e.place)).size,
    programmesCompleted: new Set((s.completions ?? []).map((c) => c.programme)).size,
    factsLearned: s.facts.length,
    years: s.year,
  }
}
