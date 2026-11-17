/* Tests for the sound library. An unknown name throws an error, and the table matches the files in
 * the folder. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SFX_DIR = path.resolve(process.cwd(), 'public/sfx')

/* Loads a fresh copy of the audio module for each test, plus the NotBuilt error class from the same
 * reload. */
async function fresh() {
  vi.resetModules()
  const audio = await import('./audio')
  const { NotBuilt } = await import('../vine/intents')
  return { audio, NotBuilt }
}

/* Turns sound on the same way the Sound control does. Sound stays off until someone picks a
 * setting. */
function soundOn() {
  localStorage.setItem('blhs_settings_v1', JSON.stringify({ sound: 'full', mute: false }))
}

beforeEach(() => { localStorage.clear() })

describe('a name the library does not hold', () => {
  it('refuses with NotBuilt rather than going quietly silent', async () => {
    const { audio, NotBuilt } = await fresh()
    expect(() => audio.play('trumpet')).toThrow(NotBuilt)
  })

  it('reads the real names back, so the author can see their own typo', async () => {
    const { audio } = await fresh()
    let msg = ''
    try { audio.play('cork-pip') } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('cork-pip')
    /* The error lists every sound name, not only a hint. Someone who mistyped one name probably
     * doesn't know what the other eleven are called either. */
    for (const n of audio.SFX_NAMES) expect(msg).toContain(n)
  })

  it('forgives a hyphen for an underscore and nothing else', async () => {
    const { audio, NotBuilt } = await fresh()
    /* The intro uses the cue surf-in, so this module has to accept it. */
    expect(() => audio.play('surf-in')).not.toThrow()
    expect(() => audio.play('SURF_IN')).toThrow(NotBuilt)
    expect(() => audio.play('surfin')).toThrow(NotBuilt)
  })
})

describe('a registry name with no file behind it', () => {
  it('refuses the same way a name nobody wrote down does', async () => {
    const { audio } = await fresh()
    /* A table row with no sound file behind it. The test adds it here. It isn't in the real table. */
    ;(audio.SFX as Record<string, unknown>).thunder =
      { file: null, license: 'CC0-1.0', source: 'https://example.invalid', author: 'nobody' }
    let msg = ''
    try { audio.play('thunder') } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('thunder')
    expect(msg).toMatch(/no file/i)
    delete (audio.SFX as Record<string, unknown>).thunder
  })
})

