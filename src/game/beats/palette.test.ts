// Tests for the palette, and checks that the plain form and the game build the same questions from
// it.
import { describe, it, expect } from 'vitest'
import type { CheckStep } from '../../vine/contract'
import fs from 'node:fs'
import path from 'node:path'
import {
  PALETTE, checkIdOf, fullMarks, plainOf, pointsOf, promptOf, refuseCheck, scoreOf,
  type Response,
} from './palette'
import { responseOf, showdownReduce, startShowdown } from './showdown'
import { LATENCY_CONVENTION, latencyOf, markFirst } from './timing'

/* One sample per kind, and the test below fails if a kind ships without one. They're written as
 * real BLHS content, because a sample that reads like fake test data is one nobody notices is
 * wrong. */
const SAMPLES: { [K in CheckStep['kind']]: Extract<CheckStep, { kind: K }> } = {
  choice: {
    kind: 'choice', id: 'c-join', prompt: 'How do you join a club here?',
    options: [
      { text: 'Walk into the meeting', correct: true, reply: 'That is it. Nobody signs you in.' },
      { text: 'Fill out a district form', reply: 'No form. You walk in.' },
    ],
  },
  quiz: {
    kind: 'quiz',
    item: {
      id: 'q-monday', prompt: 'When does Monday start?',
      choices: ['7:30', '8:30'], correctIndex: 1, explanation: 'Monday is the late start.',
    },
  },
  sort: {
    kind: 'sort', id: 's-power', prompt: 'Put each value under its letter.',
    buckets: ['P', 'O'],
    items: [{ label: 'Perseverance', bucket: 'P' }, { label: 'Ownership', bucket: 'O' }],
  },
  number: {
    kind: 'number', id: 'n-credits', prompt: 'How many credits to graduate?',
    answer: 24, tolerance: 0, unit: 'credits', reply: 'Twenty-four, and four of them are English.',
  },
  order: {
    kind: 'order', id: 'o-years', prompt: 'Put the four years in order.',
    items: [
      { label: 'Freshman', position: 1 }, { label: 'Sophomore', position: 2 },
      { label: 'Junior', position: 3 }, { label: 'Senior', position: 4 },
    ],
    reply: 'Four years, and the choices in the first one still show up in the last.',
  },
  place: {
    kind: 'place', id: 'p-office', prompt: 'Where do you go to change a schedule?',
    regions: [
      { name: 'student_services', label: 'Student Services' },
      { name: 'commons', label: 'The Commons' },
    ],
    correct: 'student_services', reply: 'Counsellors sit in Student Services.',
  },
  do: {
    kind: 'do', id: 'd-board', prompt: 'Go and read the activities board.',
    goal: { anchor: 'activities_board', label: 'The activities board' },
    decoys: [{ anchor: 'trophy_case', label: 'The trophy case' }],
    reply: 'The board is where every club posts its first meeting.',
  },
  showdown: {
    kind: 'showdown', id: 'sd-drive', prompt: 'Last drive. Answer to move the chains.',
    opponent: 'Sumner',
    rounds: [
      {
        id: 'r1', prompt: 'What closes a cord?',
        options: [
          { text: 'Meeting the criterion', correct: true, reply: 'Yes. The criterion, not the effort.' },
          { text: 'Showing up', reply: 'Attendance is not a criterion.' },
        ],
      },
      {
        id: 'r2', prompt: 'How many state titles does BLHS hold?',
        options: [
          { text: 'Three', correct: true, reply: 'Soccer, wrestling, softball.' },
          { text: 'None', reply: 'Three, and none of them are football.' },
        ],
      },
    ],
  },
  /* The real ATC puzzle. It shows why program is its own kind: fwd3 is the right instruction at two
   * different slots, and an order check would merge those two slots into one answer, so a
   * full-marks response would score one short. */
  program: {
    kind: 'program', id: 'p-maze', prompt: 'Put the build back in order, then press RUN.',
    grid: [
      '   col  0   1   2   3   4   5',
      ' row 0  .   .   .   .   .   F',
      ' row 1  .   .   .   .   .   .',
      ' row 2  .   .   .   #   .   .',
      ' row 3  P>  .   .   #   .   .',
    ].join('\n'),
    moves: [
      { name: 'fwd2', label: 'forward 2' },
      { name: 'fwd3', label: 'forward 3' },
      { name: 'left', label: 'turn left' },
      { name: 'right', label: 'turn right' },
    ],
    slots: [
      { label: 'Step 1', move: 'fwd2' },
      { label: 'Step 2', move: 'left' },
      { label: 'Step 3', move: 'fwd3' },
      { label: 'Step 4', move: 'right' },
      { label: 'Step 5', move: 'fwd3' },
    ],
    board: {
      cols: 6, rows: 4,
      walls: [[3, 2], [3, 3]],
      flag: [5, 0],
      start: { col: 0, row: 3, facing: 'east' },
    },
    reply: 'The wall is why the turn has to come early.',
  },
}

