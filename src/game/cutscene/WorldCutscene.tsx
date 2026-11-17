/* Shows the cutscene overlay for whichever scene has posted a cutscene, and shows nothing when none
 * has. */
import { useEffect, useState } from 'react'
import { CutsceneOverlay } from './CutsceneOverlay'
import { liveRuntime, onRuntime } from './stage-bus'
import type { CutsceneRuntime } from './runtime'

export function WorldCutscene() {
  const [rt, setRt] = useState<CutsceneRuntime | null>(liveRuntime)
  useEffect(() => onRuntime(setRt), [])
  if (!rt) return null
  return <CutsceneOverlay rt={rt} />
}
