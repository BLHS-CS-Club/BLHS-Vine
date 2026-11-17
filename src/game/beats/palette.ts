// One table, keyed by kind of question. For each kind it says how many points it's worth, how it's
// scored, and how it looks as a plain form.

import type { CheckStep } from '../../vine/contract'
import { solves } from './program'

/* ---- what a student answered, in one shape for every kind and both versions ---- */

/* Maps each field id to the value the student chose. It's one flat map of strings for every kind. */
export type Response = Record<string, string>

/* ---- the plain form, built from the check ----------------------------------- */

/**
 * An option the student can pick. value is what scoring sees and text is what they read. They're
 * kept apart because a place check's value is an anchor name and a choice's value is an index.
 */
export type PlainOption = { value: string; text: string }

/** One answerable row. A choice has one field, and a sort has one field per item. */
export type PlainField = {
  id: string
  /** The row's own label. It's empty when the question is a single field under its prompt. */
  label: string
  input: 'radio' | 'select' | 'text'
  options: PlainOption[]
  /** The value that scores. A text field holds the answer as typed digits. */
  correct: string
}

/** What the plain form shows. The arm parity test compares this against the game version. */
export type PlainRender = {
  id: string
  prompt: string
  fields: PlainField[]
  /* The reply for each answer, keyed by field and value. A reply with value '' shows no matter what
   * the student answered. */
  replies: { field: string; value: string; text: string }[]
  /* Extra info the game version shows on a bar or gauge, like the showdown's opponent. It goes
   * beside the prompt here, because both versions must show the same prompt. */
  note?: string
}

/* ---- the table -------------------------------------------------------------- */

type ByKind = { [K in CheckStep['kind']]: Extract<CheckStep, { kind: K }> }

type Entry<K extends CheckStep['kind']> = {
  points: (c: ByKind[K]) => number
  score: (c: ByKind[K], r: Response) => number
  plain: (c: ByKind[K]) => PlainRender
}

/**
 * An option list with the correct index marked, shared by choice, quiz and showdown rounds. The
 * value is the index and never the words, so two options that read alike don't turn into one
 * answer.
 */
function optionFields(id: string, options: { text: string; correct?: boolean }[]): PlainField {
  return {
    id,
    label: '',
    input: 'radio',
    options: options.map((o, i) => ({ value: String(i), text: o.text })),
    correct: String(options.findIndex((o) => o.correct)),
  }
}

const optionReplies = (field: string, options: { reply?: string }[]) =>
  options.map((o, i) => ({ field, value: String(i), text: o.reply ?? '' })).filter((r) => r.text !== '')

/* One correction for the whole field, shown no matter what the student answered. */
const oneReply = (f: PlainField, reply: string | undefined): PlainRender['replies'] =>
  reply ? [{ field: f.id, value: '', text: reply }] : []