describe('the table and the folder', () => {
  it('every row points at a file that actually shipped', async () => {
    const { audio: { SFX } } = await fresh()
    const missing: string[] = []
    for (const [name, entry] of Object.entries(SFX)) {
      if (!entry.file) continue
      if (!fs.existsSync(path.join(SFX_DIR, entry.file))) missing.push(`${name} -> ${entry.file}`)
    }
    expect(missing).toEqual([])
  })

  it('every file that shipped has a row, so no byte arrives unlicensed', async () => {
    const { audio: { SFX } } = await fresh()
    const claimed = new Set(Object.values(SFX).map((e) => e.file).filter(Boolean))
    /* LICENSES.md is the license record and belongs in this folder. It's the only file here that
     * isn't audio but still isn't an orphan. */
    const orphans = fs.readdirSync(SFX_DIR)
      .filter((f) => f !== 'LICENSES.md')
      .filter((f) => !claimed.has(f))
    expect(orphans).toEqual([])
  })

  it('holds twelve names and stays inside the Chromebook budget', async () => {
    const { audio: { SFX_NAMES } } = await fresh()
    expect(SFX_NAMES).toHaveLength(12)
    const bytes = fs.readdirSync(SFX_DIR)
      .filter((f) => f !== 'LICENSES.md')
      .reduce((n, f) => n + fs.statSync(path.join(SFX_DIR, f)).size, 0)
    /* 400 KB is the limit for the whole set, which is about 162 KB now. The extra room means a
     * replacement effect doesn't have to be smaller than the one it replaces. */
    expect(bytes).toBeLessThan(400_000)
  })

  it('records a licence and a source url on every single row', async () => {
    const { audio: { SFX } } = await fresh()
    for (const [name, entry] of Object.entries(SFX)) {
      /* CC0-1.0 is the only license this folder accepts. That way no credit notice has to ship with
       * the build, and nobody can change the terms later. */
      expect(entry.license, name).toBe('CC0-1.0')
      expect(entry.source, name).toMatch(/^https:\/\//)
      expect(entry.author.length, name).toBeGreaterThan(0)
    }
  })

  it('names each file in LICENSES.md, which is what a district review reads', async () => {
    const { audio: { SFX } } = await fresh()
    const doc = fs.readFileSync(path.join(SFX_DIR, 'LICENSES.md'), 'utf8')
    for (const entry of Object.values(SFX)) {
      if (!entry.file) continue
      expect(doc, entry.file).toContain(entry.file)
    }
  })
})

describe('before the browser has let anything make a sound', () => {
  it('queues the ask instead of throwing it at the caller', async () => {
    soundOn()
    const { audio } = await fresh()
    expect(audio.isUnlocked()).toBe(false)
    expect(() => audio.play('click')).not.toThrow()
    /* The queue is there for the very first click, because that click is also what unlocks sound. */
    expect(audio.pending()).toBe(1)
  })

  it('holds a few and no more, so a flush is not a backlog going off at once', async () => {
    const { audio } = await fresh()
    for (let i = 0; i < 20; i++) audio.play('click')
    expect(audio.pending()).toBeLessThanOrEqual(4)
  })

  it('still refuses an unknown name while locked, muted or not', async () => {
    const { audio, NotBuilt } = await fresh()
    audio.setMuted(true)
    /* The name check happens before the mute check, so a typo throws for everyone and not only for
     * students with sound on. */
    expect(() => audio.play('trumpet')).toThrow(NotBuilt)
    expect(() => audio.play('click')).not.toThrow()
    expect(audio.pending()).toBe(0)
    audio.setMuted(false)
  })

  /* Locks in the rule that nothing plays until a student has picked a sound setting. */
  it('is silent on a machine that has never opened Settings', async () => {
    localStorage.removeItem('blhs_settings_v1')
    const { audio } = await fresh()
    audio.play('click')
    expect(audio.pending()).toBe(0)
  })

  it('plays once somebody has actually chosen a sound', async () => {
    localStorage.setItem('blhs_settings_v1', JSON.stringify({ sound: 'full', mute: false }))
    const { audio } = await fresh()
    audio.play('click')
    expect(audio.pending()).toBe(1)
  })

  it('reads the mute out of the settings sheet the student actually clicks', async () => {
    localStorage.setItem('blhs_settings_v1', JSON.stringify({ mute: true, textSize: 'm' }))
    const { audio } = await fresh()
    audio.play('click')
    expect(audio.pending()).toBe(0)
  })

  it('writes the mute back where the settings sheet will find it', async () => {
    localStorage.setItem('blhs_settings_v1', JSON.stringify({ textSize: 'l', skin: 'paper' }))
    const { audio } = await fresh()
    audio.setMuted(true)
    const s = JSON.parse(localStorage.getItem('blhs_settings_v1')!)
    expect(s.mute).toBe(true)
    /* It also leaves the rest of the settings alone, because this file only owns one key. */
    expect(s.textSize).toBe('l')
    expect(s.skin).toBe('paper')
  })
})

describe('preload', () => {
  it('refuses a typo the same way play does, at the scene that wrote it', async () => {
    const { audio, NotBuilt } = await fresh()
    await expect(audio.preload(['click', 'trumpet'])).rejects.toThrow(NotBuilt)
  })

  it('settles rather than rejecting when the network is the problem', async () => {
    const { audio } = await fresh()
    /* A Chromebook on district wifi that can't download an ogg keeps playing with no sound. The
     * student can't fix that, so only a mistake by the author should throw. */
    await expect(audio.preload(['click', 'page'])).resolves.toBeUndefined()
  })
})

/* A tiny fake Web Audio setup: a context that starts suspended, and a fetch that can fail. */
function stubWebAudio(opts: { fetchOk: boolean }) {
  const started: number[] = []
  const ctx = {
    state: 'suspended' as string,
    destination: {},
    resume: async () => { ctx.state = 'running' },
    createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} }),
    createBufferSource: () => ({
      buffer: null as unknown, onended: null as null | (() => void),
      connect: () => {}, disconnect: () => {},
      start: (t: number) => { started.push(t) },
    }),
    decodeAudioData: async (b: ArrayBuffer) => ({ duration: b.byteLength / 1000 }),
  }
  const g = globalThis as unknown as Record<string, unknown>
  g.AudioContext = function () { return ctx } as unknown
  g.fetch = async () => opts.fetchOk
    ? { ok: true, arrayBuffer: async () => new ArrayBuffer(64) }
    : { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }
  return { ctx, started }
}

