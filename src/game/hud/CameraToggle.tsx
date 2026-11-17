/* The switch in the top right corner that sets how close the camera sits to Thor. */
import { useEffect, useState } from 'react'
import { applySettings, loadSettings, onSettings, saveSettings } from '../../app/SettingsPanel'
import { announce } from '../ui/a11y'
import { track } from '../telemetry'
import './camera-toggle.css'

/* A switch that flips the camera between the wide view and the close view. */
export function CameraToggle() {
  const [close, setClose] = useState(() => loadSettings().closeCamera)
  /* The settings panel can change this setting too, so listen for changes and stay in sync. */
  useEffect(() => onSettings(() => setClose(loadSettings().closeCamera)), [])

  const flip = () => {
    const next = !close
    setClose(next)
    const now = { ...loadSettings(), closeCamera: next }
    saveSettings(now)
    applySettings(now)
    track('camera_view', { close: next })
    announce(next ? 'Close view' : 'Wide view')
  }

  return (
    <button
      type="button"
      className="ct-btn"
      /* The tour finds this button by its data-tour name on the live page. */
      data-tour="camera-view"
      role="switch"
      aria-checked={close}
      aria-label={`Camera: ${close ? 'close view' : 'wide view'}. Press to switch.`}
      title={close ? 'Close view' : 'Wide view'}
      onClick={flip}
    >
      {/* The two frames. The lit one is the view the player is in now. */}
      <span className="ct-marks" aria-hidden="true">
        <span className={`ct-mark ct-wide${close ? '' : ' ct-on'}`} />
        <span className={`ct-mark ct-close${close ? ' ct-on' : ''}`} />
      </span>
      <span className="ct-word">{close ? 'Close' : 'Wide'}</span>
    </button>
  )
}
