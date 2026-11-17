/* The two black bars that frame a part of the game the player watches instead of plays. */
import { useEffect, useState } from 'react'
import { onCinema } from './cinema'
import { prefersReducedMotion } from '../ui/motion'
import './cinema.css'

export function MovieBars() {
  const [on, setOn] = useState(false)
  /* Stays mounted until the slide-out animation finishes, so the bars slide away instead of
   * vanishing. */
  const [shown, setShown] = useState(false)

  useEffect(() => onCinema(setOn), [])

  useEffect(() => {
    if (on) { setShown(true); return }
    if (!shown) return
    const ms = prefersReducedMotion() ? 60 : 450
    const t = window.setTimeout(() => setShown(false), ms)
    return () => window.clearTimeout(t)
  }, [on, shown])

  if (!shown) return null
  return (
    <div className="cin-root" data-on={on ? '1' : '0'} aria-hidden>
      <div className="cin-bar cin-top" />
      <div className="cin-bar cin-bottom" />
    </div>
  )
}
