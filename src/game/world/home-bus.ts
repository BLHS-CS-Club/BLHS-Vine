/* Head back: when an island is finished, the student can ask to be taken to its dock. This file
 * passes that request from the UI to the scene as a window event. */

const EVENT = 'blhs:head-back'

export type HomeAnswer =
  /** The player is on the way to the dock. */
  | { ok: true }
  /** The player isn't going, and `why` is what the student is told. */
  | { ok: false; why: string }

type HomeDetail = { answer: (a: HomeAnswer) => void }

let listening = 0

/** How many scenes can take the player to a dock right now. */
export const homeListenerCount = (): number => listening

/** Asks the scene to put the player at this island's dock. Resolves once the scene has decided. */
export function requestHeadBack(): Promise<HomeAnswer> {
  return new Promise<HomeAnswer>((resolve) => {
    let settled = false
    const answer = (a: HomeAnswer) => {
      if (settled) return
      settled = true
      resolve(a)
    }
    window.dispatchEvent(new CustomEvent<HomeDetail>(EVENT, { detail: { answer } }))
    /* Listeners answer during the dispatch, which runs right away. If one already answered, this
     * refusal is ignored. If nobody did, it becomes the answer. */
    answer({ ok: false, why: 'There is no way down to the water from here.' })
  })
}

export function onHeadBack(fn: (answer: (a: HomeAnswer) => void) => void): () => void {
  const h = (e: Event) => {
    const d = (e as CustomEvent<HomeDetail>).detail
    if (d) fn(d.answer)
  }
  window.addEventListener(EVENT, h)
  listening++
  return () => {
    window.removeEventListener(EVENT, h)
    listening = Math.max(0, listening - 1)
  }
}
