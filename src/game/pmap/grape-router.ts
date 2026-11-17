/* Works out who responds when the player uses an anchor: a door first, then the island's own Python
 * handler. */

export type AnchorOwner = {
  /* The key to pass to `GrapeSession.call`, already in the format the worker expects. */
  handler: string
}

/** Who responds to this anchor name. It's either the loaded island or nobody. */
export function ownerOf(name: string, handlers: readonly string[] = []): AnchorOwner | null {
  const handler = `talk:${name}`
  return handlers.includes(handler) ? { handler } : null
}

/**
 * The text the player sees when standing near an anchor. It's whatever the map maker typed, or the
 * anchor's name if they left it blank.
 */
export const labelFor = (label: string | undefined, name: string): string => label || name
