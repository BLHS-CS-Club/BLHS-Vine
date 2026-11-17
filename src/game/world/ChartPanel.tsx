/* The chart on its own screen, so it isn't only the second tab of the Handbook. There's one `<Chart
 * />`, and three ways to open it: this panel, the Map plaque in the corner, and pressing E at a
 * dock. */
import { useEffect, useState } from 'react'
import { usePanel } from '../ui/a11y'
import { Glyph, Plank } from '../ui/controls'
import { track } from '../telemetry'
import { holdWorld } from '../world-bus'
import { Chart } from './Chart'
import './chart-panel.css'

export function ChartPanel({ onClose }: { onClose: () => void }) {
  const panel = usePanel({ onClose, label: 'The chart. Where you sail.' })
  useEffect(() => { track('chart_opened') }, [])
  /* Pause the world while the chart is open, like every other panel does. Otherwise the player
   * could keep walking under the chart without seeing where they're going. */
  useEffect(() => holdWorld('chart'), [])
  return (
    <div className="cp-veil" onClick={onClose}>
      <div {...panel} className="cp-card kit-surface-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cp-head">
          <h2 className="cp-title">The Chart</h2>
          <p className="cp-sub">Where you sail. Press an island to go there.</p>
          <Plank size="sm" className="cp-close" onClick={onClose}>Close</Plank>
        </div>
        {/* Sailing closes the chart, because the sailing happens behind the panel. */}
        {/* No second heading. The card above already says what this is, and "The Chart" followed by
          * "Chart" would repeat itself. */}
        <Chart onSailing={onClose} heading={false} />
      </div>
    </div>
  )
}

/* The chart button sits on the help button's plate, right above it. Like the question mark, it's
 * outside the Hud's gate, so the player can open the chart before having a run. */
export function ChartButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="hud-plaque cp-btn"
        data-tour="chart"
        aria-label="The chart. Where you sail."
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Glyph piece="icon_set" face="compass" size={20} className="hud-plaque-mark" />
        <span className="hud-plaque-word cp-btn-word">Chart</span>
      </button>
      {open && <ChartPanel onClose={() => setOpen(false)} />}
    </>
  )
}
