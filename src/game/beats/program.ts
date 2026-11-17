/* A program is graded by running it and checking where it ends up, so the steps don't have to match
 * the author's. The ATC maze, for example, has three different five-step programs that reach the
 * flag. */

export type Cell = { col: number; row: number; facing: 'north' | 'south' | 'east' | 'west' }

export type ProgramBoard = {
  cols: number
  rows: number
  walls: [number, number][]
  flag: [number, number]
  start: Cell
}

const AHEAD: Record<Cell['facing'], [number, number]> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
}
const RIGHT_OF: Record<Cell['facing'], Cell['facing']> = {
  north: 'east', east: 'south', south: 'west', west: 'north',
}
const LEFT_OF: Record<Cell['facing'], Cell['facing']> = {
  north: 'west', west: 'south', south: 'east', east: 'north',
}

/* A step's meaning comes from its name, so a member can write forward 2 or turn left without
 * registering anything. A name this can't read doesn't visibly move the body. */
export function stepsOf(name: string): { turn?: 'left' | 'right'; forward?: number } {
  const n = name.toLowerCase()
  if (n.includes('left')) return { turn: 'left' }
  if (n.includes('right')) return { turn: 'right' }
  const m = n.match(/(\d+)/)
  return { forward: m ? Number(m[1]) : 1 }
}

/* Every cell the body passes through, in order, and whether a wall or the edge of the board stopped
 * it. */
export function walkOf(board: ProgramBoard, written: string[]) {
  const blocked = new Set(board.walls.map(([c, r]) => c + ',' + r))
  const legal = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < board.cols && r < board.rows && !blocked.has(c + ',' + r)
  let at: Cell = { col: board.start.col, row: board.start.row, facing: board.start.facing }
  const path: Cell[] = [{ ...at }]
  let stuck = false
  for (const name of written) {
    if (stuck) break
    const step = stepsOf(name)
    if (step.turn) {
      at = { ...at, facing: step.turn === 'left' ? LEFT_OF[at.facing] : RIGHT_OF[at.facing] }
      path.push({ ...at })
      continue
    }
    for (let i = 0; i < (step.forward ?? 0); i++) {
      const [dx, dy] = AHEAD[at.facing]
      const next: Cell = { col: at.col + dx, row: at.row + dy, facing: at.facing }
      if (!legal(next.col, next.row)) { stuck = true; break }
      at = next
      path.push({ ...at })
    }
  }
  return { path, stuck, home: at.col === board.flag[0] && at.row === board.flag[1] }
}

/** True if this program solves the board: every step is filled in and the body ends on the flag. */
export function solves(board: ProgramBoard | undefined, written: string[]): boolean {
  if (!board) return false
  /* An empty step means the program isn't finished, so it doesn't count as solved even if the rest
   * would work. */
  if (!written.length || written.some((w) => !w)) return false
  return walkOf(board, written).home
}
