import { createRoot } from 'react-dom/client'
import App from './App'
import { initCaptain, isCaptain } from './game/captain'
import { beginAdventure } from './game/save'
import './styles.css'
import './app/theme.css'

// No StrictMode. In dev it runs effects twice, and that races the Pixi canvas's async asset loads,
// because the engine keeps one long-lived WebGL context instead of React state that can be rebuilt.
initCaptain() // ?captain=<key> unlocks god tools. Env-gated in prod.

// ?fresh=1 wipes the run and replays the intro. It only works in dev or for a captain, because for
// a student it would be a run reset anyone could trigger. The param is removed after one use so a
// later refresh can't wipe the run again.
{
  const params = new URLSearchParams(location.search)
  if (params.has('fresh')) {
    if (import.meta.env.DEV || isCaptain()) beginAdventure()
    params.delete('fresh')
    const qs = params.toString()
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash)
  }
}

// Server sync pulls a newer save from the server if there is one, then pushes on every write. Both
// quietly do nothing until a database is set up, so the local save stays in charge. BootScene waits
// on syncReady() so Continue uses the pulled save.
import('./game/sync').then(({ startSync }) => { startSync() })

// Load the drawn UI kit that MAPVIS publishes, once. It's applied unless ?kit=0 turns it off.
import('./game/ui/kit').then(({ loadKit, applyKit, kitFaults, kitOptedIn }) => {
  loadKit().then((pieces) => {
    if (!pieces.length) return
    const refused = kitFaults(pieces).length
    const worn = kitOptedIn()
    if (worn) applyKit(pieces)
    console.log(`[kit] ${pieces.length - refused} of ${pieces.length} pieces read, ${refused} refused`
      + (worn ? ', applied' : ', not worn because ?kit=0 is set.'))
  })
})

// Load both game fonts before anything renders. Otherwise the first dialogue line fetches Deckhand
// in the middle of a cutscene, and the text stays blank while it loads, which looks like empty
// dialogue on a first visit.
for (const [family, url] of [['Harbormaster', '/fonts/Harbormaster.ttf'], ['Deckhand', '/fonts/Deckhand.ttf']] as const) {
  const face = new FontFace(family, `url(${url})`)
  face.load().then((f) => document.fonts.add(f)).catch(() => { /* The fallback font covers it. */ })
}

createRoot(document.getElementById('root')!).render(<App />)
