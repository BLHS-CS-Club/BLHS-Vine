// The worker runs a member's Python off the main thread, so a crash in it can't take the engine
// down.
import { loadMicroPython, type MicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
/* The wasm file goes through the bundler, so the runtime gets pointed at its real built URL. */
import wasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url'
import VINE_PY from './vine.py?raw'
import GRAPE_PY from './grape.py?raw'
import DRIVER_PY from './driver.py?raw'
import { PROTOCOL, type FromWorker, type PyStep, type ToWorker } from './protocol'

/* tsconfig's lib is DOM, not WebWorker, and adding WebWorker clashes with DOM in every file in src.
 * One cast on this line is the cheaper fix. */
const post = (m: FromWorker) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m)

let mp: MicroPython | null = null

/* Start MicroPython once for this worker and reuse it for every call and resume. */
async function boot(): Promise<MicroPython> {
  if (mp) return mp
  const py = await loadMicroPython({
    url: wasmUrl,
    stdout: (text) => post({ t: 'print', text }),
    stderr: (text) => post({ t: 'print', text }),
  })
  /* The two modules members use are written as real files, so importing them works like any normal
   * import. */
  py.FS.writeFile('vine.py', VINE_PY)
  py.FS.writeFile('grape.py', GRAPE_PY)
  py.runPython(DRIVER_PY)
  mp = py
  return py
}

/* Run one call and hand back whatever the pump left in `_step`, or report a crash. */
function step(py: MicroPython, call: string): PyStep | null {
  try {
    py.runPython(call)
  } catch (e) {
    const traceback = String((e as Error)?.message ?? e).trim()
    /* The last line of a traceback is the sentence a person can act on. The rest, the file and
     * line, stays in the console. */
    const error = traceback.split('\n').filter(Boolean).pop()?.trim() ?? 'the island stopped'
    post({ t: 'crash', error, traceback })
    return null
  }
  return JSON.parse(py.globals.get('_step') as string) as PyStep
}

self.addEventListener('message', (ev: MessageEvent) => { void handle(ev.data as ToWorker) })

/* Exactly one message in and one message out. The engine never sends a resume until an intent has
 * come back, so messages can't overlap and there's no need for SharedArrayBuffer. */
async function handle(msg: ToWorker) {
  /* Everything is inside this try, so nothing can throw without a message going back. */
  try {
    if (msg.t === 'load' && msg.v !== PROTOCOL) {
      /* Both halves are built from the same repo, so a protocol mismatch means a stale cached file. */
      post({
        t: 'crash',
        error: `this worker speaks protocol ${PROTOCOL} and the page speaks ${msg.v}. Reload the page.`,
        traceback: `protocol ${msg.v} !== ${PROTOCOL}`,
      })
      return
    }

    const py = await boot()

    if (msg.t === 'load') {
      const dir = `islands/${msg.island}`
      /* Use mkdirTree, not mkdir. mkdir throws when the folder already exists, which happens on
       * every load after the first, and writeFile never creates the parent folder. */
      py.FS.mkdirTree(dir)
      for (const [name, source] of Object.entries(msg.files)) {
        py.FS.writeFile(`${dir}/${name}`, source)
      }
      py.globals.set('_island', msg.island)
      py.globals.set('_entry', msg.entry)
      py.globals.set('_names', JSON.stringify(Object.keys(msg.files)))
      py.globals.set('_manifest', JSON.stringify(msg.manifest))
      /* The call itself never changes. Everything that varies goes in through globals. */
      send(step(py, '_load(_island, _entry, _names, _manifest)'))
      return
    }

    if (msg.t === 'call') {
      py.globals.set('_handler', msg.handler)
      send(step(py, '_call(_handler)'))
      return
    }

    py.globals.set('_reply', JSON.stringify(msg.result))
    send(step(py, '_resume(_reply)'))
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    post({ t: 'crash', error: mp ? why : `micropython did not start: ${why}`, traceback: why })
  }
}

/* The version number gets added here instead of in Python, so only one file knows it. */
function send(s: PyStep | null) {
  if (!s) return
  post(s.t === 'ready' ? { t: 'ready', v: PROTOCOL, handlers: s.handlers } : s)
}
