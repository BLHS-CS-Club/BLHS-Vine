import type { CutsceneStage, Ease, OverlayState, Script, Step, Vec } from './types'

// This runs a cutscene script one step at a time. The scene calls tick() every frame, and any step
// can either play out normally or jump straight to how it ends.

const LETTERBOX_MS = 450
const VIGNETTE_MS = 600
const FADE_MS = 500
const CAPTION_FADE_MS = 350
const CHARS_PER_S = 38               // How fast the text types out.
const PUNCT_PAUSE_MS = 160           // Extra pause after . ! ? or ...
const DIALOGUE_MIN_MS = 250          // Clicks are ignored this early in a line.

const eases: Record<Ease, (v: number) => number> = {
  linear: (v) => v,
  in: (v) => v * v,
  out: (v) => 1 - (1 - v) * (1 - v),
  inOut: (v) => (v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v)),
}

type Tween = { from: number; to: number; ms: number; at: number; ease: (v: number) => number; set: (v: number) => void; done?: () => void }

// What a step needs to remember while it's running.
type Live =
  | { k: 'wait'; left: number }
  | { k: 'poll'; poll: () => boolean }
  | { k: 'tween' }                                   // The tween's done() says when it's finished.
  | { k: 'say'; elapsed: number; extra: number }     // extra adds up all the punctuation pauses.
  | { k: 'caption'; left: number }
  | { k: 'gateWalk'; target: Vec; radius: number; idleAutoMs: number; idle: number; auto: (() => boolean) | null; actor: string }
  | { k: 'gateUi'; id: string }
  | { k: 'gateConfirm' }
  | { k: 'all'; runners: Runner[] }

class Runner {
  steps: Step[]
  i = -1
  live: Live | null = null
  constructor(steps: Step[]) { this.steps = steps }
  get finished() { return this.i >= this.steps.length && this.live === null }
}

export class CutsceneRuntime {
  private stage: CutsceneStage
  private root: Runner | null = null
  private tweens: Tween[] = []
  private listeners = new Set<() => void>()
  private onDone: (() => void) | null = null
  private advanceQueued = false
  private confirmQueued = false
  private uiResolved = new Set<string>()
  playerActor = 'thor'                                // The actor that walkTo gates watch.

  ui: OverlayState = {
    active: false, letterbox: 0, vignette: 0, fade: 0, fadeColor: '#05070a',
    dialogue: null, caption: null, prompt: null, uiGate: null, skippable: true,
  }

  constructor(stage: CutsceneStage) { this.stage = stage }

  // ---- host API ----------------------------------------------------------------

  play(script: Script, onDone?: () => void) {
    this.root = new Runner(script.steps)
    this.onDone = onDone ?? null
    this.ui.active = true
    this.stage.playerControl(false)
    this.emit()
  }

  get running() { return this.root !== null }

  /**
   * Called by the overlay on a click or key press. It finishes or moves past the current line and
   * answers any confirm gate.
   */
  advance() { this.advanceQueued = true; this.confirmQueued = true }

  /** The overlay tells the runtime that the UI gate with this id has been answered. */
  resolveUi(id: string) { this.uiResolved.add(id) }

  /** Hold-to-skip went off. Jump ahead to the next required gate, or to the end. */
  skip() {
    if (!this.root) return
    this.fastForward(this.root)
    this.emit()
  }

