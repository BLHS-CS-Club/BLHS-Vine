import type { ComponentType } from 'react'
import type { GrapeEvent } from './events'
import type { ThemeTokens } from './theme'

// The ten campus districts, taken from the real BLHS layout.
export type DistrictId =
  | 'commons'
  | 'stem'
  | 'learning-communities'
  | 'arts'
  | 'career-cte'
  | 'athletics-indoor'
  | 'athletic-fields'
  | 'jrotc'
  | 'student-services'
  | 'honors'

// What kind of BLHS thing a grape is about. Each grape picks one.
export type GrapeCategory =
  | 'sport'
  | 'competitive-club'
  | 'interest-club'
  | 'curricular'
  | 'policy'
  | 'academic-honor'
  | 'elective'
  | 'ap'

// How the session runs. 'game' is the full experience, and it's the only mode.
export type SessionMode = 'game'

export interface MediaClip {
  id: string
  kind: 'youtube' | 'file'
  src: string
  caption?: string
  durationSeconds?: number
}

export interface QuizItem {
  id: string
  prompt: string
  choices: string[]
  correctIndex: number
  explanation?: string
  objective?: string
}

export interface DialogueLine {
  speaker: string
  text: string
}

export interface HandbookEntry {
  id?: string
  heading: string
  body: string
}

// A grape played as a scene: a character, some dialogue, an optional cutscene, a check and a
// reward.

export interface NpcDef {
  id: string
  name: string
  sprite?: string        // Idle and walk sheet. Leave it out for a default actor.
  portrait?: string      // The face shown next to their dialogue.
}

export interface SceneLine {
  speaker: string                                            // 'Thor', the character's name, and so on.
  text: string
  portrait?: string                                          // Use a different portrait for this one line.
  emote?: 'neutral' | 'happy' | 'surprised' | 'think'
}

// Cutscene steps written as data. While one plays, the player loses control and Thor follows the
// character. Keep them small so they're easy to write.
export type CutsceneStep =
  | { kind: 'say'; line: SceneLine }
  | { kind: 'move'; actor: 'thor' | 'npc'; to: string }      // `to` is the name of a mark in the room.
  | { kind: 'face'; actor: 'thor' | 'npc'; dir: 'up' | 'down' | 'left' | 'right' }
  | { kind: 'camera'; to: string }
  | { kind: 'wait'; ms: number }

// The nine kinds of check an island can use to score what a student understood.
export type CheckStep =
  // A dialogue choice that matters, like making a pitch. A good reply lands and a weak one gets a
  // hint.
  | { kind: 'choice'; id: string; prompt: string; options: { text: string; correct?: boolean; reply: string }[]; objective?: string }
  // A plain multiple choice question, for simple checks.
  | { kind: 'quiz'; item: QuizItem }
  // Drag items into the right buckets, like stocking a trophy case.
  | { kind: 'sort'; id: string; prompt: string; buckets: string[]; items: { label: string; bucket: string }[]; objective?: string }
  /* Type a number. The data can say how far off an answer is still allowed to be. */
  | { kind: 'number'; id: string; prompt: string; answer: number; tolerance?: number; unit?: string; reply?: string; objective?: string }
  /* Put items in order. Each item in its correct place scores a point. */
  | { kind: 'order'; id: string; prompt: string; items: { label: string; position: number }[]; reply?: string; objective?: string }
  /* Pick a named region. The name the code uses is kept separate from the label the student reads. */
  | { kind: 'place'; id: string; prompt: string; regions: { name: string; label: string }[]; correct: string; image?: string; reply?: string; objective?: string }
  /* Scores an action. The student has to go to the right anchor, and the decoys are the wrong ones. */
  | { kind: 'do'; id: string; prompt: string; goal: { anchor: string; label: string }; decoys: { anchor: string; label: string }[]; reply?: string; objective?: string }
  /* A turn-based contest where knowing things is how you win. Each round is worth one point. */
  | { kind: 'showdown'; id: string; prompt: string; opponent: string; rounds: ShowdownRound[]; objective?: string }
  /* A program the student builds out of moves and then watches run. It scores one point per slot,
   * keyed by the slot's number and not the card's label, so the same move can sit in two slots
   * without the two answers merging into one. Every slot can hold any move from the list. */
  | {
    kind: 'program'; id: string; prompt: string
    /** The board drawn as a figure, so the same problem can be shown without the walking board. */
    grid: string
    /** The moves every slot can choose from. There must be two or more. */
    moves: { name: string; label: string }[]
    /** One entry per numbered slot, in order. `move` is the move that belongs in that slot. */
    slots: { label: string; move: string }[]
    /* The board the character walks while the student watches. Only the game draws it, and scoring
     * never reads it, so the walk can't change the score. */
    board?: {
      cols: number; rows: number
      walls: [number, number][]
      flag: [number, number]
      start: { col: number; row: number; facing: 'north' | 'south' | 'east' | 'west' }
    }
    reply?: string; objective?: string
  }

