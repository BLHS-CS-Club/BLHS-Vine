/* an island's python can reach the worker's globals through `import js`, so every way out of the worker is taken away before any island code runs */

/** the names an island could use to send a request, open another worker, or read this game's storage */
export const SEALED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource',
  'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'indexedDB', 'caches',
] as const

/** overwrite each one on the scope and on anything up its prototype chain that also has it, since deleting the scope's own copy would leave a prototype's in reach */
export function sealNetwork(scope: object): void {
  for (const name of SEALED) {
    for (let at: object | null = scope; at && at !== Object.prototype; at = Object.getPrototypeOf(at)) {
      if (at !== scope && !Object.prototype.hasOwnProperty.call(at, name)) continue
      try {
        Object.defineProperty(at, name, { value: undefined, writable: true, configurable: true, enumerable: false })
      } catch { /* a name the engine will not let go of stays, and seal.test.ts says which */ }
    }
  }
}
