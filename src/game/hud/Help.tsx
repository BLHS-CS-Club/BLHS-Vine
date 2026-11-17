// The question mark button in the corner and the help card it opens. The card shows the controls,
// explains the corner buttons and offers ways out.
import { useEffect, useState } from 'react'
import { announce, usePanel } from '../ui/a11y'
import { Glyph, Plank } from '../ui/controls'
import { track } from '../telemetry'
import { requestUi, uiListenerCount } from '../ui-bus'
import { holdWorld } from '../world-bus'
import { useNavMaybe } from '../../app/SceneManager'
import { applySettings, loadSettings, saveSettings } from '../../app/SettingsPanel'
import './help.css'

/** The help card. It opens from the corner button and from the pause sheet. */
export function HelpCard({ onClose }: { onClose: () => void }) {
  const panel = usePanel({ onClose, label: 'How to play' })
  const nav = useNavMaybe()
  /* Whether a Hud is mounted to open panels. It's checked once, when the card opens. */
  const [hudUp, setHudUp] = useState(false)
  const [clickWalk, setClickWalk] = useState(() => loadSettings().clickToMove)
  useEffect(() => { setHudUp(uiListenerCount() > 0) }, [])
  useEffect(() => { track('help_opened') }, [])
  /* The world stays paused for as long as the card is open. */
  useEffect(() => holdWorld('help'), [])
  return (
    <div className="hp-veil" onClick={onClose}>
      <div
        {...panel}
        className="hp-card kit-surface-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* A small button on the help card that replays the tutorial. */}
        {hudUp && (
          <button
            type="button"
            className="hp-replay"
            onClick={() => { track('tour_replayed'); onClose(); requestUi('tour') }}
          >
            <Glyph piece="icon_set" face="arrow" size={13} className="hp-replay-mark" />
            <span className="hp-replay-word">Replay tutorial</span>
          </button>
        )}

        <h2 className="hp-title">How to play</h2>
        <p className="hp-paused">The game is paused while this card is open.</p>

        {/* The four controls, each with a picture, in the order a student first uses them. */}
        <ul className="hp-keys">
          <li className="hp-key">
            <span className="hp-mark hp-arrows" aria-hidden="true">
              <Glyph piece="icon_set" face="arrow" size={20} className="hp-ar hp-ar-up" />
              <Glyph piece="icon_set" face="arrow" size={20} className="hp-ar hp-ar-left" />
              <Glyph piece="icon_set" face="arrow" size={20} className="hp-ar hp-ar-down" />
              <Glyph piece="icon_set" face="arrow" size={20} className="hp-ar hp-ar-right" />
            </span>
            <span className="hp-says">Arrow keys walk</span>
          </li>
          <li className="hp-key">
            <span className="hp-mark" aria-hidden="true"><span className="kit-plank-key hp-cap">E</span></span>
            <span className="hp-says">E opens what you are standing at</span>
          </li>
          <li className="hp-key">
            <span className="hp-mark" aria-hidden="true">
              <Glyph piece="pointer" face="hand" size={26} />
            </span>
            <span className="hp-says">Or click it</span>
          </li>
          <li className="hp-key">
            <span className="hp-mark" aria-hidden="true"><span className="kit-plank-key hp-cap">Esc</span></span>
            {/* Say what Escape actually does. A graded activity ignores Escape on purpose. */}
            <span className="hp-says">Esc closes a panel, or pauses the game</span>
          </li>
        </ul>

        {/* Click to move is a setting the player turns on, not something that's always on. */}
        <button
          type="button"
          className="hp-toggle"
          role="switch"
          aria-checked={clickWalk}
          onClick={() => {
            const next = !clickWalk
            setClickWalk(next)
            const now = { ...loadSettings(), clickToMove: next }
            saveSettings(now)
            applySettings(now)
            track('click_to_move', { on: next })
            announce(next ? 'Clicking the ground walks you there.' : 'Clicking the ground no longer walks you.')
          }}
        >
          <span className={`hp-toggle-box${clickWalk ? ' hp-toggle-on' : ''}`} aria-hidden="true">
            {clickWalk && <Glyph piece="icon_set" face="tick" size={13} />}
          </span>
          <span className="hp-toggle-words">Click the ground to walk there</span>
        </button>

        {/* The answer for a player who doesn't know what to do. It gets its own line instead of
          * sitting in the list of keys. */}
        <p className="hp-task">The line above your head is your task.</p>

        {/* What the corner buttons are, using the same names the buttons show. */}
        <ul className="hp-corner">
          <li><b>Map</b> the islands you have found</li>
          <li><b>Guide</b> what the school offers, and what you have collected</li>
          <li><b>My Year</b> pick your classes and activities</li>
        </ul>

        {/* The same buttons the pause sheet has, with the same words. Buttons that need a Hud are
          * left out when there isn't one. */}
        <div className="hp-doors">
          <Plank className="hp-door hp-door-back" keyCap="Esc" onClick={onClose}>Back to the game</Plank>
          {hudUp && <Plank className="hp-door" onClick={() => { onClose(); requestUi('planner') }}>My Year</Plank>}
          {hudUp && <Plank className="hp-door" onClick={() => { onClose(); requestUi('handbook') }}>Guide</Plank>}
          {/* This is the only button in the game that opens the trophy wall. */}
          {hudUp && <Plank className="hp-door" onClick={() => { onClose(); requestUi('wall') }}>Trophy wall</Plank>}
          {hudUp && <Plank className="hp-door" onClick={() => { onClose(); requestUi('settings') }}>Settings</Plank>}
          {nav && <Plank className="hp-door" onClick={() => { onClose(); nav.go('title') }}>Save and leave</Plank>}
        </div>
      </div>
    </div>
  )
}

/* The help button. It has its own corner slot so it shows up even before the Hud does. */
export function HelpButton() {
  const [open, setOpen] = useState(false)
  /* It sits in a fixed corner, so it doesn't measure or watch anything. */
  return (
    <>
      <button
        className="hud-plaque hp-btn"
        data-tour="help"
        aria-label="How to play"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className="hud-plaque-word hp-q">?</span>
      </button>
      {open && <HelpCard onClose={() => setOpen(false)} />}
    </>
  )
}
