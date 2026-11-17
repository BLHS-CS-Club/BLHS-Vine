import { useEffect, useMemo, useRef, useState } from 'react'
import { cinemaOn } from '../stage/cinema'
import type { CheckStep } from '../../vine/contract'
import { checksOf, playableSteps, pointsOf, type BeatStep, type BeatWorld, type CoreBeat } from './frames'
import {
  checkIdOf, fieldRight, plainOf, promptOf, scoreOf,
  type PlainField, type PlainRender, type Response,
} from './palette'
import { progressOf, responseOf, showdownReduce, startShowdown, yardsRemaining, type ShowdownState } from './showdown'
import { LATENCY_CONVENTION, latencyOf, markFirst } from './timing'
import { emptyScore, gradeOf, retakeAvailable, type BeatScore } from './score'
import { collectFact, loadSave, recordGrade } from '../save'
import { cordsOf, letterOf, newlyCloseCords, PASSING_GRADE } from '../progress'
import { factById } from '../facts'
import { track } from '../telemetry'
import { usePanel } from '../ui/a11y'
import { Chip, Field, Gauge, Glyph, Plank, PortraitFrame, useFace } from '../ui/controls'
import { right as sayRight, wrong as sayWrong } from '../ui/feedback'
import { grant } from '../grant'
import './beats.css'
import { walkOf } from './program'

// Plays a scored beat from its data, then writes the grade to the ledger.

type Answer = { earned: number; total: number; tries: number; latencyMs: number }
type Answers = Record<string, Answer>

/** Which try at this beat the student is on. */
type Attempt = { n: number }

/* Answer times come from timing.ts, where the timing rule is written down. */

