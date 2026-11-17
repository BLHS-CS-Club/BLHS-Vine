import { useEffect, useState, type ComponentType } from 'react'
import { SceneManager, type SceneRegistry } from './app/SceneManager'
import BootScene from './app/scenes/BootScene'
import TitleScene from './app/scenes/TitleScene'
import IntroScene from './game/intro/IntroScene'
import TeacherScene from './app/scenes/TeacherScene'
import { WorldHud } from './game/hud/WorldHud'
import { openingScene, tabIsLive } from './app/entry'

// Loads a scene's code only when it's needed. The import path has to be written out in full so Vite
// can bundle it. If the load fails, the screen stays dark sea blue and it tries again the next time
// the scene mounts.
function lazyScene(load: () => Promise<{ default: ComponentType }>) {
  return function LazyScene() {
    const [Comp, setComp] = useState<ComponentType | null>(null)
    useEffect(() => {
      let alive = true
      load().then((m) => { if (alive) setComp(() => m.default) }).catch(() => { /* Keep the dark sea showing. */ })
      return () => { alive = false }
    }, [])
    return Comp ? <Comp /> : <div style={{ position: 'absolute', inset: 0, background: '#06121a' }} />
  }
}
const PmapLazy = lazyScene(() => import('./game/pmap/PmapScene'))
const GrapeProofLazy = lazyScene(() => import('./vine/py/GrapeProof'))

// The order a student plays in: boot, then title, then the beach where the intro happens, then
// pmap. In dev, `?scene=<id>` jumps straight to a scene, and an unknown id lands on boot.
const registry: SceneRegistry = {
  boot: () => <BootScene />,
  title: () => <TitleScene />,
  beach: () => <IntroScene />,   // The intro map. Free roam once the intro is done.
  teacher: () => <TeacherScene />, // The staff desk. Never on the student title.
  pmap: () => <PmapLazy />, // Every painted map, from public/maps-painted/<?map>.
  grape: () => <GrapeProofLazy />, // A member's Python, run in a MicroPython worker.
}

export default function App() {
  /* A pasted link must not drop someone into the middle of a run. The engine keeps
   * `?scene=pmap&map=...` in the address to move between scenes, and that's the part people copy
   * and share. The rule lives in `app/entry.ts`. */
  const opened = openingScene({
    search: window.location.search,
    known: (id) => !!registry[id],
    live: tabIsLive(),
  })
  if (opened.why) {
    console.info(`[entry] ${opened.why}`)
    /* Clean up the address so the next copy is a link that works. Only the position is removed.
     * Settings like `?skin=plain` or `?arm=` were set on purpose and stay. */
    const q = opened.search ? `?${opened.search}` : ''
    window.history.replaceState(null, '', `${window.location.pathname}${q}`)
  }
  return <SceneManager initial={opened.scene} registry={registry} overlay={<WorldHud />} />
}
