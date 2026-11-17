// Renders the real beat runner with every kind of question and reads what comes out.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CheckStep } from '../../vine/contract'
import { CoreBeatRunner } from './ActivityRunner'
import { checksOf, playableSteps, type BeatWorld } from './frames'
import { ok, type Intent } from '../../vine/intents'
import { emptyScore } from './score'
import { PALETTE, plainOf, refuseCheck } from './palette'
import type { BeatStep, CoreBeat } from './frames'
import { CORE_Y1 } from './y1'
import { CORE_Y2 } from './y2'
import { CORE_Y3 } from './y3'
import { coreY4 } from './y4'
import { classBeat } from './classes'
import { CLASSES } from '../planner/catalog'
import { beginAdventure, loadSave } from '../save'

const CHECKS: CheckStep[] = [
  {
    kind: 'choice', id: 'a-choice', prompt: 'How do you join a club here?',
    options: [
      { text: 'Walk into the meeting', correct: true, reply: 'That is it. Nobody signs you in.' },
      { text: 'Fill out a district form', reply: 'No form. You walk in.' },
    ],
  },
  { kind: 'quiz', item: { id: 'a-quiz', prompt: 'When does Monday start?', choices: ['7:30', '8:30'], correctIndex: 1, explanation: 'Monday is the late start.' } },
  {
    kind: 'sort', id: 'a-sort', prompt: 'Put each value under its letter.',
    buckets: ['P', 'O'], items: [{ label: 'Perseverance', bucket: 'P' }, { label: 'Ownership', bucket: 'O' }],
  },
  { kind: 'number', id: 'a-number', prompt: 'How many credits to graduate?', answer: 24, unit: 'credits', reply: 'Twenty-four.' },
  {
    kind: 'order', id: 'a-order', prompt: 'Put the four years in order.',
    items: [
      { label: 'Freshman', position: 1 }, { label: 'Sophomore', position: 2 },
      { label: 'Junior', position: 3 }, { label: 'Senior', position: 4 },
    ],
  },
  {
    kind: 'place', id: 'a-place', prompt: 'Where do you change a schedule?',
    regions: [{ name: 'student_services', label: 'Student Services' }, { name: 'commons', label: 'The Commons' }],
    correct: 'student_services',
  },
  {
    kind: 'do', id: 'a-do', prompt: 'Go and read the activities board.',
    goal: { anchor: 'activities_board', label: 'The activities board' },
    decoys: [{ anchor: 'trophy_case', label: 'The trophy case' }],
  },
  {
    kind: 'showdown', id: 'a-showdown', prompt: 'Last drive.', opponent: 'Sumner',
    rounds: [{
      id: 'r1', prompt: 'What closes a cord?',
      options: [{ text: 'Meeting the criterion', correct: true, reply: 'The criterion, not the effort.' }, { text: 'Showing up', reply: 'Attendance is not a criterion.' }],
    }],
  },
  {
    kind: 'program', id: 'a-program', prompt: 'Put the build back in order, then press RUN.',
    grid: 'P> . . # . F',
    moves: [
      { name: 'fwd2', label: 'forward 2' },
      { name: 'left', label: 'turn left' },
      { name: 'fwd3', label: 'forward 3' },
      { name: 'right', label: 'turn right' },
    ],
    slots: [
      { label: 'Step 1', move: 'fwd2' },
      { label: 'Step 2', move: 'left' },
      { label: 'Step 3', move: 'fwd3' },
    ],
    board: { cols: 6, rows: 4, walls: [[3, 2], [3, 3]], flag: [5, 0], start: { col: 0, row: 3, facing: 'east' } },
    reply: 'The wall is why the turn comes early.',
  },
]

const beatWith = (checks: CheckStep[]): CoreBeat => ({
  id: 'test:arms', year: 1, title: 'The nine frames', place: 'the Advisory Hearth',
  kind: 'core', credit: 0.5, takeaways: [],
  steps: [
    { kind: 'say', line: { speaker: 'Wiseman', text: 'One of each, then.' } },
    ...checks.map((check): BeatStep => ({ kind: 'check', check })),
  ],
})

/* The string renderer, for testing what a beat draws instead of what it does. */
const draw = (beat: CoreBeat) =>
  renderToStaticMarkup(createElement(CoreBeatRunner, { beat, onClose: () => {} }))

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => {
  localStorage.clear()
  beginAdventure()
})