/**
 * One round of a showdown. It has the same shape as a `choice`, because a round is a choice with a
 * scoreboard behind it.
 */
export interface ShowdownRound {
  id: string
  prompt: string
  options: { text: string; correct?: boolean; reply: string }[]
}

export interface RewardDef {
  points?: number
  handbookEntryId?: string     // Unlocks an entry in the in-game Handbook.
  achievementId?: string
}

// The full in-world encounter, with each beat of the scene written as data.
export interface GrapeEncounter {
  npc: NpcDef
  room?: string                // The room it plays in, like '305'. Placement gives the building.
  intro?: SceneLine[]          // Beat 3, the dialogue.
  media?: MediaClip            // Beat 4, the real video in a frame.
  cutscene?: CutsceneStep[]    // An optional extra beat where Thor follows the character.
  check: CheckStep[]           // Beat 5, the checks woven into the scene.
  outro?: SceneLine[]
  reward?: RewardDef           // Beat 6, the reward the player gets.
}

// Pure data. A grape with no code ships this plus a manifest. Add `encounter` for the full in-world
// scene, or leave it out to get the simple intro, clips and quiz.
export interface GrapeContent {
  intro?: DialogueLine[]
  clips?: MediaClip[]
  quiz?: QuizItem[]
  handbook?: HandbookEntry[]
  outro?: DialogueLine[]
  encounter?: GrapeEncounter
}

export interface CompletionCriteria {
  clipsViewed?: boolean
  quizAttempted?: boolean
  minScorePercent?: number
}

export interface RankTrack {
  id: string
  tiers: string[]
}

export interface AchievementRule {
  id: string
  label: string
  when: 'completed' | 'perfectQuiz'
}

export interface ProgressionRules {
  contributesToGpa?: boolean
  rankTrack?: RankTrack
  achievements?: AchievementRule[]
}

// Where the grape lives. district and building place it, and archetype and accent pick art that
// gets reused.
export interface GrapePlacement {
  district: DistrictId
  building: string
  archetype?: string
  accent?: string
}

export interface GrapeManifest {
  id: string
  title: string
  category: GrapeCategory
  blurb: string
  author?: string
  estimatedMinutes: number
  learningObjectives: string[]
  placement: GrapePlacement
  completion: CompletionCriteria
  progression?: ProgressionRules
}

export interface PlayerView {
  displayName: string
  gender: 'boy' | 'girl' | 'unspecified'
  gpa: number
  completedGrapeIds: string[]
  ranks: Record<string, string>
  achievements: string[]
}

export interface GrapeResult {
  grapeId: string
  quizScorePercent?: number
  clipsViewed?: string[]
  rankTier?: string
  raw?: Record<string, unknown>
}

// What the vine gives a grape that has its own code. Grapes made only of data never use this.
export interface VineServices {
  mode: SessionMode
  player: PlayerView
  theme: ThemeTokens
  log: (event: GrapeEvent) => void
  complete: (result: GrapeResult) => void
  exit: () => void
}

export interface GrapeComponentProps extends VineServices {
  manifest: GrapeManifest
  content: GrapeContent
}

// The piece a member ships. Leave out Component and the vine draws the content for you.
export interface GrapeModule {
  manifest: GrapeManifest
  content: GrapeContent
  Component?: ComponentType<GrapeComponentProps>
}