const kinds = Object.keys(PALETTE) as CheckStep['kind'][]
const sampleOf = (k: CheckStep['kind']): CheckStep => SAMPLES[k]

/** A response that's wrong on every field, built from the plain form. */
const allWrong = (c: CheckStep): Response =>
  Object.fromEntries(plainOf(c).fields.map((f) => {
    const other = f.options.find((o) => o.value !== f.correct)
    return [f.id, other ? other.value : `${f.correct}-not`]
  }))

describe('the nine frames', () => {
  it('the palette carries exactly the nine kinds, and every one has a sample', () => {
    expect([...kinds].sort()).toEqual(
      ['choice', 'do', 'number', 'order', 'place', 'program', 'quiz', 'showdown', 'sort'])
    expect([...kinds].sort()).toEqual(Object.keys(SAMPLES).sort())
  })

  it('every kind scores full marks for a correct answer and zero for a wrong one', () => {
    for (const k of kinds) {
      const c = sampleOf(k)
      expect(pointsOf(c), `${k} points`).toBeGreaterThan(0)
      expect(scoreOf(c, fullMarks(c)), `${k} correct`).toBe(pointsOf(c))
      expect(scoreOf(c, allWrong(c)), `${k} wrong`).toBe(0)
      expect(scoreOf(c, {}), `${k} unanswered`).toBe(0)
    }
  })

  it('the multi-field kinds give partial credit per item rather than all or nothing', () => {
    const sort = SAMPLES.sort
    expect(pointsOf(sort)).toBe(2)
    expect(scoreOf(sort, { 's-power:Perseverance': 'P', 's-power:Ownership': 'P' })).toBe(1)

    const order = SAMPLES.order
    expect(pointsOf(order)).toBe(4)
    // The last two are swapped, so two are wrong.
    expect(scoreOf(order, {
      'o-years:Freshman': '1', 'o-years:Sophomore': '2',
      'o-years:Junior': '4', 'o-years:Senior': '3',
    })).toBe(2)

    expect(pointsOf(SAMPLES.showdown)).toBe(2)
  })

  it('a number reads its declared tolerance and refuses words', () => {
    const exact = SAMPLES.number
    expect(scoreOf(exact, { 'n-credits': '24' })).toBe(1)
    expect(scoreOf(exact, { 'n-credits': '24.5' })).toBe(0)
    expect(scoreOf(exact, { 'n-credits': 'twenty four' })).toBe(0)
    expect(scoreOf(exact, { 'n-credits': '' })).toBe(0)
    expect(scoreOf(exact, { 'n-credits': '  24  ' })).toBe(1)

    const gpa: CheckStep = { kind: 'number', id: 'g', prompt: 'Double gold GPA?', answer: 3.76, tolerance: 0.05 }
    expect(scoreOf(gpa, { g: '3.8' })).toBe(1)
    expect(scoreOf(gpa, { g: '3.5' })).toBe(0)
  })

  it('a place scores the region NAME, so relabelling a door for the player cannot change the answer', () => {
    const c = SAMPLES.place
    expect(scoreOf(c, { 'p-office': 'student_services' })).toBe(1)
    expect(scoreOf(c, { 'p-office': 'Student Services' })).toBe(0)
  })
})

describe('W8: a do is scored on the anchor reached, in either arm', () => {
  const c = SAMPLES.do

  it('the anchor the runner writes IS the value the form offers', () => {
    const options = plainOf(c).fields[0].options.map((o) => o.value)
    expect(options).toContain(c.goal.anchor)
    for (const d of c.decoys) expect(options).toContain(d.anchor)
  })

  it('reaching the goal scores; reaching a decoy is a wrong answer, not a crash', () => {
    expect(scoreOf(c, { 'd-board': 'activities_board' })).toBe(1)
    expect(scoreOf(c, { 'd-board': 'trophy_case' })).toBe(0)
    // An anchor the question never named can't score, so wandering somewhere else isn't an answer.
    expect(scoreOf(c, { 'd-board': 'panther_maw' })).toBe(0)
  })

  it('the game arm and the form produce the same response for the same act', () => {
    // The runner writes {[check.id]: anchor}, and the form writes the value of the picked option.
    expect({ 'd-board': c.goal.anchor }).toEqual(fullMarks(c))
  })
})