describe('a beat draws every kind of item', () => {
  it('opens on the dialogue and then plays each item in the panel', () => {
    expect(draw(beatWith(CHECKS))).toContain('One of each, then.')
  })

  it('every kind renders its own first screen without throwing', () => {
    /* One beat per kind, each starting on its check. That's the first screen a member sees, and the
     * one a missing branch would leave blank. */
    for (const c of CHECKS) {
      const beat: CoreBeat = { ...beatWith([c]), steps: [{ kind: 'check', check: c }] }
      const html = draw(beat)
      const r = plainOf(c)
      expect(html, `${c.kind}`).toContain(r.prompt)
      if (c.kind === 'showdown') {
        // The drive bar and the first round, not all the rounds at once.
        expect(html).toContain('yards to go')
        expect(html).toContain(c.rounds[0].prompt)
      } else if (c.kind === 'do') {
        // No world was given, so it falls back to naming its places.
        expect(html).toContain('The activities board')
        expect(html).toContain('The trophy case')
      } else {
        for (const f of r.fields) for (const o of f.options) expect(html, `${c.kind} ${o.text}`).toContain(o.text)
      }
    }
  })
})

/* The behavior tested below lives in an effect, and renderToStaticMarkup never runs effects, so
 * these tests mount for real into happy-dom. The tests above stay on the string renderer because
 * they test what's drawn, and these test what's done. */
async function mount(beat: CoreBeat, world?: BeatWorld) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(CoreBeatRunner, { beat, onClose: () => {}, world }))
  })
  return {
    html: () => host.innerHTML,
    text: () => host.textContent ?? '',
    pickRadio: async (name: string, nth: number) => {
      const r = host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)[nth]
      if (!r) throw new Error(`no radio ${name}[${nth}]`)
      await act(async () => { r.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    },
    click: async (text: string) => {
      const b = [...host.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(text))
      if (!b) throw new Error(`no button reading "${text}" in: ${host.innerHTML}`)
      await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    },
    unmount: async () => { await act(async () => { root.unmount() }) },
  }
}

