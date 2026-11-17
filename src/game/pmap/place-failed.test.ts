// the note a map that did not load leaves behind, which has to show the map name as words whatever the address carried
import { describe, expect, it } from 'vitest'
import { showPlaceFailed } from './place-failed'

describe('a place that did not load', () => {
  it('says so, naming the map', () => {
    const host = document.createElement('div')
    showPlaceFailed(host, 'atc-1')
    expect(host.textContent).toBe('This place did not load. Reload the page and try again. (map: atc-1)')
    expect(host.children).toHaveLength(1)
  })

  it('shows markup in the map name as text, so a link cannot run anything through it', () => {
    const host = document.createElement('div')
    const map = '<img src=x onerror="document.title=\'got in\'"><script>window.__got = 1</script>'
    showPlaceFailed(host, map)
    expect(host.querySelectorAll('img, script')).toHaveLength(0)
    expect(host.children).toHaveLength(1)
    expect(host.children[0].children).toHaveLength(0)
    expect(host.textContent).toContain(map)
  })

  it('replaces whatever the host held before', () => {
    const host = document.createElement('div')
    host.appendChild(document.createElement('canvas'))
    showPlaceFailed(host, 'hub')
    expect(host.querySelector('canvas')).toBeNull()
  })
})