export const PALETTE: { [K in CheckStep['kind']]: Entry<K> } = {
  choice: {
    points: () => 1,
    score: (c, r) => (r[c.id] === String(c.options.findIndex((o) => o.correct)) ? 1 : 0),
    plain: (c) => ({
      id: c.id,
      prompt: c.prompt,
      fields: [optionFields(c.id, c.options)],
      replies: optionReplies(c.id, c.options),
    }),
  },

  quiz: {
    points: () => 1,
    score: (c, r) => (r[c.item.id] === String(c.item.correctIndex) ? 1 : 0),
    plain: (c) => ({
      id: c.item.id,
      prompt: c.item.prompt,
      fields: [{
        id: c.item.id,
        label: '',
        input: 'radio',
        options: c.item.choices.map((t, i) => ({ value: String(i), text: t })),
        correct: String(c.item.correctIndex),
      }],
      /* A quiz has one explanation for the whole question instead of one per option. Every option
       * shows it, so the plain form has to show it too. */
      replies: c.item.explanation
        ? [{ field: c.item.id, value: '', text: c.item.explanation }]
        : [],
    }),
  },

  sort: {
    points: (c) => c.items.length,
    score: (c, r) => c.items.filter((it) => r[`${c.id}:${it.label}`] === it.bucket).length,
    plain: (c) => ({
      id: c.id,
      prompt: c.prompt,
      fields: c.items.map((it) => ({
        id: `${c.id}:${it.label}`,
        label: it.label,
        input: 'select' as const,
        options: c.buckets.map((b) => ({ value: b, text: b })),
        correct: it.bucket,
      })),
      replies: [],
    }),
  },

  number: {
    points: () => 1,
    /* The tolerance is a fixed amount set on the check. A blank or a word scores zero instead of
     * throwing, because a student typing "twenty four" gave a wrong answer and shouldn't crash
     * anything. */
    score: (c, r) => {
      const given = Number((r[c.id] ?? '').trim())
      if (!Number.isFinite(given) || (r[c.id] ?? '').trim() === '') return 0
      return Math.abs(given - c.answer) <= (c.tolerance ?? 0) ? 1 : 0
    },
    plain: (c) => {
      const f: PlainField = {
        id: c.id, label: c.unit ?? '', input: 'text', options: [], correct: String(c.answer),
      }
      return { id: c.id, prompt: c.prompt, fields: [f], replies: oneReply(f, c.reply) }
    },
  },

  order: {
    /* One point per item in its right spot, so a partly right order still earns points. */
    points: (c) => c.items.length,
    score: (c, r) => c.items.filter((it) => r[`${c.id}:${it.label}`] === String(it.position)).length,
    plain: (c) => ({
      id: c.id,
      prompt: c.prompt,
      fields: c.items.map((it) => ({
        id: `${c.id}:${it.label}`,
        label: it.label,
        input: 'select' as const,
        options: c.items.map((_, i) => ({ value: String(i + 1), text: `Position ${i + 1}` })),
        correct: String(it.position),
      })),
      replies: c.reply && c.items.length
        ? [{ field: `${c.id}:${c.items[0].label}`, value: '', text: c.reply }] : [],
    }),
  },

  place: {
    points: () => 1,
    score: (c, r) => (r[c.id] === c.correct ? 1 : 0),
    plain: (c) => {
      const f: PlainField = {
        id: c.id,
        label: '',
        input: 'radio',
        options: c.regions.map((g) => ({ value: g.name, text: g.label })),
        correct: c.correct,
      }
      return { id: c.id, prompt: c.prompt, fields: [f], replies: oneReply(f, c.reply) }
    },
  },

  do: {
    points: () => 1,
    /* The answer is an anchor name in both versions, so there's one line of scoring. */
    score: (c, r) => (r[c.id] === c.goal.anchor ? 1 : 0),
    plain: (c) => {
      const f: PlainField = {
        id: c.id,
        label: '',
        input: 'radio',
        options: [c.goal, ...c.decoys].map((g) => ({ value: g.anchor, text: g.label })),
        correct: c.goal.anchor,
      }
      return { id: c.id, prompt: c.prompt, fields: [f], replies: oneReply(f, c.reply) }
    },
  },

  showdown: {
    points: (c) => c.rounds.length,
    score: (c, r) => c.rounds.filter((rd) => r[`${c.id}:${rd.id}`] === String(rd.options.findIndex((o) => o.correct))).length,
    /* As a plain form, a showdown is a list of its rounds, since the questions are the content. */
    plain: (c) => ({
      id: c.id,
      prompt: c.prompt,
      /* The game version shows the opponent on the drive bar and over every question, so the form
       * names the opponent too. */
      note: c.opponent ? `Against ${c.opponent}.` : undefined,
      fields: c.rounds.map((rd) => ({ ...optionFields(`${c.id}:${rd.id}`, rd.options), label: rd.prompt })),
      replies: c.rounds.flatMap((rd) => optionReplies(`${c.id}:${rd.id}`, rd.options)),
    }),
  },

  /* A program is scored slot by slot, keyed on the slot's number starting from 1. It can't key on
   * the label the way order does, because two slots that use the same instruction would turn into
   * one answer and a full response would score one short. */
  program: {
    points: (c) => c.slots.length,
    /* A program that reaches the flag gets full marks, even if its steps differ from the author's.
     * The ATC maze has three different five-step solutions, for example. A program that misses
     * still earns a point for each step that matches. */
    score: (c, r) => {
      const written = c.slots.map((_, i) => r[`${c.id}:${i + 1}`] ?? '')
      if (solves(c.board, written)) return c.slots.length
      return c.slots.filter((s, i) => r[`${c.id}:${i + 1}`] === s.move).length
    },
    /* The board goes in note, not in the prompt, because the parity test holds both versions to the
     * same prompt. Without the board, the plain form would ask the student to order five
     * instructions with no problem to solve, which tests memory instead of reasoning. */
    plain: (c) => {
      const fields = c.slots.map((s, i) => ({
        id: `${c.id}:${i + 1}`,
        label: s.label,
        input: 'select' as const,
        /* Every move is offered at every slot, so both versions have the same possible answers.
         * Don't remove cards from the pool as they're used. That would leave the game version with
         * fewer wrong answers than the form. */
        options: c.moves.map((m) => ({ value: m.name, text: m.label })),
        correct: s.move,
      }))
      return {
        id: c.id,
        prompt: c.prompt,
        note: c.grid,
        fields,
        replies: fields.length ? oneReply(fields[0], c.reply) : [],
      }
    },
  },
}

/* The one place a check gets looked up in the table, type cast included. */

const entry = (c: CheckStep) => PALETTE[c.kind] as unknown as Entry<CheckStep['kind']> & {
  points: (c: CheckStep) => number
  score: (c: CheckStep, r: Response) => number
  plain: (c: CheckStep) => PlainRender
}

/** Total points possible. This is the bottom number on the result card and the transcript. */
export const pointsOf = (c: CheckStep): number => entry(c).points(c)

/** What this response earned. This is the only scoring function in the game. */
export const scoreOf = (c: CheckStep, r: Response): number => entry(c).score(c, r)

/**
 * The plain form, built from the check. Nobody writes it by hand, and there's no as_plain: false to
 * turn it off.
 */
