// the danger zone in a practice tab, which has to tell the truth about what starting over does and keep the tab on its link
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const RAW = 'https://raw.githubusercontent.com/BLHS-CS-Club/BLHS-Island-Explorer/main/examples/03-remember/'
const was = window.location.href

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  host?.remove()
  host = null; root = null
  vi.restoreAllMocks()
  window.history.replaceState(null, '', was)
  localStorage.clear()
})

/* the practice answer is read off the address when the module loads, so the panel is loaded again for each address */
async function openDanger(search: string) {
  window.history.replaceState(null, '', `/${search}`)
  vi.resetModules()
  const { SettingsPanel } = await import('./SettingsPanel')
  const save = await import('../game/save')
  if (!save.loadSave()) save.beginAdventure()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(createElement(SettingsPanel, { onClose: () => {} })))
  click('Danger Zone')
  return save
}

function click(text: string) {
  const b = [...host!.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === text)
  if (!b) throw new Error(`no button reading "${text}" in: ${host!.textContent}`)
  act(() => { b.click() })
}

describe('the danger zone', () => {
  it('in a practice tab, says the practice starts over and the real game stays, then loads the link again', async () => {
    await openDanger(`?scene=pmap&map=atc-1&deep=1&grape=${encodeURIComponent(RAW)}`)
    const said = host!.textContent ?? ''
    expect(said).toContain('This is a practice run')
    expect(said).toContain('Your own saved game on this device stays as it is.')
    expect(said).not.toContain('This erases your saved game')

    const reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload, href: window.location.href } as Location)
    click('Start over')
    click('Yes, start over')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('outside practice, still warns that the saved game is erased', async () => {
    await openDanger('?scene=pmap&map=atc-1')
    const said = host!.textContent ?? ''
    expect(said).toContain('This erases your saved game on this device')
    expect(said).not.toContain('practice')
    click('Restart adventure')
    expect(host!.textContent).toContain('Yes, erase it all')
  })
})
