// @vitest-environment node
/* an island's python reaches the worker's globals through `import js`, and sealNetwork is what leaves it nothing to send a request with */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
import { SEALED, sealNetwork } from './seal'

const PKG = path.resolve('node_modules/@micropython/micropython-webassembly-pyscript')
const HERE = path.resolve('src/vine/py')
const read = (f: string) => fs.readFileSync(path.join(HERE, f), 'utf8')

describe('sealing a scope', () => {
  it('leaves every name undefined, on the scope and on its prototype', () => {
    class Proto { fetch() { return 'sent' } }
    const scope = new Proto() as unknown as Record<string, unknown>
    scope.XMLHttpRequest = function real() {}
    sealNetwork(scope)
    for (const name of SEALED) expect(scope[name]).toBeUndefined()
    /* the prototype's own copy is gone too, so deleting the scope's one brings nothing back */
    delete scope.fetch
    expect(scope.fetch).toBeUndefined()
    expect((Proto.prototype as unknown as Record<string, unknown>).fetch).toBeUndefined()
  })
})

describe('the worker', () => {
  /* a worker can only be run in a browser, so this reads its boot to check the seal sits after the wasm arrives and before the first python */
  it('seals itself between loading the runtime and running any python', () => {
    const src = read('grape.worker.ts')
    const loaded = src.indexOf('await loadMicroPython(')
    const sealed = src.indexOf('sealNetwork(self)')
    const firstPython = src.indexOf('py.runPython(DRIVER_PY)')
    expect(loaded).toBeGreaterThan(-1)
    expect(sealed).toBeGreaterThan(loaded)
    expect(firstPython).toBeGreaterThan(sealed)
  })
})

describe('an island calling js.fetch in the real runtime', () => {
  /* the test seals this process's own globals, the same way the worker seals its own, so they are put back afterwards */
  const kept = new Map(SEALED.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]))
  afterEach(() => {
    for (const [name, d] of kept) {
      if (d) Object.defineProperty(globalThis, name, d)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  })

  /* the worker's boot, one step at a time, with the seal where the worker puts it */
  const boot = async (seal: boolean) => {
    const py = await loadMicroPython({ url: path.join(PKG, 'micropython.wasm'), stdout: () => {}, stderr: () => {} })
    if (seal) sealNetwork(globalThis)
    py.FS.writeFile('vine.py', read('vine.py'))
    py.FS.writeFile('grape.py', read('grape.py'))
    py.runPython(read('driver.py'))
    return py
  }

  const ISLAND = [
    'from grape import on_start',
    'from vine import say',
    'import js',
    '',
    '@on_start',
    'def start():',
    '    js.fetch("/api/state?participantId=p_someone_else")',
    '    yield say("sent")',
  ].join('\n')

  const load = (py: Awaited<ReturnType<typeof boot>>) => {
    py.FS.mkdirTree('islands/probe')
    py.FS.writeFile('islands/probe/island.py', ISLAND)
    py.globals.set('_island', 'probe')
    py.globals.set('_entry', 'island.py')
    py.globals.set('_names', JSON.stringify(['island.py']))
    py.globals.set('_manifest', JSON.stringify({ programme: 'probe' }))
    py.runPython('_load(_island, _entry, _names, _manifest)')
  }

  it('can reach the network when nothing seals it, which is the hole', async () => {
    const py = await boot(false)
    py.runPython('import js\n_kind = type(js.fetch).__name__')
    expect(py.globals.get('_kind')).toBe('JsProxy')
  })

  it('finds nothing to call once the worker has sealed itself', async () => {
    const py = await boot(true)
    load(py)
    expect(() => py.runPython('_call("start")')).toThrow(/TypeError: 'undefined' object isn't callable/)
    /* and every other way out reads as nothing from python too */
    for (const name of SEALED) {
      py.globals.set('_name', name)
      py.runPython('import js\n_kind = str(getattr(js, _name))')
      expect(py.globals.get('_kind'), name).toBe('<undefined>')
    }
  })
})