export const plainOf = (c: CheckStep): PlainRender => entry(c).plain(c)

/**
 * The id a check uses in the ledger and the event log. A quiz keeps its id on its item, and every
 * other kind keeps it on itself.
 */
export const checkIdOf = (c: CheckStep): string => (c.kind === 'quiz' ? c.item.id : c.id)

/** The question in the author's own words, the same in both versions. */
export const promptOf = (c: CheckStep): string => (c.kind === 'quiz' ? c.item.prompt : c.prompt)

/* True if this field earned its point, using the same scoring as the whole question. A program is
 * the one kind where a step can't be judged alone: a working route the author didn't write has five
 * right steps, and marking each field on its own would mark most of them wrong on top of a full
 * score. */
export const fieldRight = (c: CheckStep, f: PlainField, r: Response): boolean => {
  if (c.kind === 'program') {
    const written = c.slots.map((_, i) => r[`${c.id}:${i + 1}`] ?? '')
    if (solves(c.board, written)) return true
    return r[f.id] === plainOf(c).fields.find((q) => q.id === f.id)?.correct
  }
  return scoreOf(c, { [f.id]: r[f.id] ?? '' }) > 0
}

/**
 * The response that earns full marks, read off the plain fields. It proves the plain form can reach
 * the same score as the game version, so nothing is lost in the copy.
 */
export const fullMarks = (c: CheckStep): Response =>
  Object.fromEntries(plainOf(c).fields.map((f) => [f.id, f.correct]))

/* Refuse a question that can't be answered, naming it, when it loads instead of when it's on
 * screen. */
export function refuseCheck(c: CheckStep): string | null {
  const id = checkIdOf(c)
  /* Check for an unknown kind first. The switch below has a case per kind and no default, so a typo
   * in kind would get through, and entry() would read PALETTE[c.kind] as undefined and show a white
   * page. This way the author gets a sentence naming the bad word and the kinds that exist. */
  if (!(c.kind in PALETTE))
    return `check "${id}" is a "${String(c.kind)}", which is not a kind of question this game has. `
      + `It has: ${Object.keys(PALETTE).sort().join(', ')}`
  const oneCorrect = (opts: { correct?: boolean }[], where: string) => {
    const n = opts.filter((o) => o.correct).length
    if (n !== 1) return `${where} must have exactly one correct option, it has ${n}`
    if (opts.length < 2) return `${where} must offer at least two options`
    return null
  }
  switch (c.kind) {
    case 'choice': return oneCorrect(c.options, `check "${id}"`)
    case 'quiz':
      if (c.item.choices.length < 2) return `check "${id}" must offer at least two options`
      return c.item.correctIndex >= 0 && c.item.correctIndex < c.item.choices.length
        ? null : `check "${id}" has correctIndex ${c.item.correctIndex} and ${c.item.choices.length} choices`
    case 'sort': {
      if (!c.items.length) return `check "${id}" has no items to sort`
      const stray = c.items.find((it) => !c.buckets.includes(it.bucket))
      return stray ? `check "${id}" sorts "${stray.label}" into "${stray.bucket}", which is not one of its buckets` : null
    }
    case 'number':
      return Number.isFinite(c.answer) ? null : `check "${id}" has no finite answer`
    case 'order': {
      const want = c.items.map((_, i) => i + 1).join(',')
      const got = c.items.map((it) => it.position).sort((a, b) => a - b).join(',')
      return want === got ? null : `check "${id}" positions must be 1..${c.items.length} exactly once, they are ${got}`
    }
    case 'place':
      if (c.regions.length < 2) return `check "${id}" must name at least two regions`
      return c.regions.some((g) => g.name === c.correct)
        ? null : `check "${id}" is correct on region "${c.correct}", which it does not name`
    case 'do':
      /* Every author hits this one: a question staged in the world with no wrong place to go turns
       * into a plain form question with only one option. */
      return c.decoys.length ? null : `check "${id}" is a do with no decoys, so the plain arm has one option and no question`
    case 'showdown': {
      if (!c.rounds.length) return `check "${id}" is a showdown with no rounds`
      for (const rd of c.rounds) {
        const bad = oneCorrect(rd.options, `check "${id}" round "${rd.id}"`)
        if (bad) return bad
      }
      return null
    }
    case 'program': {
      if (!c.slots.length) return `check "${id}" is a program with no slots to fill`
      /* One move isn't a choice. The form would show a dropdown with a single option, the same
       * problem as a do check with no decoys. */
      if (c.moves.length < 2) return `check "${id}" must offer at least two instructions`
      const twice = c.moves.find((m, i) => c.moves.findIndex((n) => n.name === m.name) !== i)
      if (twice) return `check "${id}" offers the instruction "${twice.name}" twice, so two options carry one value`
      const stray = c.slots.find((s) => !c.moves.some((m) => m.name === s.move))
      return stray
        ? `check "${id}" wants "${stray.move}" at "${stray.label}", which is not one of its instructions`
        : null
    }
  }
}
