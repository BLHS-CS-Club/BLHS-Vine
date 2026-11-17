import { describe, expect, it } from 'vitest'
import { solves, walkOf, type ProgramBoard } from './program'
import { fieldRight, plainOf, scoreOf } from './palette'
import type { CheckStep } from '../../vine/contract'

/* The ATC maze, copied from the island's own file. */
const BOARD: ProgramBoard = {
  cols: 6, rows: 4, walls: [[3, 2], [3, 3]], flag: [5, 0],
  start: { col: 0, row: 3, facing: 'east' },
}
const CHECK = {
  kind: 'program', id: 'atc-maze', prompt: 'Put the program back in order, then press RUN.',
  moves: [
    { name: 'fwd2', label: 'forward 2' }, { name: 'fwd3', label: 'forward 3' },
    { name: 'left', label: 'turn left' }, { name: 'right', label: 'turn right' },
  ],
  slots: [
    { label: 'Step 1', move: 'fwd2' }, { label: 'Step 2', move: 'left' },
    { label: 'Step 3', move: 'fwd3' }, { label: 'Step 4', move: 'right' },
    { label: 'Step 5', move: 'fwd3' },
  ],
  board: BOARD,
} as unknown as CheckStep

const answer = (...moves: string[]) =>
  Object.fromEntries(moves.map((m, i) => [`atc-maze:${i + 1}`, m]))

describe('a program is marked on what it does', () => {
  /* Three different five-step programs reach this flag, and all three have to get full marks. */
  const SOLUTIONS = [
    ['fwd2', 'left', 'fwd3', 'right', 'fwd3'],
    ['left', 'fwd3', 'right', 'fwd2', 'fwd3'],
    ['left', 'fwd3', 'right', 'fwd3', 'fwd2'],
  ]

  it('there really is more than one right answer, which is why this matters', () => {
    const found = SOLUTIONS.filter((p) => walkOf(BOARD, p).home)
    expect(found.length).toBe(3)
  })

  it('every program that reaches the flag earns full marks', () => {
    for (const p of SOLUTIONS) {
      expect(scoreOf(CHECK, answer(...p)), p.join(', ')).toBe(5)
    }
  })

  it('and every step of it is marked right, not just the ones that coincide', () => {
    const theirs = answer('left', 'fwd3', 'right', 'fwd3', 'fwd2')
    for (const f of plainOf(CHECK).fields) {
      expect(fieldRight(CHECK, f, theirs), f.label).toBe(true)
    }
  })

  it('a program that does not solve it still earns credit per step', () => {
    /* The author's answer with the last two steps swapped. Three steps still match. */
    expect(scoreOf(CHECK, answer('fwd2', 'left', 'fwd3', 'fwd3', 'right'))).toBe(3)
  })

  it('a program with a hole in it is not a solution', () => {
    expect(solves(BOARD, ['left', 'fwd3', 'right', '', 'fwd2'])).toBe(false)
  })

  it('and one that walks into the wall is marked on the steps it got right', () => {
    /* Going straight ahead into the wall at column 3 still keeps the two steps that match the
     * author's program. Partial credit is per step and doesn't care why the rest was wrong. */
    expect(scoreOf(CHECK, answer('fwd3', 'fwd3', 'fwd3', 'fwd3', 'fwd3'))).toBe(2)
  })
})