describe('ARM PARITY: the plain arm is the game arm, differently drawn', () => {
  /* The showdown's opponent counts as content too. The game shows it on the drive bar and over
   * every question, so the plain form carries it in note. The prompts stay identical, so the parity
   * check still means what it says. */
  it('carries the showdown opponent into the form, without touching the prompt', () => {
    const c: CheckStep = {
      kind: 'showdown', id: 's', prompt: 'Last drive.', opponent: 'Sumner',
      rounds: [{ id: 'r1', prompt: 'Third and long?', options: [
        { text: 'Pass', correct: true, reply: 'Chains move.' },
        { text: 'Punt', reply: 'Not on third.' },
      ] }],
    }
    const r = plainOf(c)
    expect(r.prompt, 'the prompt is the same sentence in both arms').toBe('Last drive.')
    expect(r.note).toContain('Sumner')
  })

  it('every kind renders in plain, with unique fields and the same prompt', () => {
    for (const k of kinds) {
      const c = sampleOf(k)
      const r = plainOf(c)
      expect(r.id, `${k} id`).toBe(checkIdOf(c))
      expect(r.prompt, `${k} prompt`).toBe(promptOf(c))
      expect(r.fields.length, `${k} has fields`).toBeGreaterThan(0)
      expect(new Set(r.fields.map((f) => f.id)).size, `${k} unique fields`).toBe(r.fields.length)
      for (const f of r.fields) {
        if (f.input === 'text') expect(f.options, `${k} text field`).toHaveLength(0)
        else {
          expect(f.options.length, `${k} ${f.id} offers a choice`).toBeGreaterThan(1)
          expect(f.options.map((o) => o.value), `${k} ${f.id} can be answered`).toContain(f.correct)
        }
      }
    }
  })

  it('the plain rendering can reach the same score the game arm can, on every kind', () => {
    // fullMarks is read off the plain fields, so this proves the plain form loses nothing and every
    // point can be earned from it.
    for (const k of kinds) {
      const c = sampleOf(k)
      expect(scoreOf(c, fullMarks(c)), `${k}`).toBe(pointsOf(c))
      expect(Object.keys(fullMarks(c)).length, `${k} field count`).toBe(plainOf(c).fields.length)
    }
  })

  it('CONTENT CONSTANCY: every reply string the game arm speaks reaches the plain arm', () => {
    /* Every reply the game shows has to reach the plain form too. Otherwise a student on the plain
     * form gets less teaching than one in the game, and no event would show it. */
    for (const k of kinds) {
      const c = sampleOf(k)
      const authored = repliesAuthoredOn(c)
      const carried = plainOf(c).replies.map((x) => x.text)
      for (const t of authored) expect(carried, `${k} carries "${t}"`).toContain(t)
    }
  })

  it('a field-wide correction is shown whatever the student did, not only when they were right', () => {
    // Don't tie a field-wide reply to the correct value. Then only the students who got it right
    // would see the explanation, and they're the ones who didn't need it.
    for (const k of ['number', 'order', 'place', 'do', 'quiz'] as const) {
      const r = plainOf(sampleOf(k))
      expect(r.replies.some((x) => x.value === ''), `${k}`).toBe(true)
    }
  })

  it('the showdown chassis answers into the same field space the form offers', () => {
    const c = SAMPLES.showdown
    let s = startShowdown(c.rounds)
    for (const rd of c.rounds) {
      s = showdownReduce(s, { kind: 'pick', index: rd.options.findIndex((o) => o.correct) }, c.rounds)
      s = showdownReduce(s, { kind: 'next' }, c.rounds)
    }
    const fromChassis = responseOf(c.id, s)
    expect(fromChassis).toEqual(fullMarks(c))
    expect(scoreOf(c, fromChassis)).toBe(pointsOf(c))
  })

  it('the runner holds no scoring of its own any more', () => {
    /* This reads the runner's source to make sure it never gets its own scoring code back. Scoring
     * has to go through scoreOf. */
    const src = fs.readFileSync(path.resolve('src/game/beats/ActivityRunner.tsx'), 'utf8')
    for (const mark of ['correctIndex', '.bucket', '.position']) {
      expect(src.includes(mark), `ActivityRunner still reads ${mark}`).toBe(false)
    }
    expect(src).toContain('scoreOf')
  })
})

/**
 * The reply text the author wrote on this check, read from the raw question instead of the plain
 * form, so this test can't pass by agreeing with itself.
 */
