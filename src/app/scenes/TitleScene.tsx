import { useEffect, useState } from 'react'
import { useNav } from '../SceneManager'
import { beginAdventure, endYear, loadSave } from '../../game/save'
import { track } from '../../game/telemetry'
import { GearButton, SettingsPanel, applySettings, loadSettings } from '../SettingsPanel'
import { HOME_TARGET, enterMap } from '../../game/pmap/route'
import { Plank } from '../../game/ui/controls'
import { Yearbook } from '../../game/run/Yearbook'
import { nextYear, runLine, sessionOver } from '../../game/run/year'
import { claimPlaying, otherTabPlaying } from '../entry'
import './boot-title.css'

// The title screen: the cove in the background, the game's name on the signboard, and a button that
// depends on the save.

/* The plank, plate and gull on the title are only for looks. None of them decides where the button
 * goes. */

export default function TitleScene() {
  const nav = useNav()
  const save = loadSave()
  /* Whether the run is over. Every other screen knows this once the yearbook page turns, so the
   * title has to check too. */
  const over = sessionOver(save)
  /* The next year, if the game has one written and the current year is closed. It's null at the
   * very end, where only the yearbook is left. */
  const ahead = nextYear(save)

  /* Whether the game is open in another tab. Both tabs write the whole save, so the older copy can
   * land on top. */
  const [busyElsewhere, setBusyElsewhere] = useState(() => otherTabPlaying())
  useEffect(() => {
    const t = window.setInterval(() => setBusyElsewhere(otherTabPlaying()), 1500)
    return () => window.clearInterval(t)
  }, [])
  const [book, setBook] = useState(false)
  const openBook = () => { track('yearbook_opened', { via: 'title' }); setBook(true) }
  const [gullRight, setGullRight] = useState(false)
  const [gullHop, setGullHop] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => { track('title_shown', { hasSave: !!save }); applySettings(loadSettings()) }, [save])

  /* Continue picks up where the run is: the beach if the intro isn't done, the Maw once it is. */
  const resume = (introDone: boolean) => {
    if (introDone) {
      /* enterMap writes the address and navigates in one step. Don't write the address without
       * navigating. */
      enterMap(nav.go, HOME_TARGET, { kind: 'scene', image: '/art/ui/loading-islands.png', title: 'THE BLHS ISLANDS', holdMs: 2200 })
    } else nav.go('beach', { kind: 'scene', title: 'THE FAR SHORE', holdMs: 2200 })
  }
  // With no save the button says Begin Adventure, and with a save it says Continue. Starting over
  // lives in Settings, under Danger Zone, Restart. It never gets its own button on the title.
  /* Starting the next year keeps the same run going. `endYear` bumps the year, clears the sheet and
   * gives back three season tokens. Everything after that reads the year and opens on its own, and
   * nothing about the finished year is erased. */
  const openNextYear = () => {
    track('next_year_clicked', { from: save?.year ?? 1 })
    endYear()
    resume(true)
  }

  const go = () => {
    if (busyElsewhere) {
      /* Taking over the run. The other tab gives up on its next renewal, and the save this tab is
       * about to read is the one that tab has been writing. */
      track('takeover_clicked')
      claimPlaying()
    }
    if (save) { track('continue_clicked'); resume(save.introDone) }
    else { track('begin_clicked'); beginAdventure(); resume(false) }
  }

  const flapGull = () => { setGullHop((h) => h + 1); setGullRight((g) => !g) }

  return (
    <div className="ti-root">
      <div className="ti-backdrop" />
      <div className="ti-veil" />

      <div className="ti-stack">
        {save && <div className="ti-welcome">Welcome back, {save.handle || 'Panther'}</div>}

        <div className="ti-wordmark">
          <div className="ti-signpaper" />
          <img className="ti-sign pix" src="/art/ui/title-signboard.png" alt="" draggable={false} />
          <div className="ti-wordtext">
            <span className="ti-line1">BLHS</span>
            <span className="ti-line2">ISLAND EXPLORER</span>
          </div>
          {/* The gull is a real button, so the keyboard can flap it as well as the mouse. */}
          <button
            key={gullHop}
            type="button"
            className={`ti-gull ${gullRight ? 'ti-gull-right' : ''}`}
            aria-label="Send the gull to the other end of the sign"
            onClick={flapGull}
          >
            <img className="ti-gull-pic pix" src="/art/intro/props/gull.png" alt="" draggable={false} />
          </button>
        </div>

        {/* Shown above the plank so the player reads it before pressing. */}
        {busyElsewhere && (
          <p className="ti-elsewhere" role="status">
            This adventure is open in another tab. Playing here will take it over.
          </p>
        )}

        <div className="ti-actions">
          {/* One plank with two lines, with the year and season written on the wood. */}
          {/* After a finished year the player can start the next one. Year two is written in
            * `beats/y2.ts`, and `endYear()` gives out a fresh sheet and three season tokens. The
            * yearbook comes second because it's what a student turns in, and it must never be
            * hidden behind the next year. */}
          {over ? (
            <>
              {ahead !== null && (
                <Plank
                  size="lg"
                  className="ti-plank"
                  sub={`Year ${save?.year ?? 1} is done`}
                  onClick={openNextYear}
                >
                  {`Start year ${ahead}`}
                </Plank>
              )}
              <Plank
                size={ahead === null ? 'lg' : 'md'}
                className={`ti-plank${ahead === null ? '' : ' ti-plank-second'}`}
                sub={ahead === null ? `Year ${save?.year ?? 1} is done` : undefined}
                onClick={openBook}
              >
                Your yearbook
              </Plank>
            </>
          ) : (
            <Plank
              size="lg"
              className="ti-plank"
              sub={busyElsewhere ? 'Open in another tab' : save ? runLine(save) : undefined}
              onClick={go}
            >
              {busyElsewhere ? 'Play here instead' : save ? 'Continue' : 'Begin Adventure'}
            </Plank>
          )}
        </div>
      </div>

      <div className="ti-credit">made by the BLHS CS Club</div>
      {/* The yearbook opens over the title. It's the only panel that opens outside a world scene,
        * because it's what a student turns in and the screen the run ends on has to be able to show
        * it. */}
      {book && <Yearbook onClose={() => setBook(false)} />}
      <GearButton onClick={() => setSettingsOpen(true)} />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