describe('W8: a do staged in the world, and what happens when it cannot be', () => {
  const doCheck = CHECKS.find((c) => c.kind === 'do')!
  const beat: CoreBeat = { ...beatWith([doCheck]), steps: [{ kind: 'check', check: doCheck }] }

  /* The arrow must never point at the answer. That would walk the student straight to it and score
   * full marks every time, while the plain form asks the same question with decoys. So this checks
   * that the world is told the question and never the answer. */
  it('states the question to the world and never points at the answer', async () => {
    const issued: Intent[] = []
    const world: BeatWorld = {
      issue: async (i) => { issued.push(i); return ok() },
      onReached: () => () => {},
    }
    const m = await mount(beat, world)
    expect(issued).toEqual([{ kind: 'objective', text: doCheck.prompt }])
    /* The anchor name is the answer, so it must never be sent to the world at all. */
    expect(JSON.stringify(issued)).not.toContain('activities_board')
    await m.unmount()
  })

  it('takes the objective back down when the item leaves', async () => {
    const issued: Intent[] = []
    const world: BeatWorld = {
      issue: async (i) => { issued.push(i); return ok() },
      onReached: () => () => {},
    }
    const m = await mount(beat, world)
    await m.unmount()
    expect(issued.at(-1)).toEqual({ kind: 'objective', text: null })
  })

  it('waits for the walk without naming the place it is waiting for', async () => {
    const world: BeatWorld = { issue: async () => ok(), onReached: () => () => {} }
    const m = await mount(beat, world)
    expect(m.html()).toContain('Walk to the place you think it is')
    /* Show neither the answer nor the decoys. Naming the goal gives it away, and listing them all
     * turns the walk into a form. */
    expect(m.html()).not.toContain('The activities board')
    expect(m.html()).not.toContain('The trophy case')
    await m.unmount()
  })

  it('scores the anchor the player actually reached, goal or decoy', async () => {
    for (const [anchor, expected] of [['activities_board', 'That is the place'], ['trophy_case', 'Not this one']] as const) {
      let fire: ((a: string) => void) | null = null
      const world: BeatWorld = { issue: async () => ok(), onReached: (cb) => { fire = cb; return () => {} } }
      const m = await mount(beat, world)
      await act(async () => { fire!(anchor) })
      expect(m.html(), anchor).toContain(expected)
      await m.unmount()
    }
  })

  it('ignores an arrival at somewhere the item never named', async () => {
    let fire: ((a: string) => void) | null = null
    const world: BeatWorld = { issue: async () => ok(), onReached: (cb) => { fire = cb; return () => {} } }
    const m = await mount(beat, world)
    await act(async () => { fire!('panther_maw') })
    // Still waiting. Walking past something on the way isn't an answer.
    expect(m.html()).toContain('Walk to the place you think it is')
    await m.unmount()
  })

  it('unsubscribes when the item leaves, so a closed beat is not still listening', async () => {
    let subs = 0
    const world: BeatWorld = { issue: async () => ok(), onReached: () => { subs++; return () => { subs-- } } }
    const m = await mount(beat, world)
    expect(subs).toBe(1)
    await m.unmount()
    expect(subs).toBe(0)
  })

  it('offers a form to a student who cannot find the place', async () => {
    /* Authors will make typos in anchor names, and then the arrival can never happen. Waiting
     * forever would lock the beat with no way out, and it would test finding your way instead of
     * what was learned. So after a while the form shows up beside the walk, never in place of it. */
    vi.useFakeTimers()
    try {
      const world: BeatWorld = { issue: async () => ok(), onReached: () => () => {} }
      const m = await mount(beat, world)
      expect(m.html(), 'nothing is given away up front').not.toContain('The activities board')
      await act(async () => { vi.advanceTimersByTime(46_000) })
      expect(m.html()).toContain('The activities board')
      expect(m.html()).toContain('The trophy case')
      await m.click('The activities board')
      expect(m.html()).toContain('Keep going')
      await m.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a student is told what their answer was, before the grade', () => {
  const beat = beatWith([CHECKS[0], CHECKS[1]])

  it('speaks the reply for what the student picked, right and wrong', async () => {
    const m = await mount(beat)
    await m.click('One of each, then.')
    await m.click('Fill out a district form')
    expect(m.text(), 'the wrong answer is corrected').toContain('No form. You walk in.')
    await m.click('Keep going')
    await m.click('8:30')
    expect(m.text(), 'the right answer is confirmed').toContain('Monday is the late start.')
    await m.unmount()
  })
})

describe('the refusal reaches the author and never the student', () => {
  const broken: CheckStep = {
    kind: 'choice', id: 'two-right', prompt: 'Which of these is true?',
    options: [{ text: 'a', correct: true, reply: '' }, { text: 'b', correct: true, reply: '' }],
  }

  it('drops a refused item from the spine, the steps and the denominator together', () => {
    const beat = beatWith([CHECKS[0], broken])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(checksOf(beat).map((c) => c.kind === 'quiz' ? c.item.id : c.id)).toEqual(['a-choice'])
    expect(playableSteps(beat).filter((s) => s.kind === 'check')).toHaveLength(1)
    expect(emptyScore(beat).total).toBe(1)
    expect(warn.mock.calls.flat().join(' ')).toContain('two-right')
    warn.mockRestore()
  })

  it('the broken item is on no screen', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const beat = beatWith([CHECKS[0], broken])
    expect(draw(beat)).not.toContain('Which of these is true?')
    expect(draw(beat)).not.toContain('Which of these is true?')
    vi.restoreAllMocks()
  })
})

describe('the validator is calibrated against the real authored content', () => {
  it('accepts every check in every core beat and every generated class beat', () => {
    const beats: CoreBeat[] = [
      CORE_Y1, CORE_Y2, CORE_Y3, coreY4(loadSave()!),
      ...CLASSES.flatMap((c) => [1, 2, 3, 4].map((y) => classBeat(c, y))),
    ]
    const refused: string[] = []
    for (const b of beats) {
      for (const s of b.steps) {
        if (s.kind !== 'check') continue
        const why = refuseCheck(s.check)
        if (why) refused.push(`${b.id}: ${why}`)
      }
    }
    /* This checks that the validator accepts the game's real content. A validator tuned only to its
     * own test samples could throw out shipped content the first time a beat ran. */
    expect(refused).toEqual([])
    expect(beats.length).toBeGreaterThan(40)
  })

  it('covers every kind in the palette with a rendered case', () => {
    expect(CHECKS.map((c) => c.kind).sort()).toEqual(Object.keys(PALETTE).sort())
  })
})
