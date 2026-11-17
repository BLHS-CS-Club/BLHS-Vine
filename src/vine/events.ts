import type { SessionMode } from './contract'

interface EventBase {
  grapeId: string
  at: number
}

export interface GrapeEnter extends EventBase {
  type: 'grape_enter'
}

export interface GrapeExit extends EventBase {
  type: 'grape_exit'
  completed: boolean
  dwellMs: number
}

export interface DialogueAdvanced extends EventBase {
  type: 'dialogue_advanced'
  index: number
}

export interface ClipStart extends EventBase {
  type: 'clip_start'
  clipId: string
}

export interface ClipComplete extends EventBase {
  type: 'clip_complete'
  clipId: string
  watchedSeconds: number
  skipped: boolean
}

export interface QuizItemShown extends EventBase {
  type: 'quiz_item_shown'
  itemId: string
}

export interface QuizItemAnswered extends EventBase {
  type: 'quiz_item_answered'
  itemId: string
  chosenIndex: number
  correct: boolean
  responseMs: number
  attempt: number
}

export interface QuizSubmitted extends EventBase {
  type: 'quiz_submitted'
  scorePercent: number
  itemCount: number
}

export interface GrapeCompleted extends EventBase {
  type: 'grape_completed'
  scorePercent?: number
  rankTier?: string
}

// One loose shape for the vine's own events. The event's name goes in name and its details go in
// data.
export interface GameEvent extends EventBase {
  type: 'game'
  name: string
  data?: Record<string, unknown>
}

export type GrapeEvent =
  | GrapeEnter
  | GrapeExit
  | DialogueAdvanced
  | ClipStart
  | ClipComplete
  | QuizItemShown
  | QuizItemAnswered
  | QuizSubmitted
  | GrapeCompleted
  | GameEvent

// What gets sent to Neon: each event wrapped with which session, which player and which build it
// came from.
export interface LogEnvelope {
  schemaVersion: number
  appVersion: string
  sessionId: string
  participantId: string
  mode: SessionMode
  /**
   * True for a captain or god-mode session. It still gets sent so it can help with debugging, but
   * it's left out of the data exports.
   */
  dev?: boolean
  /** An id made in the browser, so a batch that got sent twice can be counted once. */
  eid?: string
  event: GrapeEvent
}
