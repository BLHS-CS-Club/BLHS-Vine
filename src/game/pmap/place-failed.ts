/* the note a map leaves in the room when its map.json never arrived */

/** put the sentence in the host as plain text, because the map name comes straight off the address and anything in it has to stay words */
export function showPlaceFailed(host: HTMLElement, mapId: string): void {
  const note = document.createElement('div')
  note.style.cssText = 'color:#c9d6e2;font:14px system-ui;padding:24px'
  note.textContent = `This place did not load. Reload the page and try again. (map: ${mapId})`
  host.replaceChildren(note)
}
