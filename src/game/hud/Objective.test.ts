/* Checks that the objective bar keeps using the same drawn plaque as the beach prompt. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const css = here('./objective.css')
const tsx = here('./Objective.tsx')
const prompt = here('../cutscene/ui-kit.css')

/* The `.cs-prompt` block, which is what the panel has to match. */
const promptBlock = prompt.slice(prompt.indexOf('.cs-prompt {'), prompt.indexOf('@keyframes cs-pulse'))
/* The `.ob-panel` block, up to its first `}` at the start of a line. */
const panelBlock = css.slice(css.indexOf('.ob-panel {'), css.indexOf('@keyframes ob-drop'))

describe('the objective panel is the beach bar', () => {
  it('wears the drawn piece the beach prompt wears', () => {
    expect(panelBlock).toContain('background: var(--kit-art-plaque) center / 100% 100% no-repeat')
    expect(promptBlock).toContain('background: var(--kit-art-plaque) center / 100% 100% no-repeat')
  })

  /* Comments are allowed to mention the band, so they get stripped out before matching. */
  it('is not the parchment band any more', () => {
    const bare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
    /* The one line is still its own element with its own class. */
    expect(bare(tsx)).toMatch(/className="ob-panel"/)
    expect(bare(tsx)).toMatch(/title=\{text\}/)
    /* The bar must not use the band and the sheet under it must. This checks the class attribute
     * and not the whole file, because the file draws two surfaces and only one is the line at the
     * top of the game. */
    expect(bare(tsx)).not.toMatch(/className="ob-panel[^"]*kit-surface-band/)
    expect(bare(tsx)).toMatch(/className="ob-sheet kit-surface-band"/)
    /* The sheet gets the band and the bar doesn't. A task list uses the fancy parchment sheet the
     * dialogue box uses, but one line shown at the top of every frame shouldn't. */
    const panelOnly = bare(css).slice(0, bare(css).indexOf('.ob-sheet {'))
    expect(panelOnly).not.toContain('kit-surface-band')
  })

  it('reads at the size the beach bar reads at', () => {
    expect(panelBlock).toContain('calc(16px * var(--kit-text-scale))')
    expect(promptBlock).toContain('calc(16px * var(--kit-text-scale))')
    expect(panelBlock).toContain('color: var(--kit-wood-ink)')
    expect(panelBlock).toContain('--kit-face-body')
  })

  /* The side padding is a share of the width, so the letters stay clear of the carved ends. */
  it('clears the carved ends the way the beach bar does', () => {
    expect(panelBlock).toContain('padding: 8px max(30px, 7.5%) 13px')
    expect(promptBlock).toContain('padding: 8px max(30px, 7.5%) 13px')
  })

  /* Narrow, one line, top center and above the bars. A restyle could easily drop any of these four,
   * so they're checked here. */
  it('stays narrow, single line and above the letterbox', () => {
    expect(panelBlock).toContain('white-space: nowrap')
    expect(panelBlock).toContain('text-overflow: ellipsis')
    expect(panelBlock).toMatch(/max-width: min\(58vw, 640px\)/)
    expect(css).toContain('z-index: 71')
    expect(css).toContain('justify-content: center')
    expect(css).toContain("html[data-movie='1'] .ob-wrap")
  })

  /* How the panel picks its line must not change when it's restyled. */
  it('still says the island line, then the scene, then the year', () => {
    expect(tsx).toContain('said ?? world ?? objectiveLine(o, map)')
  })
})