function repliesAuthoredOn(c: CheckStep): string[] {
  switch (c.kind) {
    case 'choice': return c.options.map((o) => o.reply).filter(Boolean)
    case 'quiz': return c.item.explanation ? [c.item.explanation] : []
    case 'sort': return []
    case 'showdown': return c.rounds.flatMap((r) => r.options.map((o) => o.reply)).filter(Boolean)
    default: return c.reply ? [c.reply] : []
  }
}

describe('the loader refuses an invalid item and names it (K5)', () => {
  it('passes every sample', () => {
    for (const k of kinds) expect(refuseCheck(sampleOf(k)), k).toBeNull()
  })

  /* An unknown kind is refused instead of crashing the page. */
  it('refuses a kind this game does not have, and lists the ones it does', () => {
    const typo = { kind: 'muliple', id: 'x', prompt: 'p', options: [] } as unknown as CheckStep
    const why = refuseCheck(typo)
    expect(why).toBeTruthy()
    expect(why).toMatch(/"muliple"/)
    /* And the refusal names the real kinds, so the fix is right there in the sentence. */
    for (const k of kinds) expect(why).toContain(k)
  })

  it('refuses two correct options, none, and a one-option question', () => {
    const two: CheckStep = {
      kind: 'choice', id: 'x', prompt: 'p',
      options: [{ text: 'a', correct: true, reply: '' }, { text: 'b', correct: true, reply: '' }],
    }
    expect(refuseCheck(two)).toMatch(/exactly one correct option, it has 2/)
    const none: CheckStep = { kind: 'choice', id: 'x', prompt: 'p', options: [{ text: 'a', reply: '' }, { text: 'b', reply: '' }] }
    expect(refuseCheck(none)).toMatch(/it has 0/)
    const one: CheckStep = { kind: 'choice', id: 'x', prompt: 'p', options: [{ text: 'a', correct: true, reply: '' }] }
    expect(refuseCheck(one)).toMatch(/at least two options/)
  })

  it('refuses a do with no decoys, because the control arm would get one option', () => {
    const c: CheckStep = {
      kind: 'do', id: 'lonely', prompt: 'go', goal: { anchor: 'a', label: 'A' }, decoys: [],
    }
    expect(refuseCheck(c)).toMatch(/lonely.*no decoys/)
  })

  it('refuses an ordering whose positions are not a permutation', () => {
    const c: CheckStep = {
      kind: 'order', id: 'dupe', prompt: 'p',
      items: [{ label: 'a', position: 1 }, { label: 'b', position: 1 }],
    }
    expect(refuseCheck(c)).toMatch(/dupe.*1\.\.2/)
  })

  it('names the item every time it refuses', () => {
    const bad: CheckStep[] = [
      { kind: 'sort', id: 'stray', prompt: 'p', buckets: ['A'], items: [{ label: 'x', bucket: 'B' }] },
      { kind: 'place', id: 'nowhere', prompt: 'p', regions: [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }], correct: 'c' },
      { kind: 'showdown', id: 'empty', prompt: 'p', opponent: 'x', rounds: [] },
      { kind: 'quiz', item: { id: 'oob', prompt: 'p', choices: ['a', 'b'], correctIndex: 7 } },
    ]
    for (const c of bad) expect(refuseCheck(c), c.kind).toContain(checkIdOf(c))
  })
})

describe('one timing convention across both arms (L3)', () => {
  it('is named on the wire so a reader never has to guess which meaning a row is in', () => {
    expect(LATENCY_CONVENTION).toBe('first-answer')
  })

  it('stamps the FIRST answer and never moves it', () => {
    const stamps: Record<string, number> = {}
    markFirst(stamps, 'q1', 1000)
    markFirst(stamps, 'q1', 9000)
    expect(stamps.q1).toBe(1000)
  })

  it('measures from answerable to first answer, not to submit', () => {
    const t0 = 500
    const stamps: Record<string, number> = {}
    markFirst(stamps, 'q1', 1500)   // Answered one second in.
    markFirst(stamps, 'q2', 4500)   // Answered four seconds in.
    // Submit happens much later and must not show up in either number.
    expect(latencyOf(t0, stamps, 'q1', 60_000)).toBe(1000)
    expect(latencyOf(t0, stamps, 'q2', 60_000)).toBe(4000)
  })

  it('an untouched item reports the time up to now rather than a zero that reads as instant', () => {
    expect(latencyOf(1000, {}, 'never', 3000)).toBe(2000)
  })

  it('latency comes from this one module', () => {
    const src = fs.readFileSync(path.resolve('src/game/beats/ActivityRunner.tsx'), 'utf8')
    expect(src.match(/latencyOf\(/g) ?? []).toHaveLength(1)
    expect(src).toContain("from './timing'")
  })
})
