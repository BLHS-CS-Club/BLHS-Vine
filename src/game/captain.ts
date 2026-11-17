// Captain mode is a testing mode. Turn it on with ?captain=<key> in the address. It skips gates and
// never syncs.

const KEY = 'blhs_captain'

function pass(): string | null {
  const env = (import.meta.env?.VITE_CAPTAIN_KEY as string | undefined) ?? null
  if (env) return env
  return import.meta.env?.DEV ? 'thor' : null
}

export function initCaptain() {
  const p = pass()
  const q = new URLSearchParams(location.search).get('captain')
  if (q === null) return
  if (p !== null && q === p) localStorage.setItem(KEY, '1')
  else localStorage.removeItem(KEY)   // Any other value, like off or 0, turns it off.
}

export function isCaptain(): boolean {
  return pass() !== null && localStorage.getItem(KEY) === '1'
}