export function CoreBeatRunner(
  { beat, onClose, world, review }: {
    beat: CoreBeat
    onClose: () => void
    /* Open on the marks from the sitting already on the ledger, without playing the beat. */
    review?: boolean
    /* Optional on purpose. A beat with a do question still works with no map, because the question
     * falls back to naming its places. */
    world?: BeatWorld
  },
) {
  const save = loadSave()

  /* review opens straight onto the marks. The sheet's see your answers button opens this runner,
   * and starting in play would re-run and re-grade a beat that was already passed. */
  const [phase, setPhase] = useState<'play' | 'result' | 'review' | 'retake' | 'answers'>(
    review ? 'answers' : 'play',
  )
  const [finalScore, setFinalScore] = useState<BeatScore | null>(null)
  const retaking = useRef(false)
  const attempt = useRef<Attempt>({ n: 1 })

  const finish = (answers: Answers) => {
    const score: BeatScore = {
      ...emptyScore(beat),
      earned: Object.values(answers).reduce((n, a) => n + a.earned, 0),
    }
    const grade = gradeOf(score)
    const before = loadSave()
    /* How each question went, so see your answers has something to show. */
    const marks: Record<string, [number, number]> = {}
    for (const [k, a] of Object.entries(answers)) marks[k] = [a.earned, a.total]
    recordGrade({
      id: beat.id, title: beat.title, kind: beat.kind, credit: beat.credit,
      grade, year: beat.year, season: before?.season ?? 'Fall',
      marks,
      ...(beat.tags?.length ? { tags: beat.tags } : {}),
      ...(retaking.current ? { retaken: true } : {}),
    })
    for (const f of beat.takeaways) collectFact(f)
    const after = loadSave()
    /* One reward pop that names the credit, not the facts. */
    /* It only shows on a pass, so it agrees with the result card's stamp. */
    if (beat.credit > 0 && grade >= PASSING_GRADE) {
      /* It goes through grant, so a credit that pushes a cord over its line says so too. */
      /* It names what was finished, with the credit as the detail under it. */
      /* A core beat's place is the lesson's own name and a class beat's place is a room, so the pop
       * uses the place for a core beat and the title for a class beat. */
      grant(before, after, {
        what: `${beat.kind === 'core' ? beat.place : beat.title} is done.`,
        detail: `${beat.credit} credit, on your transcript.`,
      })
    }
    track('core_beat_complete', {
      id: beat.id, grade, retaken: retaking.current, tries: attempt.current.n,
      /* The ledger keeps the first attempt's grade, so the event sends that same number. */
      firstGrade: after?.ledger.find((e) => e.id === beat.id)?.firstGrade ?? grade,
    })
    track('gpa_updated', { grade, beat: beat.id })
    if (before && after) {
      for (const c of newlyCloseCords(before, after)) track('cord_progress', { cord: c.id, progress: c.progress })
    }
    setFinalScore(score)
    /* Always show the result card. The pop is the celebration and the card is the record.
     * PASSING_GRADE is a D, so a student who barely passes still has to hear about the retake
     * they're allowed, and the pop doesn't say that. */
    setPhase('result')
  }

  const startRetake = () => {
    retaking.current = true
    attempt.current = { n: attempt.current.n + 1 }
    track('retake_used', { beat: beat.id, tries: attempt.current.n })
    setPhase('retake')
  }

  /* A real panel. Focus stays inside it, and Escape only works once the score is showing. */
  const scoring = phase === 'play' || phase === 'retake'
  const panel = usePanel({
    label: `${beat.title} · ${scoring ? 'questions' : 'your grade'}`,
    onClose,
    closeOnEscape: !scoring,
  })

  if (!save) return null

  return (
    <div className="bt-veil">
      {/* bt-plain-scoring lets the plain card scroll with a fixed footer while questions are
        * showing. */}
      <div {...panel} className={beat.chrome === 'screen'
        ? 'bt-crt bt-stage bt-stage-screen'
        : 'bt-stage kit-surface-panel'}>
        {(phase === 'play' || phase === 'retake') && (
          <GamePlay beat={beat} checksOnly={phase === 'retake'} attempt={attempt.current} world={world} onDone={finish} />)}
        {phase === 'result' && finalScore && (
          <ResultCard
            beat={beat} score={finalScore}
            canRetake={retakeAvailable(loadSave()!, beat.id)}
            onReview={() => setPhase('review')}
            onClose={onClose}
          />
        )}
        {phase === 'answers' && (
          <AnswersCard beat={beat} onClose={onClose} />
        )}
        {phase === 'review' && (
          <ReviewCard beat={beat} onRetake={startRetake} onBack={() => setPhase('result')} />
        )}
        {/* A way out that scores nothing and leaves the beat still owed. */}
        {/* It never shows during a cutscene, where the only way on is finishing the questions. */}
        {scoring && !cinemaOn() && (
          <div className="bt-leave">
            <Plank size="sm" onClick={onClose}>Leave this for now</Plank>
            <span className="bt-leave-why">Nothing is marked until you check your answer. You can come back to this.</span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The reply the author wrote for this pick. If there isn't one, it uses the field-wide reply, the
 * one with value ''. Typed numbers and the rows of a sort or ordering use that one, since they
 * don't have a reply for each answer.
 */
const replyFor = (r: PlainRender, field: string, value: string): string =>
  r.replies.find((x) => x.field === field && x.value === value)?.text
  ?? r.replies.find((x) => x.field === field && x.value === '')?.text
  ?? ''

const labelOf = (f: PlainField, value: string) => f.options.find((o) => o.value === value)?.text ?? value

/* Says whether the answer was right, in the author's own words, out loud as well as on screen. */
function speak(gotAll: boolean, authored: string, truth: string): void {
  if (gotAll) sayRight('Right', authored || undefined)
  else sayWrong('Not quite', authored || truth)
}

// ---- the beat, one step at a time, at the player's pace ---------------------------

function GamePlay({ beat, checksOnly, attempt, world, onDone }: {
  beat: CoreBeat
  checksOnly: boolean
  attempt: Attempt
  world?: BeatWorld
  onDone: (answers: Answers) => void
}) {
  const steps: BeatStep[] = checksOnly
    ? checksOf(beat).map((check) => ({ kind: 'check' as const, check }))
    : playableSteps(beat)
  const [idx, setIdx] = useState(0)
  const accum = useRef<Answers>({})

  const advance = () => {
    if (idx + 1 >= steps.length) onDone(accum.current)
    else setIdx(idx + 1)
  }

  const step = steps[idx]
  /* How many questions there are, counted from the beat so the progress rail and the score agree. */
  const total = steps.filter((s) => s.kind === 'check').length
  const answered = steps.slice(0, idx).filter((s) => s.kind === 'check').length
  const last = idx + 1 >= steps.length

  return (
    <>
      <div className="bt-head">
        <span className="bt-place">{beat.place} · <b>{beat.title}</b></span>
        {total > 0 && (
          <span className="bt-rail">
            <span className="bt-railword">{answered} of {total} answered</span>
            <span className="bt-railpips" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => (
                <Chip key={i} state={i < answered ? 'plate_spent' : i === answered && step.kind === 'check' ? 'plate_lit' : 'plate'} />
              ))}
            </span>
          </span>
        )}
      </div>
      {/* The stage is already the background, so a spoken line doesn't get its own box. */}
      {step.kind === 'say' ? (
        <button className="bt-say" onClick={advance}>
          <span className="bt-speakerrow">
            {/* The speaker's portrait, if the author set one on the line. */}
            {/* No caption, because the name plate beside the frame already says who it is. */}
            {step.line.portrait && <PortraitFrame id={step.line.portrait} />}
            <span className="bt-speaker">{step.line.speaker}</span>
          </span>
          <span className="bt-text">{step.line.text}</span>
          <AdvanceCue />
        </button>
      ) : (
        <CheckPlay
          key={`${checkIdOf(step.check)}:${attempt.n}`}
          check={step.check}
          world={world}
          last={last}
          onDone={(response, ms) => {
            const id = checkIdOf(step.check)
            const worth = pointsOf(step.check)
            const earned = scoreOf(step.check, response)
            const tries = attempt.n
            accum.current[id] = { earned, total: worth, tries, latencyMs: ms }
            track('check_answered', {
              item: id, kind: step.check.kind, correct: earned === worth,
              earned, total: worth, tries, latencyMs: ms, latency: LATENCY_CONVENTION, via: 'woven',
            })
            advance()
          }}
        />
      )}
    </>
  )
}

/* The drawn advance cue. When the kit is off, a chevron in the theme's token color stands in. */
/* It uses one paw frame and bounces it, because the four cue frames only differ in color. */
const CUE_FACE = 'frame_2'

function AdvanceCue() {
  const drawn = useFace('cue', CUE_FACE)
  if (!drawn) return <span className="bt-cue-mark" aria-hidden="true" />
  return (
    <span className="bt-cue" aria-hidden="true">
      <Glyph piece="cue" face={CUE_FACE} size={26} className="bt-cueframe" />
    </span>
  )
}

/* The check my answer button. When it's disabled, it says in words what it's waiting for. */
function Commit({ ready, needs, onCommit, label = 'Check my answer' }: {
  ready: boolean
  /** What's still missing, in words. It shows to the student and in the tooltip. */
  needs: string
  onCommit: () => void
  label?: string
}) {
  return (
    <div className="bt-foot">
      <Plank size="md" disabled={!ready} title={ready ? undefined : needs} onClick={onCommit}>{label}</Plank>
      {!ready && <span className="bt-needs">{needs}</span>}
    </div>
  )
}

/* A sort or an ordering done by hand: press a piece, press a place, and the piece lands there. */
function MovePlay({ check, render, picks, revealed, single, onSet, onTouch }: {
  check: CheckStep
  render: ReturnType<typeof plainOf>
  picks: Response
  revealed: boolean
  /** True if a place holds one piece (an ordering) instead of many (a sort). */
  single: boolean
  onSet: (fieldId: string, value: string) => void
  onTouch: () => void
}) {
  const [held, setHeld] = useState<string | null>(null)
  /* Inside a handler, held is the value from the render that made the handler, and two quick
   * presses can happen before a re-render. So the handlers read heldNow instead. take() always sets
   * the ref and the state together so they never disagree. */
  const heldNow = useRef<string | null>(null)
  const take = (v: string | null) => { heldNow.current = v; setHeld(v) }

  /* The places come from the first field, because every field offers the same ones: the buckets of
   * a sort, or the spots in an order. */
  const places = render.fields[0]?.options ?? []
  const pool = render.fields.filter((f) => !picks[f.id])
  const inPlace = (v: string) => render.fields.filter((f) => picks[f.id] === v)

  const put = (place: string) => {
    const held = heldNow.current
    if (!held || revealed) return
    /* An ordering's place holds one piece, so dropping onto a full place sends the piece already
     * there back to the pool. Refusing the drop would block the only move the student can see. */
    if (single) for (const f of inPlace(place)) onSet(f.id, '')
    onSet(held, place)
    take(null)
  }

  const lift = (fieldId: string) => {
    if (revealed) return
    onTouch()
    /* Pressing a piece that's already placed takes it back out. That's the undo, and the student
     * finds it without being told. */
    if (picks[fieldId]) { onSet(fieldId, ''); take(fieldId); return }
    take(heldNow.current === fieldId ? null : fieldId)
  }

  const labelOfField = (id: string) => render.fields.find((f) => f.id === id)?.label ?? id

  return (
    <div className="bt-move" data-holding={held ? '1' : undefined}>
      {/* A piece lands inside its box, and a full box changes from dashed to solid. */}
      <div className="bt-drops" data-count={places.length}>
        {places.map((pl) => {
          const sitting = inPlace(pl.value)
          const lit = !!held && !revealed
          return (
            <div className={`bt-drop${sitting.length ? ' bt-drop-full' : ''}`} key={pl.value}>
              <span className="bt-drop-name">{pl.text}</span>
              <div className={`bt-drop-well${lit ? ' bt-drop-lit' : ''}`} aria-label={sitting.length ? undefined : `${pl.text}, empty`}>
                {sitting.map((f) => {
                  const got = revealed && fieldRight(check, f, picks)
                  return (
                    <button
                      type="button"
                      key={f.id}
                      className={`bt-piece bt-piece-set${revealed ? (got ? ' bt-piece-true' : ' bt-piece-miss') : ''}`}
                      disabled={revealed || lit}
                      aria-label={`${f.label}, in ${pl.text}. Press to take it back.`}
                      onClick={() => lift(f.id)}
                    >
                      {revealed && (
                        <Glyph piece="icon_set" face={got ? 'tick' : 'cross'} size={13} className="bt-piece-mark" />
                      )}
                      {f.label}
                    </button>
                  )
                })}
                {lit && (
                  <button
                    type="button"
                    className="bt-drop-target"
                    aria-label={`Put ${labelOfField(held!)} in ${pl.text}`}
                    onClick={() => put(pl.value)}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* The pool empties as the places fill, so this frame doesn't need a progress bar. */}
      <div className="bt-pool" aria-label="Still to place">
        {pool.map((f) => (
          <button
            type="button"
            key={f.id}
            className={`bt-piece${held === f.id ? ' bt-piece-held' : ''}`}
            aria-pressed={held === f.id}
            disabled={revealed}
            onClick={() => lift(f.id)}
          >
            {f.label}
          </button>
        ))}
        {pool.length === 0 && <span className="bt-pool-done">Everything is placed.</span>}
      </div>

      {/* Nothing gets taken away. A piece in the wrong place stays there, and a line is added
        * saying where it belonged. */}
      {revealed && (
        <ul className="bt-move-truth">
          {render.fields.filter((f) => !fieldRight(check, f, picks)).map((f) => (
            <li key={f.id}>
              <Glyph piece="icon_set" face="tick" size={13} />
              {f.label} goes in {labelOf(f, f.correct)}.
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* The instruction cards never run out, because any slot can hold any instruction. That keeps the
 * possible answers the same as the plain form's. Scoring only reads the slots through plainOf,
 * scoreOf, pointsOf and fieldRight, so the walk animation can never change the grade. */


/* The body, the board and the walk live in program.ts, because the marking needs them too. A
 * program is scored on whether it reaches the flag, not on whether it matches the author's steps. */
function ProgramPlay({ check, render, last, onDone, onTouch }: {
  check: Extract<CheckStep, { kind: 'program' }>
  render: ReturnType<typeof plainOf>
  last: boolean
  onDone: (r: Response) => void
  onTouch: () => void
}) {
  const [picks, setPicks] = useState<Response>({})
  const [revealed, setRevealed] = useState(false)
  /* How far along the walk the body is, or -1 when nothing is running. */
  const [at, setAt] = useState(-1)

  const moves = render.fields[0]?.options ?? []
  const filled = render.fields.every((f) => picks[f.id])
  const missing = render.fields.filter((f) => !picks[f.id]).length
  const earned = scoreOf(check, picks)
  const outOf = pointsOf(check)

  const board = check.board
  const written = render.fields.map((f) => picks[f.id] ?? '')
  /* Keyed on the answer instead of the walk object. walkOf returns a new object every call, and the
   * dialogue typing re-renders this screen every few frames, which would keep resetting the 420ms
   * step timer. */
  const walk = useMemo(
    () => (board ? walkOf(board, written) : null),
    [board, written.join('|')],
  )

  /* Move one cell at a time so the student watches their own program run. The effect watches the
   * path length instead of the walk object, for the same reason as above. */
  const paces = walk ? walk.path.length : 0
  useEffect(() => {
    if (at < 0 || at >= paces - 1) return
    const t = setTimeout(() => setAt((n) => n + 1), 420)
    return () => clearTimeout(t)
  }, [at, paces])

  /* One rule: pressing an instruction puts it in the next empty step, and pressing a filled step
   * gives the instruction back. So clicking an empty step does nothing. Dragging still works,
   * because a drag says exactly which step was meant. */
  const fill = (slotId: string, move: string) => {
    onTouch()
    /* A drop can't land on a step that got filled while the card was being dragged. */
    setPicks((p) => (p[slotId] ? p : { ...p, [slotId]: move }))
  }

  /* Use the updater form so it reads the current picks. Two presses closer together than a
   * re-render would both find the same empty step, and the second would overwrite the first and
   * shift every later answer by one. */
  const take = (move: string) => {
    if (revealed) return
    onTouch()
    setPicks((p) => {
      const next = render.fields.find((f) => !p[f.id])
      return next ? { ...p, [next.id]: move } : p
    })
  }

  const clear = (slotId: string) => {
    if (revealed) return
    onTouch()
    setPicks((p) => { const n = { ...p }; delete n[slotId]; return n })
  }

  /* RUN is the final answer, not a practice run. Running again would let the student find the
   * answer by trial and error, which the plain form can't do, so it's one shot like every other
   * question. */
  const run = () => {
    setRevealed(true)
    setAt(0)
    speak(earned === outOf, check.reply ?? '', earned + ' of ' + outOf + ' steps are in the right place.')
  }

  const body = walk ? walk.path[Math.min(at < 0 ? 0 : at, walk.path.length - 1)] : null
  const ran = !!walk && at >= walk.path.length - 1

  return (
    <div
      className="bt-check bt-program"
      data-state={revealed ? (earned === outOf ? 'right' : 'wrong') : filled ? 'answering' : 'presented'}
    >
      <div className="bt-prompt">{render.prompt}</div>

      {board && (
        <div className="bt-board" role="img" aria-label={render.note || 'the board'}>
          {Array.from({ length: board.rows }, (_, row) => (
            <div className="bt-boardrow" key={row}>
              {Array.from({ length: board.cols }, (_, col) => {
                const wall = board.walls.some(([c, r]) => c === col && r === row)
                const flag = board.flag[0] === col && board.flag[1] === row
                const here = !!body && body.col === col && body.row === row
                return (
                  <span
                    key={col}
                    className={'bt-cell' + (wall ? ' bt-cell-wall' : '') + (flag ? ' bt-cell-flag' : '')}
                  >
                    {here && body && <span className={'bt-walker bt-walker-' + body.facing} aria-hidden="true" />}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* The slots, numbered and in order. Each one prints its own label on the first screen,
        * because the arm parity test reads it from here. */}
      <div className="bt-slots">
        {render.fields.map((f, i) => {
          const chosen = picks[f.id]
          const text = moves.find((m) => m.value === chosen)?.text
          const right = revealed && fieldRight(check, f, picks)
          /* The next empty step is lit, so it's always clear where the next instruction will land. */
          const nextEmpty = render.fields.find((q) => !picks[q.id])
          const wellClass = 'bt-slotwell'
            + (chosen ? ' bt-slotwell-full' : '')
            + (revealed ? (right ? ' bt-slotwell-true' : ' bt-slotwell-miss') : '')
            + (!revealed && !chosen && nextEmpty?.id === f.id ? ' bt-slotwell-lit' : '')
          return (
            <div className="bt-slot" key={f.id}>
              <span className="bt-slothead">
                <span className="bt-slotnum">{i + 1}</span>
                <span className="bt-slotname">{f.label}</span>
              </span>
              <button
                type="button"
                className={wellClass}
                disabled={revealed}
                aria-label={chosen
                  ? 'Step ' + (i + 1) + ', ' + text + '. Press to take it out.'
                  : 'Step ' + (i + 1) + ', empty. Press an instruction below to fill it.'}
                onClick={() => { if (chosen) clear(f.id) }}
                /* Dragging works too, because people naturally try to drag a row of cards onto a
                 * row of slots. */
                onDragOver={(e) => { if (!revealed && !chosen) e.preventDefault() }}
                onDrop={(e) => {
                  if (revealed || chosen) return
                  e.preventDefault()
                  const move = e.dataTransfer.getData('text/plain')
                  if (move) fill(f.id, move)
                }}
              >
                {text ?? <span className="bt-slotempty">empty</span>}
              </button>
              {/* Nothing gets taken away. A wrong step keeps what the student chose, and the right
                * instruction shows beside it. */}
              {revealed && !right && (
                <span className="bt-truth">
                  <Glyph piece="icon_set" face="tick" size={13} />
                  {labelOf(f, f.correct)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* The rule is shown on screen, because if the controls have to be guessed, the puzzle only
        * tests guessing. */}
      {!revealed && (
        <p className="bt-how">
          {filled
            ? 'Press a step to take that instruction back out, or press RUN.'
            : 'Press the instructions in the order you want them. Each one goes into the lit step.'}
        </p>
      )}

      <div className="bt-cards" aria-label="Instructions">
        {moves.map((m) => (
          <button
            type="button"
            key={m.value}
            className="bt-card"
            disabled={revealed || filled}
            draggable={!revealed}
            onDragStart={(e) => { onTouch(); e.dataTransfer.setData('text/plain', m.value) }}
            onClick={() => take(m.value)}
          >
            {m.text}
          </button>
        ))}
      </div>

      {!revealed
        ? (
          <Commit
            ready={filled}
            label="RUN"
            needs={missing === 1 ? 'One step is still empty.' : missing + ' steps are still empty.'}
            onCommit={run}
          />
        )
        : (
          <div className="bt-foot">
            {ran && (
              <span className="bt-ran">
                {walk && walk.home
                  ? 'It reached the flag.'
                  : walk && walk.stuck
                    ? 'It walked into the wall and stopped there.'
                    : 'It stopped short of the flag.'}
              </span>
            )}
            <Plank size="md" onClick={() => onDone(picks)}>Keep going</Plank>
            {last && <span className="bt-needs">That was the last one.</span>}
          </div>
        )}
    </div>
  )
}

/* One check, drawn from the same derived question the plain form uses. */
function CheckPlay({ check, world, last, onDone }: {
  check: CheckStep
  world?: BeatWorld
  last: boolean
  onDone: (r: Response, ms: number) => void
}) {
  const render = plainOf(check)
  const t0 = useRef(Date.now())
  const firstAt = useRef<Record<string, number>>({})
  const [picks, setPicks] = useState<Response>({})
  const [revealed, setRevealed] = useState(false)

  /* The timing rule in action: the first input on the question, on any field, counts as the moment
   * the student answered. */
  const touch = () => markFirst(firstAt.current, render.id)
  const latency = () => latencyOf(t0.current, firstAt.current, render.id)
  const set = (fieldId: string, value: string) => {
    touch()
    setPicks((p) => ({ ...p, [fieldId]: value }))
  }

  if (check.kind === 'showdown') {
    return <ShowdownPlay check={check} onDone={(r) => onDone(r, latency())} onTouch={touch} />
  }
  if (check.kind === 'do' && world) {
    return <DoPlay check={check} world={world} render={render} last={last} onDone={(r) => onDone(r, latency())} onTouch={touch} />
  }

  const single = render.fields.length === 1 ? render.fields[0] : null

  // One field, one pick: choice, quiz, place, and a do with nowhere to walk.
  if (single && single.input === 'radio') {
    return (
      <OneOf
        check={check} render={render} field={single} picked={picks[single.id]} last={last}
        onPick={(v) => set(single.id, v)}
        onDone={() => onDone(picks, latency())}
      />
    )
  }

  // One typed field: a number. Picking from a list would test recognizing the answer, which is a
  // different thing.
  if (single && single.input === 'text') {
    const typed = picks[single.id] ?? ''
    /* The palette decides if it's right, here and in the form. A number is scored against a set
     * tolerance, so no code outside palette.ts should compare the strings. */
    const got = fieldRight(check, single, picks)
    const truth = `It is ${single.correct}${single.label ? ` ${single.label}` : ''}.`
    const authored = replyFor(render, single.id, typed)
    return (
      <div className="bt-check" data-state={revealed ? (got ? 'right' : 'wrong') : typed.trim() === '' ? 'presented' : 'answering'}>
        <div className="bt-prompt">{render.prompt}</div>
        <div className="bt-numrow">
          <Field
            label={single.label ? `Your answer, in ${single.label}` : 'Your answer'}
            unit={single.label || undefined}
            inputMode="decimal"
            value={typed}
            disabled={revealed}
            onChange={(e) => set(single.id, e.target.value)}
          />
        </div>
        {revealed
          ? (
            <>
              <div className={`bt-reply${got ? '' : ' bt-reply-miss'}`}>
                {got ? 'That is the number.' : `Not quite. ${truth}`}
                {authored ? ` ${authored}` : ''}
              </div>
              <div className="bt-foot">
                <Plank size="md" onClick={() => onDone(picks, latency())}>Keep going</Plank>
                {last && <span className="bt-needs">That was the last one.</span>}
              </div>
            </>
          )
          : (
            <Commit
              ready={typed.trim() !== ''}
              needs="Type a number first, then press Check my answer."
              onCommit={() => { setRevealed(true); speak(got, authored, truth) }}
            />
          )}
      </div>
    )
  }

  /* The program is the only frame here that runs what the student wrote instead of only marking it. */
  if (check.kind === 'program') {
    return (
      <ProgramPlay
        check={check} render={render} last={last}
        onDone={(r) => onDone(r, latency())}
        onTouch={touch}
      />
    )
  }

  /* A sort and an ordering get the frame where pieces move, instead of the rows of chips below. */
  if (check.kind === 'sort' || check.kind === 'order') {
    const done = render.fields.every((f) => picks[f.id])
    const got = scoreOf(check, picks)
    const of = pointsOf(check)
    return (
      <div className="bt-check" data-state={revealed ? (got === of ? 'right' : 'wrong') : done ? 'answering' : 'presented'}>
        <div className="bt-prompt">{render.prompt}</div>
        <MovePlay
          check={check}
          render={render}
          picks={picks}
          revealed={revealed}
          single={check.kind === 'order'}
          onSet={(id, v) => { if (v === '') { touch(); setPicks((p) => { const n = { ...p }; delete n[id]; return n }) } else set(id, v) }}
          onTouch={touch}
        />
        {!revealed
          ? (
            <Commit
              ready={done}
              needs="Put everything somewhere first, then press Check my answer."
              onCommit={() => { setRevealed(true); speak(got === of, replyFor(render, render.fields[0]?.id ?? '', ''), '') }}
            />
          )
          : (
            <div className="bt-foot">
              <Plank size="md" onClick={() => onDone(picks, latency())}>Keep going</Plank>
              {last && <span className="bt-needs">That was the last one.</span>}
            </div>
          )}
      </div>
    )
  }

  // Rows: a sort into buckets, or an ordering into numbered spots.
  const allAnswered = render.fields.every((f) => picks[f.id])
  const missing = render.fields.filter((f) => !picks[f.id]).length
  const earned = scoreOf(check, picks)
  const outOf = pointsOf(check)
  const rowReply = replyFor(render, render.fields[0]?.id ?? '', '')
  return (
    <div className="bt-check" data-state={revealed ? (earned === outOf ? 'right' : 'wrong') : allAnswered ? 'answering' : 'presented'}>
      <div className="bt-prompt">{render.prompt}</div>
      <div className="bt-sort">
        {render.fields.map((f) => {
          const got = revealed && fieldRight(check, f, picks)
          const rowClass = !revealed ? '' : got ? ' bt-sortrow-true' : ' bt-sortrow-miss'
          return (
            <div className={`bt-sortrow${rowClass}`} key={f.id} role="group" aria-label={f.label}>
              <span className="bt-sortlabel">
                {f.label}
                {/* Nothing gets taken away. The row keeps its label and gains the right answer, and
                  * the chosen chip stays selected below it, so the student sees what they picked
                  * next to what's right. */}
                {revealed && !got && (
                  <span className="bt-truth">
                    <Glyph piece="icon_set" face="tick" size={14} />
                    {labelOf(f, f.correct)}
                  </span>
                )}
              </span>
              <span className="bt-buckets">
                {f.options.map((o) => {
                  const chosen = picks[f.id] === o.value
                  const isTruth = revealed && o.value === f.correct
                  return (
                    <button
                      key={o.value}
                      type="button"
                      className={`bt-bucket${isTruth ? ' bt-bucket-true' : ''}`}
                      aria-pressed={chosen}
                      aria-label={f.label ? `${f.label}: ${o.text}` : o.text}
                      disabled={revealed}
                      onClick={() => set(f.id, o.value)}
                    >
                      <span className="bt-bucketdot" aria-hidden="true" />
                      {o.text}
                    </button>
                  )
                })}
              </span>
            </div>
          )
        })}
      </div>
      {!revealed
        ? (
          <Commit
            ready={allAnswered}
            needs={missing === 1 ? 'One item still has no answer.' : `${missing} items still have no answer.`}
            onCommit={() => {
              setRevealed(true)
              speak(earned === outOf, rowReply, `${earned} of ${outOf} landed in the right place.`)
            }}
          />
        )
        : (
          <>
            {/* How many rows were right, said in words so nobody has to count. */}
            <div className="bt-count">{earned} of {outOf} in the right place.</div>
            {rowReply && <div className={`bt-reply${earned === outOf ? '' : ' bt-reply-miss'}`}>{rowReply}</div>}
            <div className="bt-foot">
              <Plank size="md" onClick={() => onDone(picks, latency())}>
                {earned === outOf ? 'All of them. Keep going' : 'Noted. Keep going'}
              </Plank>
              {last && <span className="bt-needs">That was the last one.</span>}
            </div>
          </>
        )}
    </div>
  )
}

/* Pick one: a choice, a quiz, a place, or a do with no world to walk in. It's its own component so
 * a do that can't be staged falls back to exactly this, not to a copy that could drift. */
function OneOf({ check, render, field, picked, last, onPick, onDone }: {
  check: CheckStep
  render: PlainRender
  field: PlainField
  picked: string | undefined
  last: boolean
  onPick: (value: string) => void
  onDone: () => void
}) {
  const done = picked !== undefined
  const got = done && fieldRight(check, field, { [field.id]: picked })
  const authored = done ? replyFor(render, field.id, picked) : ''
  return (
    <div className="bt-check" data-state={!done ? 'presented' : got ? 'right' : 'wrong'}>
      <div className="bt-prompt">{render.prompt}</div>
      <div className="bt-options">
        {field.options.map((o) => {
          const isTruth = done && o.value === field.correct
          const chosen = picked === o.value
          return (
            <button
              key={o.value}
              type="button"
              className={`bt-opt${isTruth ? ' bt-opt-true' : ''}${chosen && !isTruth ? ' bt-opt-miss' : ''}`}
              disabled={done}
              onClick={() => {
                onPick(o.value)
                /* The palette decides whether the pick was right, the same as everywhere else, so
                 * the reaction and the score always follow one rule. */
                speak(
                  fieldRight(check, field, { [field.id]: o.value }),
                  replyFor(render, field.id, o.value),
                  `The answer is ${labelOf(field, field.correct)}.`,
                )
              }}
            >
              {o.text}
              {/* The words show the state. A drawn tick shows when the kit is on, and the words
                * carry it when the kit is off, because color must never be the only sign of a
                * state. */}
              {isTruth && (
                <span className="bt-optmark bt-optmark-true">
                  <Glyph piece="icon_set" face="tick" size={14} />
                  the answer
                </span>
              )}
              {chosen && !isTruth && (
                <span className="bt-optmark bt-optmark-chose">
                  <Glyph piece="pointer" face="hand" size={14} />
                  you chose
                </span>
              )}
            </button>
          )
        })}
      </div>
      {done && (
        <>
          <div className={`bt-reply${got ? '' : ' bt-reply-miss'}`}>
            {authored || (got ? 'Right.' : 'Hm. Not quite.')}
          </div>
          <div className="bt-foot">
            <Plank size="md" onClick={onDone}>Keep going</Plank>
            {last && <span className="bt-needs">That was the last one.</span>}
          </div>
        </>
      )}
    </div>
  )
}

/* The showdown: rounds of questions, with a drive bar that moves on correct answers. */
function ShowdownPlay({ check, onDone, onTouch }: {
  check: Extract<CheckStep, { kind: 'showdown' }>
  onDone: (r: Response) => void
  onTouch: () => void
}) {
  const [s, setS] = useState<ShowdownState>(() => startShowdown(check.rounds))
  const round = check.rounds[s.round]

  /* The drive ends exactly once, when done turns true. The effect depends on the done flag instead
   * of the whole state, because s changes on every pick and this must not fire then. */
  useEffect(() => {
    if (s.done) onDone(responseOf(check.id, s))
  }, [s.done])

  if (!round) return null
  const picked = s.picked
  const got = picked !== null && !!round.options[picked].correct
  return (
    <div className="bt-check" data-state={picked === null ? 'presented' : got ? 'right' : 'wrong'}>
      <div className="bt-prompt">{check.prompt}</div>
      <div className="bt-drive">
        <Gauge
          value={progressOf(s)}
          label={`Yards gained against ${check.opponent}`}
          reading={`${yardsRemaining(s)} yards to go`}
        />
        <span className="bt-driveword">{check.opponent} · question {s.round + 1} of {s.total}</span>
      </div>
      <div className="bt-subprompt">{round.prompt}</div>
      <div className="bt-options">
        {round.options.map((o, i) => {
          const isTruth = picked !== null && !!o.correct
          const chosen = picked === i
          return (
            <button
              key={i}
              type="button"
              className={`bt-opt${isTruth ? ' bt-opt-true' : ''}${chosen && !o.correct ? ' bt-opt-miss' : ''}`}
              disabled={picked !== null}
              onClick={() => {
                onTouch()
                speak(!!o.correct, o.reply ?? '', o.correct ? 'Right.' : 'The right answer is marked.')
                setS((x) => showdownReduce(x, { kind: 'pick', index: i }, check.rounds))
              }}
            >
              {o.text}
              {isTruth && (
                <span className="bt-optmark bt-optmark-true">
                  <Glyph piece="icon_set" face="tick" size={14} />
                  the answer
                </span>
              )}
              {chosen && !o.correct && (
                <span className="bt-optmark bt-optmark-chose">
                  <Glyph piece="pointer" face="hand" size={14} />
                  you chose
                </span>
              )}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <>
          <div className={`bt-reply${got ? '' : ' bt-reply-miss'}`}>
            {round.options[picked].reply || (got ? 'Right.' : 'Not quite.')}
          </div>
          <div className="bt-foot">
            <Plank size="md" onClick={() => setS((x) => showdownReduce(x, { kind: 'next' }, check.rounds))}>
              {s.round + 1 >= s.total ? 'Last question. Keep going' : 'Next question'}
            </Plank>
          </div>
        </>
      )}
    </div>
  )
}

/* A do question answered by walking. Reaching one of the places the question named is the answer. */
/* How long a student can search for a place before the form is offered beside the walk. It's long
 * enough to cross the Maw twice and read what's on the way. */
const LOST_MS = 45_000

function DoPlay({ check, world, render, last, onDone, onTouch }: {
  check: Extract<CheckStep, { kind: 'do' }>
  world: BeatWorld
  render: PlainRender
  last: boolean
  onDone: (r: Response) => void
  onTouch: () => void
}) {
  const [reached, setReached] = useState<string | null>(null)
  /* A student who can't find the place gets the form instead of being stuck. */
  const [lost, setLost] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const done = useRef(false)

  /* Never send guide_to(goal.anchor) here. An arrow to the goal would make walking always correct
   * while the plain form could still get it wrong, so the two would be different questions. The
   * objective line repeats the question without answering it. */
  useEffect(() => {
    void world.issue({ kind: 'objective', text: check.prompt })
    const stop = world.onReached((anchor) => {
      if (done.current) return
      /* Only the places this question named count. Walking past something else on the way isn't an
       * answer, and counting it would score the student on the route they happened to take. */
      if (anchor !== check.goal.anchor && !check.decoys.some((d) => d.anchor === anchor)) return
      done.current = true
      onTouch()
      setReached(anchor)
    })
    /* After this long, the student would be scored on finding their way instead of on what they
     * learned. So the form comes up beside the walk as a way out, without replacing it. */
    const t = window.setTimeout(() => setLost(true), LOST_MS)
    return () => {
      stop()
      window.clearTimeout(t)
      void world.issue({ kind: 'objective', text: null })
    }
  }, [])

  if (lost && reached === null) {
    return (
      <OneOf
        check={check} render={render} field={render.fields[0]} picked={picked ?? undefined} last={last}
        onPick={(v) => { onTouch(); setPicked(v) }}
        onDone={() => onDone({ [check.id]: picked ?? '' })}
      />
    )
  }

  if (reached === null) {
    return (
      <div className="bt-check" data-state="presented">
        <div className="bt-prompt">{render.prompt}</div>
        {/* Don't name the place here. Naming it gives away the answer. */}
        <div className="bt-reply">Walk to the place you think it is.</div>
      </div>
    )
  }
  const got = reached === check.goal.anchor
  const authored = replyFor(render, check.id, reached)
  return (
    <div className="bt-check" data-state={got ? 'right' : 'wrong'}>
      <div className="bt-prompt">{render.prompt}</div>
      <div className={`bt-reply${got ? '' : ' bt-reply-miss'}`}>
        {authored || (got ? 'That is the place.' : 'Not this one.')}
      </div>
      <div className="bt-foot">
        <Plank size="md" onClick={() => onDone({ [check.id]: reached })}>Keep going</Plank>
        {last && <span className="bt-needs">That was the last one.</span>}
      </div>
    </div>
  )
}

/* The activity's place and title. */
function CardHead({ beat }: { beat: CoreBeat }) {
  return (
    <div className="bt-head">
      <span className="bt-place">{beat.place} · <b>{beat.title}</b></span>
    </div>
  )
}

// ---- result + review ------------------------------------------------------------------

/* The card every activity ends on: the letter, the grade points, what was earned and the way out. */
function ResultCard({ beat, score, canRetake, onReview, onClose }: {
  beat: CoreBeat; score: BeatScore
  canRetake: boolean; onReview: () => void; onClose: () => void
}) {
  const s = loadSave()
  const entry = s?.ledger.find((e) => e.id === beat.id)
  const thisRun = gradeOf(score)
  const grade = entry?.grade ?? thisRun
  const differs = Math.abs(grade - thisRun) > 0.005
  const passed = grade >= PASSING_GRADE
  const honors = letterOf(grade) === 'A'
  const closeCords = s ? cordsOf(s).filter((c) => !c.earned && c.progress >= 0.5) : []
  const facts = beat.takeaways.map(factById).filter((f): f is NonNullable<typeof f> => !!f)
  return (
    <div className="bt-result">
      <CardHead beat={beat} />
      <div className="bt-grade">
        <span className="bt-lettermark">{letterOf(grade)}</span>
        <span className="bt-gradelines">
          <span className="bt-gradenum">Grade points {grade.toFixed(2)} of 4.00 · {score.earned} of {score.total} points this run</span>
          <span className="bt-gradesays">
            {differs
              ? `This run scored ${thisRun.toFixed(2)}. The school keeps the higher attempt, so ${grade.toFixed(2)} is the one on your transcript.`
              : 'That letter and that number are what goes on your transcript.'}
          </span>
        </span>
      </div>
      <div className="bt-gaugerow">
        <Gauge
          value={score.total ? score.earned / score.total : null}
          label="Points earned in this activity"
          reading={`${score.earned} of ${score.total}`}
        />
      </div>
      {(passed || honors) && (
        <div className="bt-stamps">
          {/* An island's own activity has no credit of its own, because the programme's award
            * writes the row that carries the credit. Without this check the card would stamp 0
            * credit earned every time. */}
          {passed && beat.credit > 0 && (
            <span className="bt-stamp">
              <Glyph piece="stamp" face="approved" size={26} />
              <span className="bt-stampword">{beat.credit} credit earned</span>
            </span>
          )}
          {honors && (
            <span className="bt-stamp bt-stamp-honor">
              <Glyph piece="stamp" face="awarded" size={26} />
              <span className="bt-stampword">You got an A</span>
            </span>
          )}
        </div>
      )}
      {facts.length > 0 && (
        <div className="bt-takeaways">
          <div className="bt-h">{facts.length === 1 ? 'One fact saved to your Handbook' : `${facts.length} facts saved to your Handbook`}</div>
          {facts.map((f) => <div className="bt-fact" key={f.id}>{f.text}</div>)}
        </div>
      )}
      {closeCords.length > 0 && (
        <div className="bt-counselor">Cords you are close to earning: {closeCords.map((n) => n.name).join(', ')}. Open the Handbook to see them.</div>
      )}
      {canRetake && (
        <div className="bt-retake">
          <span className="bt-needs">You scored under a B-, so you can take this again. The Universal Retake Policy is real at Bonney Lake.</span>
          <Plank size="md" onClick={onReview}>Review, then retake</Plank>
        </div>
      )}
      <div className="bt-out">
        <Plank size="md" onClick={onClose}>Back to the game</Plank>
      </div>
    </div>
  )
}

/* Reads from marks on the ledger row, which finish writes every sitting. An older row without marks
 * says so instead of showing an empty card. It shows the question and how it went, never the answer
 * given, because students' responses don't belong in a browser save. */
function AnswersCard({ beat, onClose }: { beat: CoreBeat; onClose: () => void }) {
  const row = loadSave()?.ledger.find((e) => e.id === beat.id)
  const marks = row?.marks
  const items = checksOf(beat)
  const facts = beat.takeaways.map(factById).filter((f): f is NonNullable<typeof f> => !!f)
  return (
    <div className="bt-result">
      <CardHead beat={beat} />
      <div className="bt-prompt">
        {marks ? 'How each question went.' : 'This was sat before the game started keeping the marks.'}
      </div>
      {marks && (
        <ol className="bt-answers">
          {items.map((c) => {
            const id = checkIdOf(c)
            const m = marks[id]
            const right = !!m && m[1] > 0 && m[0] >= m[1]
            return (
              <li key={id} className={`bt-answer${right ? ' bt-answer-right' : ''}`}>
                <span className="bt-answer-mark" aria-hidden="true">{right ? '✓' : '✗'}</span>
                <span className="bt-answer-ask">{promptOf(c)}</span>
                <span className="bt-answer-score">
                  {m ? `${m[0]} of ${m[1]}` : 'not answered'}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {!!facts.length && (
        <>
          <div className="bt-prompt">What this was about.</div>
          <div className="bt-takeaways">
            {facts.map((f) => <div className="bt-fact" key={f.id}>{f.text}</div>)}
          </div>
        </>
      )}
      <div className="bt-out">
        <Plank size="md" onClick={onClose}>Back to the game</Plank>
      </div>
    </div>
  )
}

function ReviewCard({ beat, onRetake, onBack }: { beat: CoreBeat; onRetake: () => void; onBack: () => void }) {
  // The student reads the takeaways before the retake unlocks, so the retake comes after real
  // effort.
  const facts = beat.takeaways.map(factById).filter((f): f is NonNullable<typeof f> => !!f)
  return (
    <div className="bt-result">
      <CardHead beat={beat} />
      {/* The takeaways list can be empty. With no facts, this only says the beat can be taken
        * again, instead of telling a student who just failed to read something that isn't there. */}
      <div className="bt-prompt">
        {facts.length
          ? 'Read these first. Then you can retake it.'
          : 'You can take this one again. Your better attempt is the one that counts.'}
      </div>
      {facts.length > 0 && (
        <div className="bt-takeaways">
          {facts.map((f) => <div className="bt-fact" key={f.id}>{f.text}</div>)}
        </div>
      )}
      <div className="bt-out">
        <Plank size="md" onClick={onRetake}>Retake it</Plank>
        <Plank size="md" onClick={onBack}>Back to my score</Plank>
      </div>
    </div>
  )
}