  /**
   * End the whole cutscene right now. A walkTo gate puts the player on its target, and every other
   * gate is passed over.
   */
  godSkip() {
    if (!this.root) return
    const r = this.root
    if (r.live?.k === 'gateUi') { this.ui.uiGate = null; r.live = null }
    while (r.i < r.steps.length) {
      if (r.live) { this.applyInstantLive(r, r.live); r.live = null }
      r.i++
      if (r.i >= r.steps.length) break
      const s = r.steps[r.i]
      if (s.t === 'gate') {
        if (s.kind === 'walkTo') this.stage.actorPlace(this.playerActor, s.target.x, s.target.y)
        continue
      }
      this.applyInstant(s)
    }
    this.finish()
    this.emit()
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { for (const fn of this.listeners) fn() }

  // ---- tick --------------------------------------------------------------------

  tick(dtMs: number) {
    if (!this.root) return
    // Cap the frame time at 100 ms. A slow frame then slows the scene down instead of skipping past
    // parts of it.
    dtMs = Math.min(dtMs, 100)
    // Run the tweens first so the screen values are up to date before the step logic reads them.
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]
      tw.at += dtMs
      const v = Math.min(1, tw.at / tw.ms)
      tw.set(tw.from + (tw.to - tw.from) * tw.ease(v))
      if (v >= 1) { this.tweens.splice(i, 1); tw.done?.() }
    }
    this.step(this.root, dtMs)
    this.advanceQueued = false
    this.confirmQueued = false
    if (this.root.finished) this.finish()
    this.emit()
  }

  private finish() {
    this.root = null
    this.tweens = []
    this.ui.active = false
    this.ui.dialogue = null; this.ui.caption = null; this.ui.prompt = null; this.ui.uiGate = null
    this.stage.playerControl(true)
    const cb = this.onDone; this.onDone = null
    cb?.()
  }

  // Move one runner forward by dt. It calls itself for steps that run side by side.
  private step(r: Runner, dt: number) {
    // Keep the step that's already running going.
    if (r.live) {
      if (!this.pump(r.live, dt)) return       // Not finished yet.
      r.live = null
    }
    // Start the next steps until one of them needs time.
    while (r.live === null && r.i < r.steps.length) {
      r.i++
      if (r.i >= r.steps.length) break
      const s = r.steps[r.i]
      r.live = this.begin(s)
      if (r.live && !this.pump(r.live, 0)) return
      r.live = null
    }
  }

  // Gives back a Live if the step needs time, or null if it finished right away.
  private begin(s: Step): Live | null {
    switch (s.t) {
      case 'wait': return { k: 'wait', left: s.ms }
      case 'label': return null
      case 'letterbox': {
        this.tween(this.ui.letterbox, s.on ? 1 : 0, s.ms ?? LETTERBOX_MS, 'inOut', (v) => { this.ui.letterbox = v })
        return null                                  // The bars never make the script wait.
      }
      case 'vignette': {
        this.tween(this.ui.vignette, s.to, s.ms ?? VIGNETTE_MS, 'inOut', (v) => { this.ui.vignette = v })
        return null
      }
      case 'fade': {
        if (s.color) this.ui.fadeColor = s.color
        let settled = false
        this.tween(this.ui.fade, s.to, s.ms ?? FADE_MS, 'inOut', (v) => { this.ui.fade = v }, () => { settled = true })
        return { k: 'poll', poll: () => settled }    // Fades do make the script wait, to pace reveals.
      }
      case 'say': {
        if (!s.text?.trim()) return null              // A say with no text is skipped, so no empty box shows.
        this.ui.dialogue = { who: s.who, text: s.text, shown: 0, done: false, portrait: s.portrait }
        return { k: 'say', elapsed: 0, extra: 0 }
      }
      case 'caption': {
        this.ui.caption = { text: s.text, alpha: 0 }
        this.tween(0, 1, CAPTION_FADE_MS, 'out', (v) => { if (this.ui.caption) this.ui.caption.alpha = v })
        return { k: 'caption', left: s.ms }
      }
      case 'camera': {
        const cam = this.stage.cameraGet()
        const to = s.to ?? { x: cam.x, y: cam.y }
        const zoom = s.zoom ?? cam.zoom
        this.stage.cameraFollow(null)
        let settled = false
        const ease = s.ease ?? 'inOut'
        this.tween(0, 1, s.ms, ease, (v) => {
          this.stage.cameraSet(cam.x + (to.x - cam.x) * v, cam.y + (to.y - cam.y) * v, cam.zoom + (zoom - cam.zoom) * v)
        }, () => { settled = true })
        return { k: 'poll', poll: () => settled }
      }
      case 'cameraFollow': this.stage.cameraFollow(s.actor); return null
      case 'actorState': this.stage.actorState(s.actor, s.state); return null
      case 'actorPlace': this.stage.actorPlace(s.actor, s.at.x, s.at.y, s.face); return null
      case 'actorFace': this.stage.actorFace(s.actor, s.dir); return null
      case 'actorShow': this.stage.actorShow(s.actor, s.visible); return null
      case 'actorMove': {
        const poll = this.stage.actorMove(s.actor, s.to.x, s.to.y, s.speed, s.face)
        return { k: 'poll', poll }
      }
      case 'fx': this.stage.fx(s.name, s.at, s.data); return null
      case 'audio': this.stage.audio(s.cue); return null
      case 'stage': {
        const poll = this.stage.call(s.call, s.data)
        return poll ? { k: 'poll', poll } : null
      }
      case 'gate': {
        if (s.kind === 'walkTo') {
          this.ui.prompt = s.prompt ? { text: s.prompt } : null
          this.stage.playerControl(true)             // A cutscene normally locks the player, so unlock them.
          return { k: 'gateWalk', target: s.target, radius: s.radius, idleAutoMs: s.idleAutoMs ?? 6000, idle: 0, auto: null, actor: this.playerActor }
        }
        if (s.kind === 'ui') { this.ui.uiGate = { id: s.id }; return { k: 'gateUi', id: s.id } }
        this.ui.prompt = s.prompt ? { text: s.prompt } : null
        return { k: 'gateConfirm' }
      }
      case 'all': {
        const runners = s.steps.map((st) => new Runner([st]))
        return { k: 'all', runners }
      }
    }
  }

  // Gives back true when the running step is finished.
  private pump(live: Live, dt: number): boolean {
    switch (live.k) {
      case 'wait': live.left -= dt; return live.left <= 0
      case 'poll': return live.poll()
      case 'tween': return true
      case 'say': {
        const d = this.ui.dialogue
        if (!d) return true
        live.elapsed += dt
        if (!d.done) {
          const budget = Math.max(0, live.elapsed - live.extra) * (CHARS_PER_S / 1000)
          let shown = d.shown
          while (shown < d.text.length && shown < budget) {
            const ch = d.text[shown]
            shown++
            /* A character that ends a sentence adds a short pause to the typing. */
            if ('.!?…'.includes(ch)) live.extra += PUNCT_PAUSE_MS
          }
          d.shown = shown
          if (shown >= d.text.length) d.done = true
          if (this.advanceQueued && live.elapsed > DIALOGUE_MIN_MS) { d.shown = d.text.length; d.done = true }
          return false
        }
        if (this.advanceQueued && live.elapsed > DIALOGUE_MIN_MS) { this.ui.dialogue = null; return true }
        return false
      }
      case 'caption': {
        live.left -= dt
        if (live.left <= 0 && this.ui.caption && this.ui.caption.alpha >= 1) {
          const cap = this.ui.caption
          this.tween(1, 0, CAPTION_FADE_MS, 'in', (v) => { cap.alpha = v }, () => { if (this.ui.caption === cap) this.ui.caption = null })
          return true
        }
        return live.left <= 0 && this.ui.caption === null
      }
      case 'gateWalk': {
        const p = this.stage.actorPos(live.actor)
        const dx = p.x - live.target.x, dy = p.y - live.target.y
        if (dx * dx + dy * dy <= live.radius * live.radius) {
          this.ui.prompt = null
          this.stage.playerControl(false)
          return true
        }
        /* The player is being walked there automatically. When that walk finishes, the gate is done
         * too. */
        if (live.auto) {
          if (!live.auto()) return false
          this.ui.prompt = null
          this.stage.playerControl(false)
          return true
        }
        else {
          live.idle += dt
          if (live.idle >= live.idleAutoMs) {          // Idle too long, so walk the player there.
            this.stage.playerControl(false)
            live.auto = this.stage.actorMove(live.actor, live.target.x, live.target.y, undefined)
          }
        }
        return false
      }
      case 'gateUi': {
        if (this.uiResolved.has(live.id)) { this.uiResolved.delete(live.id); this.ui.uiGate = null; return true }
        return false
      }
      case 'gateConfirm': {
        if (this.confirmQueued) { this.ui.prompt = null; return true }
        return false
      }
      case 'all': {
        let done = true
        for (const child of live.runners) { this.step(child, dt); if (!child.finished) done = false }
        return done
      }
    }
  }

  // ---- skip: apply end states instantly up to the next required gate -------------

  private fastForward(r: Runner) {
    // Finish the running step right away, unless it's a required gate.
    if (r.live) {
      if (this.liveIsRequiredGate(r, r.live)) return
      this.applyInstantLive(r, r.live)
      r.live = null
    }
    while (r.i < r.steps.length - 1 || (r.i < r.steps.length && r.live === null)) {
      r.i++
      if (r.i >= r.steps.length) break
      const s = r.steps[r.i]
      if (s.t === 'gate' && s.required !== false && (s.kind === 'ui' || s.kind === 'walkTo' || s.kind === 'confirm')) {
        // Required gates and UI gates stay even when skipping. A walkTo gate that isn't required
        // moves the player straight to its target.
        if (s.required === true || s.kind === 'ui') { r.live = this.begin(s); return }
        if (s.kind === 'walkTo') { this.stage.actorPlace(this.playerActor, s.target.x, s.target.y); continue }
        continue                                      // A confirm gate that isn't required is dropped.
      }
      this.applyInstant(s)
    }
  }

  private liveIsRequiredGate(r: Runner, live: Live): boolean {
    if (live.k === 'gateUi') return true
    const s = r.steps[r.i]
    return s?.t === 'gate' && s.required === true
  }

  private applyInstantLive(r: Runner, live: Live) {
    const s = r.steps[r.i]
    switch (live.k) {
      case 'say': this.ui.dialogue = null; break
      case 'caption': this.ui.caption = null; break
      case 'gateWalk': this.stage.actorPlace(this.playerActor, live.target.x, live.target.y); this.ui.prompt = null; this.stage.playerControl(false); break
      case 'gateConfirm': this.ui.prompt = null; break
      case 'all': for (const child of live.runners) this.fastForward(child); break
      case 'poll':
        // Snap camera and fade tweens straight to their end values.
        for (const tw of this.tweens.splice(0)) { tw.set(tw.to); tw.done?.() }
        if (s?.t === 'actorMove') this.stage.actorPlace(s.actor, s.to.x, s.to.y, s.face)
        break
      default: break
    }
  }

  private applyInstant(s: Step) {
    switch (s.t) {
      case 'wait': case 'label': case 'say': case 'caption': break
      case 'letterbox': this.ui.letterbox = s.on ? 1 : 0; break
      case 'vignette': this.ui.vignette = s.to; break
      case 'fade': if (s.color) this.ui.fadeColor = s.color; this.ui.fade = s.to; break
      case 'camera': {
        const cam = this.stage.cameraGet()
        this.stage.cameraFollow(null)
        this.stage.cameraSet(s.to?.x ?? cam.x, s.to?.y ?? cam.y, s.zoom ?? cam.zoom)
        break
      }
      case 'cameraFollow': this.stage.cameraFollow(s.actor); break
      case 'actorState': this.stage.actorState(s.actor, s.state); break
      case 'actorPlace': this.stage.actorPlace(s.actor, s.at.x, s.at.y, s.face); break
      case 'actorFace': this.stage.actorFace(s.actor, s.dir); break
      case 'actorShow': this.stage.actorShow(s.actor, s.visible); break
      case 'actorMove': this.stage.actorPlace(s.actor, s.to.x, s.to.y, s.face); break
      case 'fx': break                                // One-shot particles are fine to skip.
      case 'audio': break
      case 'stage': { const poll = this.stage.call(s.call, { ...(s.data as object ?? {}), instant: true }); if (poll) while (!poll()) { /* The stage said this finishes at once. */ break } break }
      case 'gate': break                              // fastForward handles gates.
      case 'all': for (const st of s.steps) this.applyInstant(st); break
    }
  }

  private tween(from: number, to: number, ms: number, ease: Ease, set: (v: number) => void, done?: () => void) {
    if (ms <= 0) { set(to); done?.(); return }
    this.tweens.push({ from, to, ms, at: 0, ease: eases[ease], set, done })
  }
}
