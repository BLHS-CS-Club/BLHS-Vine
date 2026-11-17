/* The one control the student has during a sea crossing: press Esc, or click the button, to skip. */
import { useEffect, useState } from 'react'
import { cancelVoyage, onVoyage, skipVoyage, voyageSkipped, type VoyagePlan } from './travel'
import { announce } from '../ui/a11y'
import { track } from '../telemetry'
import './skip-voyage.css'

/* The button sits top left, away from the cutscene skip in the top right, because they're different
 * offers and never show up together. It appears on the first frame of the journey, not only on the
 * crossing leg. It's a button as well as the Escape key because school laptops are mostly used with
 * a trackpad. */
export function SkipVoyage() {
  const [plan, setPlan] = useState<VoyagePlan | null>(null)
  const [gone, setGone] = useState(false)

  /* A new plan, or the plan being called off, resets the button so it does not stay grayed out on
   * its last word. */
  useEffect(() => onVoyage((p) => { setPlan(p); setGone(p ? voyageSkipped() : false) }), [])

  useEffect(() => {
    /* Only listen for Escape while the button is showing. Hooks run before the early return below,
     * so without this check Escape on the landing leg could quietly set the skip and wipe out the
     * arrival. */
    if (!plan || gone || plan.leg === 'landing') return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return
      /* Catch the key on the way down and stop it there. The HUD pauses the game on Escape, and
       * without this a skipped crossing would also put the pause screen over the arrival. During a
       * voyage, Escape only means skip. */
      e.preventDefault()
      e.stopPropagation()
      take()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  })

  /* The leg decides what Escape does. Before the ship moves, it drops the plan and leaves the
   * player on the dock with the movie bars gone. After the ship moves, it skips to the far dock. It
   * stays one control because only the label on the button changes. */
  const waiting = plan?.leg === 'to-dock' || plan?.leg === 'boarding'

  const take = () => {
    if (gone) return
    if (waiting) {
      setGone(true)
      track('voyage_called_off', { to: plan?.to ?? null, leg: plan?.leg ?? null })
      announce('Not going just yet. Press E at your ship to open the chart.')
      cancelVoyage()
      return
    }
    if (voyageSkipped()) return
    setGone(true)
    track('voyage_skipped', { to: plan?.to ?? null, leg: plan?.leg ?? null })
    announce('Skipping ahead. You will arrive at the dock.')
    skipVoyage()
  }

  /* Hide the button once the ship is coming in. On the landing leg the crossing is already over, so
   * a press could only wipe out the arrival. The key listener goes away with the button too. */
  if (!plan || plan.leg === 'landing') return null
  return (
    <button type="button" className="sv-skip" onClick={take} disabled={gone}>
      {gone ? (waiting ? 'Staying' : 'Arriving') : waiting ? 'Esc: not just now' : 'Esc: skip ahead'}
    </button>
  )
}
