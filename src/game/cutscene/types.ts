// The cutscene script format. A cutscene is a plain list of steps that the runtime plays in order.

export type Ease = 'linear' | 'in' | 'out' | 'inOut'

export type Vec = { x: number; y: number }

export type Step =
  // -- timing --
  | { t: 'wait'; ms: number }
  // -- screen space (the overlay draws these) --
  | { t: 'letterbox'; on: boolean; ms?: number }
  | { t: 'vignette'; to: number; ms?: number }                    // 0 means none, 1 means fully closed.
  | { t: 'fade'; to: number; ms?: number; color?: string }        // Covers the whole screen. 0 means clear.
  | { t: 'say'; who?: string; text: string; portrait?: string }   // Types out. A click or Space moves on.
  | { t: 'caption'; text: string; ms: number }                    // One floating line, no box.
  // -- world space (the scene does these) --
  | { t: 'camera'; to?: Vec; zoom?: number; ms: number; ease?: Ease }
  | { t: 'cameraFollow'; actor: string | null }
  | { t: 'actorState'; actor: string; state: string }             // Swaps the sprite's state, like a wake-up pose.
  | { t: 'actorPlace'; actor: string; at: Vec; face?: string }
  | { t: 'actorMove'; actor: string; to: Vec; speed?: number; face?: string }
  | { t: 'actorFace'; actor: string; dir: string }
  | { t: 'actorShow'; actor: string; visible: boolean }
  | { t: 'fx'; name: string; at?: Vec; data?: unknown }
  | { t: 'audio'; cue: string }
  | { t: 'stage'; call: string; data?: unknown }                  // Calls custom scene code, like a tide change.
                                                                  // Gates wait for the player. A skip stops
                                                                  // at required ones.
  | { t: 'gate'; kind: 'walkTo'; target: Vec; radius: number; prompt?: string; idleAutoMs?: number; required?: boolean }
  | { t: 'gate'; kind: 'ui'; id: string; required?: boolean }     // Answered by a UI panel in the overlay.
  | { t: 'gate'; kind: 'confirm'; prompt?: string; required?: boolean } // Waits for a click or Space.
  // -- structure --
  | { t: 'all'; steps: Step[] }                                   // Runs side by side. Done when all are done.
  | { t: 'label'; name: string }

export type Script = { id: string; steps: Step[] }

// What a scene gives the runtime so it can control the scene. Positions are in the scene's own
// world units.
export interface CutsceneStage {
  cameraGet(): { x: number; y: number; zoom: number }
  cameraSet(x: number, y: number, zoom: number): void
  cameraFollow(actor: string | null): void
  actorState(actor: string, state: string): void
  actorPlace(actor: string, x: number, y: number, face?: string): void
  actorMove(actor: string, x: number, y: number, speed?: number, face?: string): () => boolean
  actorPos(actor: string): Vec
  actorFace(actor: string, dir: string): void
  actorShow(actor: string, visible: boolean): void
  fx(name: string, at?: Vec, data?: unknown): void
  audio(cue: string): void
  call(name: string, data?: unknown): (() => boolean) | void
  // true lets the player steer. The scene decides if that's free movement or a fixed path.
  playerControl(on: boolean): void
}

// What the overlay draws. The runtime owns it, and CutsceneOverlay reads it by subscribing.
export type OverlayState = {
  active: boolean
  letterbox: number                                               // How far the bars are in, from 0 to 1.
  vignette: number
  fade: number
  fadeColor: string
  dialogue: null | { who?: string; text: string; shown: number; done: boolean; portrait?: string }
  caption: null | { text: string; alpha: number }
  prompt: null | { text: string }
  uiGate: null | { id: string }                                   // A UI panel is open.
  skippable: boolean
}