describe('the first-gesture unlock, against a browser that behaves like Chrome', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    const g = globalThis as unknown as Record<string, unknown>
    delete g.AudioContext
    g.fetch = realFetch
  })

  it('resumes on the first pointerdown and lets the held click through', async () => {
    soundOn()
    const { ctx, started } = stubWebAudio({ fetchOk: true })
    const { audio } = await fresh()
    audio.play('click')
    expect(audio.isUnlocked()).toBe(false)
    expect(audio.pending()).toBe(1)

    window.dispatchEvent(new Event('pointerdown'))
    /* Both the resume and the decode behind the queued sound are promises, so the flush happens a
     * couple of microtasks later instead of right away. */
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.state).toBe('running')
    expect(audio.isUnlocked()).toBe(true)
    expect(audio.pending()).toBe(0)
    await new Promise((r) => setTimeout(r, 0))
    expect(started.length).toBe(1)
  })

  it('plays the second one straight through, decoding the file only once', async () => {
    soundOn()
    const { started } = stubWebAudio({ fetchOk: true })
    let fetches = 0
    const inner = globalThis.fetch
    ;(globalThis as unknown as Record<string, unknown>).fetch = (...a: unknown[]) => {
      fetches++
      return (inner as unknown as (...x: unknown[]) => unknown)(...a)
    }
    const { audio } = await fresh()
    window.dispatchEvent(new Event('pointerdown'))
    await new Promise((r) => setTimeout(r, 0))
    audio.play('click')
    await new Promise((r) => setTimeout(r, 0))
    audio.play('click')
    audio.play('click')
    await new Promise((r) => setTimeout(r, 0))
    /* Decode once and play many times. The same buffer can overlap itself, which is why each play
     * builds a new BufferSource instead of reusing one. */
    expect(fetches).toBe(1)
    expect(started.length).toBe(3)
  })

  it('swallows a fetch that failed, and does not go back for it every click', async () => {
    soundOn()
    stubWebAudio({ fetchOk: false })
    let fetches = 0
    const inner = globalThis.fetch
    ;(globalThis as unknown as Record<string, unknown>).fetch = (...a: unknown[]) => {
      fetches++
      return (inner as unknown as (...x: unknown[]) => unknown)(...a)
    }
    /* The warning is useful in dev, but in test output it looks like a failure, so it's hidden
     * here. */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { audio } = await fresh()
    window.dispatchEvent(new Event('pointerdown'))
    await new Promise((r) => setTimeout(r, 0))
    expect(() => { audio.play('click'); audio.play('click'); audio.play('click') }).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(fetches).toBe(1)
    warn.mockRestore()
  })
})

describe('the cues the intro already scripted', () => {
  it('are all in the registry, so the beach is not silent and does not throw', async () => {
    const { audio } = await fresh()
    const script = fs.readFileSync(
      path.resolve(process.cwd(), 'src/game/intro/introScript.ts'), 'utf8')
    const cues = [...script.matchAll(/t:\s*'audio',\s*cue:\s*'([^']+)'/g)].map((m) => m[1])
    /* BeachIso's stage calls play() with no try around it. If one of these cues were missing, the
     * intro would stop in the student's first minute. */
    expect(cues).toContain('surf-in')
    expect(cues).toContain('cork-pop')
    expect(cues).toContain('sail-snap')
    for (const c of cues) expect(() => audio.play(c), c).not.toThrow()
  })
})
