/* Fetches a member's island folder and checks that it really is an island. */

/* The island.json format this game reads. Any other number gets refused, and the message says which
 * number it was. */
export const FORMAT = 1

/* One fact about the real school, plus where it came from. */
export type SourcedFact = { text: string; source: string }

/**
 * The marker for a fact nobody has published a source for. Leaving the source out is a mistake, and
 * writing this means the author checked.
 */
export const UNKNOWN = 'unknown'

/* The practical facts a student needs to actually show up on a Tuesday. Beginners tend to skip this
 * part, so every field is required and a missing one gets reported. */
export type IslandContent = {
  /** What it is. */
  what: SourcedFact
  /** When it happens. */
  when: SourcedFact
  /** How someone joins, in the words a freshman would use. */
  how_to_join: SourcedFact
  /** Four to six words, for a list. */
  blurb: string
  /** One sticker id, if this island gives one out. */
  sticker?: string
  /** Real meeting times and rooms, written as data instead of sentences. */
  meets?: { day: string; time: string; room: string; source: string }[]
}

export type GrapeManifest = {
  format: number
  /** The roster programme this island completes. This is the name `award()` uses. */
  programme: string
  /**
   * The painting it's played on. Map names and programme names are separate, so this must never be
   * the same string as `programme`.
   */
  map: string
  title: string
  season?: 'Fall' | 'Winter' | 'Spring'
  owner: string
  entry: string
  modules: string[]
  content: IslandContent
}

export type LoadedGrape = {
  /**
   * The folder name at the end of the base url. It's also the island's id in the runtime's file
   * system.
   */
  island: string
  base: string
  manifest: GrapeManifest
  /** Filename to source code, exactly what gets sent to the worker. */
  files: Record<string, string>
}

const REQUIRED = ['format', 'programme', 'map', 'title', 'owner', 'entry', 'modules', 'content'] as const
const OPTIONAL = ['season'] as const
const SEASONS = ['Fall', 'Winter', 'Spring']
const FACTS = ['what', 'when', 'how_to_join'] as const
const CONTENT_OPTIONAL = ['blurb', 'sticker', 'meets'] as const
/** A blurb is one line in a list, not a paragraph. */
const BLURB_WORDS = [4, 6] as const

/* Lower case letters, digits and single hyphens. That's the roster's own id shape, and it's safe as
 * a folder name, a url piece and a filename on every computer. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
/* What you can actually type after `import`. A dot, a space or a capital letter in a filename
 * passes every other check and then can't be imported at all. */
const STEM = /^[a-z_][a-z0-9_]*$/
/* Text a person reads has to fit on one line and be short enough for the box it goes in. */
const TEXT_MAX = 80

/* The engine writes both of these into the runtime before the island is imported, with the island's
 * folder first. */
const ENGINE_OWNED = ['vine.py', 'grape.py']

/* Module names Python already has. An island can't ship a file with one of these names. */
export const TAKEN = new Set([
  'abc', 'array', 'asyncio', 'binascii', 'builtins', 'collections', 'copy',
  'enum', 'errno', 'functools', 'gc', 'grape', 'hashlib', 'heapq', 'inspect',
  'io', 'itertools', 'json', 'math', 'os', 'random', 're', 'select', 'socket',
  'ssl', 'string', 'struct', 'sys', 'test', 'time', 'types', 'uasyncio', 'vine',
])

/* ---- is this an island ---------------------------------------------------- */

/** Every reason this isn't an island that can load. An empty list means it is one. */
export function manifestFaults(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const what = raw === null ? 'null' : Array.isArray(raw) ? 'a list' : `a ${typeof raw}`
    return [`island.json has to be an object, not ${what}`]
  }
  const m = raw as Record<string, unknown>
  const out: string[] = []

  for (const key of REQUIRED) if (!(key in m)) out.push(`\`${key}\` is missing, and it is required`)
  for (const key of Object.keys(m)) {
    if (!REQUIRED.includes(key as never) && !OPTIONAL.includes(key as never)) {
      out.push(`\`${key}\` is not a field this format has`)
    }
  }
  /* Stop here if the shape is wrong. Complaining about what's inside the fields too would bury the
   * one line that matters. */
  if (out.length) return out

  /* Check `Number.isInteger` as well as `!== FORMAT`. In JavaScript 1.0 equals 1, and a version
   * check that lets a decimal through would accept something the Python side won't. */
  if (typeof m.format !== 'number' || !Number.isInteger(m.format)) {
    out.push(`\`format\` is ${JSON.stringify(m.format)}, which is not a whole number`)
  } else if (m.format !== FORMAT) {
    out.push(`\`format\` is ${m.format}; this game speaks format ${FORMAT}`)
  }

  for (const key of ['programme', 'map'] as const) {
    if (typeof m[key] !== 'string' || !SLUG.test(m[key] as string)) {
      out.push(`\`${key}\` is ${JSON.stringify(m[key])}, which is not a slug`)
    }
  }
  /* Programme names and map names must never overlap. The roster refuses an id that's both, so an
   * island using one could never be added to it. */
  if (m.programme === m.map) {
    out.push(`\`programme\` and \`map\` are both ${JSON.stringify(m.map)}; they are `
      + 'different key spaces and the roster refuses an id that is in both')
  }

  for (const key of ['title', 'owner'] as const) {
    const v = m[key]
    if (typeof v !== 'string' || !v.trim()) {
      out.push(`\`${key}\` is empty, and somebody has to be able to read it`)
    } else if (/[\n\r\0]/.test(v)) {
      out.push(`\`${key}\` has a line break or a control character in it, and it is `
        + 'rendered as one line')
    } else if ([...v].length > TEXT_MAX) {
      /* Count code points, not UTF-16 units, because Python's len() counts code points. An emoji is
       * two units but one code point, so counting the other way would make the two checkers
       * disagree about a title. */
      out.push(`\`${key}\` is ${[...v].length} characters; keep it to ${TEXT_MAX} so it `
        + 'fits where it is drawn')
    }
  }

  if ('season' in m && !SEASONS.includes(m.season as string)) {
    out.push(`\`season\` is ${JSON.stringify(m.season)}; it has to be one of `
      + `${SEASONS.join(', ')}, or left out when the island is not seasonal`)
  }

  out.push(...moduleFaults(m))
  out.push(...contentFaults(m.content))
  return out
}

function contentFaults(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['`content` has to be an object: what, when, how_to_join and a blurb']
  }
  const c = raw as Record<string, unknown>
  const out: string[] = []

  for (const key of Object.keys(c)) {
    if (!FACTS.includes(key as never) && !CONTENT_OPTIONAL.includes(key as never)) {
      out.push(`\`content.${key}\` is not a field this format has`)
    }
  }

  for (const key of FACTS) {
    const f = c[key] as Partial<SourcedFact> | undefined
    if (!f || typeof f !== 'object') {
      out.push(`\`content.${key}\` is missing. It is {"text": "...", "source": "..."}`)
      continue
    }
    if (typeof f.text !== 'string' || !f.text.trim()) out.push(`\`content.${key}.text\` is empty`)
    /* A missing source means the author didn't think about it. "unknown" means they checked, and
     * the game can show that honestly. It can't show a missing one at all. */
    if (typeof f.source !== 'string' || !f.source.trim()) {
      out.push(`\`content.${key}.source\` is missing. Cite where the fact came from, `
        + `or put "${UNKNOWN}", which means you checked and nobody has published it`)
    }
  }

  const blurb = c.blurb
  if (typeof blurb !== 'string' || !blurb.trim()) {
    out.push('`content.blurb` is missing. Four to six words, for a list.')
  } else {
    const words = blurb.trim().split(/\s+/).length
    if (words < BLURB_WORDS[0] || words > BLURB_WORDS[1]) {
      out.push(`\`content.blurb\` is ${words} words; it goes in a list, so ${BLURB_WORDS[0]} to ${BLURB_WORDS[1]}`)
    }
  }

  if ('sticker' in c && (typeof c.sticker !== 'string' || !SLUG.test(c.sticker))) {
    out.push(`\`content.sticker\` is ${JSON.stringify(c.sticker)}, which is not a slug`)
  }

  if ('meets' in c) {
    if (!Array.isArray(c.meets)) {
      out.push('`content.meets` is a list of {day, time, room, source}')
    } else {
      c.meets.forEach((m, i) => {
        for (const k of ['day', 'time', 'room', 'source'] as const) {
          const v = (m as Record<string, unknown>)?.[k]
          if (typeof v !== 'string' || !v.trim()) {
            out.push(`\`content.meets[${i}].${k}\` is missing. A meeting time nobody `
              + 'sourced is a student standing outside the wrong room.')
          }
        }
      })
    }
  }
  return out
}

function moduleFaults(m: Record<string, unknown>): string[] {
  const out: string[] = []
  const mods = m.modules
  if (!Array.isArray(mods) || !mods.length) {
    return ['`modules` has to list every .py file the game should fetch']
  }
  if (mods.length > MAX_MODULES) {
    return [`\`modules\` lists ${mods.length} files. An island is a handful, and every `
      + `one of them is fetched at once, so the limit is ${MAX_MODULES}.`]
  }

  for (const name of mods) {
    /* The ending has to be a lower case .py, because that's what Python imports. */
    if (typeof name !== 'string' || !name.endsWith('.py')) {
      out.push(`\`modules\` has ${JSON.stringify(name)} in it, which is not a .py filename. `
        + 'The extension is lower case, because that is what you type after `import`')
      continue
    }
    if (name.includes('/') || name.includes('\\')) {
      out.push(`\`modules\` has ${name} in it; a module is a filename, and an island `
        + 'is one flat folder')
      continue
    }
    if (ENGINE_OWNED.includes(name.toLowerCase())) {
      out.push(`\`modules\` lists ${name}, which the game provides. Yours would shadow `
        + 'the real one')
      continue
    }
    const stem = name.slice(0, -3)
    if (!STEM.test(stem)) {
      out.push(`\`modules\` has ${name} in it. A module name is lower case letters, `
        + 'digits and underscores, because the file name is what you type after `import`')
      continue
    }
    if (TAKEN.has(stem)) {
      out.push(`\`modules\` lists ${name}, which is a name python already uses. Yours `
        + 'would replace the real one for everything running beside it')
    }
  }

  /* Count the names, not the entries. A list with one string and one number has no duplicate, and
   * saying it does would send the author hunting for a repeated filename that isn't there. */
  const names = mods.filter((n): n is string => typeof n === 'string')
  const lowered = new Set(names.map((n) => n.toLowerCase()))
  if (lowered.size !== names.length) out.push('`modules` lists the same file twice')

  if (typeof m.entry !== 'string' || !mods.includes(m.entry)) {
    out.push(`\`entry\` is ${JSON.stringify(m.entry)}, which is not one of the modules`)
  }
  /* A .py file in the folder that isn't listed can only be caught before the push, in
   * tools/manifest.py, because over HTTP there's no folder listing to read. */
  return out
}

/* ---- where it lives ------------------------------------------------------- */

export type GrapeRef =
  /* This app's own test islands, in public/grapes/. */
  | { at: 'origin'; island: string }
  /* Any base url, like a member running serve.py or anything else that serves files. */
  | { at: 'url'; base: string }
  /* A branch on GitHub, for when the members' repo is online. */
  | { at: 'github'; owner: string; repo: string; branch: string; path: string }

export function baseUrlOf(ref: GrapeRef): string {
  if (ref.at === 'origin') return `/grapes/${ref.island}/`
  if (ref.at === 'url') return ref.base.endsWith('/') ? ref.base : `${ref.base}/`
  const path = ref.path.replace(/^\/+|\/+$/g, '')
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.branch}/${path}/`
}

/* The island's id, which is the last folder in its base url. */
export function islandIdOf(base: string): string {
  const path = base.split(/[?#]/)[0]
  const parts = path.split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  /* A bare host has no folder in it, and a host name isn't an island name. */
  return /^[a-z][a-z0-9+.-]*:$/i.test(parts[0] ?? '') && parts.length < 3 ? '' : last
}

/* The only places an island can be fetched from: this app, your own computer, and raw GitHub. */
const ALLOWED = [/^localhost$/, /^127\.0\.0\.1$/, /^\[::1\]$/, /^raw\.githubusercontent\.com$/]

function allowedHost(base: string): boolean {
  try {
    const u = new URL(base, window.location.origin)
    if (u.origin === window.location.origin) return true
    return ALLOWED.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

/* Read the test page's url and work out which island it's asking for. */
export function parseGrapeRef(params: URLSearchParams, fallback = 'hello'): GrapeRef {
  const from = params.get('from')
  if (from) return { at: 'url', base: from }

  const gh = params.get('gh')
  if (gh) {
    const m = /^([\w.-]+)\/([\w.-]+)@([\w./-]+):([\w./-]+)$/.exec(gh)
    /* No `..` allowed in any of the four parts. Each one gets pasted into a path, and a `..` would
     * let a ref name one repository but fetch another. */
    if (m && !m.slice(1).some((part) => /(^|\/)\.\.?($|\/)/.test(part))) {
      return { at: 'github', owner: m[1], repo: m[2], branch: m[3], path: m[4] }
    }
  }

  /* Only accept names that match the pattern, instead of stripping bad characters out. Stripping
   * lets ".." through, and fetch turns "/grapes/.." into "/", which hands back the app's own
   * index.html as the island. */
  const asked = params.get('island') ?? ''
  return { at: 'origin', island: SLUG.test(asked) ? asked : fallback }
}

/* ---- getting it ----------------------------------------------------------- */

export class GrapeSourceError extends Error {}

/* How many files an island can list and how big each one can be. */
const MAX_MODULES = 24
const MAX_BYTES = 256 * 1024

/* A dropped connection doesn't mean the island is missing, and the files often answer fine a moment
 * later. So only network failures get retried. A 404, a web page where a file should be, and a file
 * that's too big all fail for good. */
const RETRIES = 2
const RETRY_PAUSE_MS = 350

class Transient extends Error {}

async function grab(url: string, ms: number): Promise<string> {
  let last: Error | null = null
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await new Promise<void>((r) => setTimeout(r, RETRY_PAUSE_MS * attempt))
    try {
      return await grabOnce(url, ms)
    } catch (e) {
      if (!(e instanceof Transient)) throw e
      last = e
      console.warn(`[island] ${url} did not answer (try ${attempt + 1} of ${RETRIES + 1}): ${e.message}`)
    }
  }
  throw new GrapeSourceError(last?.message ?? `could not reach ${url}`)
}

async function grabOnce(url: string, ms: number): Promise<string> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), ms)
  try {
    /* Reading the body happens inside the timeout too, so a stalled server can't hang the game. */
    const res = await fetch(url, { cache: 'no-store', signal: stop.signal })
    if (!res.ok) throw new GrapeSourceError(`${url} answered ${res.status}`)

    /* Catch a server that answers with a web page instead of the file that was asked for. */
    const kind = res.headers.get('content-type') ?? ''
    const body = await res.text()
    if (/text\/html/i.test(kind) || body.trimStart().startsWith('<')) {
      throw new GrapeSourceError(
        `${url} answered with a web page rather than a file. Something else is `
        + 'probably listening on that port.')
    }
    if (body.length > MAX_BYTES) {
      throw new GrapeSourceError(
        `${url} is ${Math.round(body.length / 1024)} KB. An island is a few small `
        + `files; keep each one under ${MAX_BYTES / 1024} KB.`)
    }
    return body
  } catch (e) {
    if (e instanceof GrapeSourceError) throw e
    /* A network problem, not a problem with the file. `grab` tries these again. */
    throw new Transient(
      stop.signal.aborted
        ? `${url} did not answer within ${ms} ms. Is the server still running?`
        : `could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches an island's manifest and every module it lists. If something's wrong it throws an error
 * with a readable sentence.
 */
export async function fetchGrape(ref: GrapeRef, ms = 10_000): Promise<LoadedGrape> {
  const base = baseUrlOf(ref)
  if (/[?#]/.test(base)) {
    throw new GrapeSourceError(
      `${base} carries a query or a fragment. An island is a folder, and a folder has neither.`)
  }
  if (!allowedHost(base)) {
    throw new GrapeSourceError(
      `${base} is not somewhere an island may be loaded from. That is your own `
      + 'machine, or raw.githubusercontent.com.')
  }
  const island = islandIdOf(base)
  if (!SLUG.test(island)) {
    throw new GrapeSourceError(`${base} does not end in an island folder name`)
  }

  const text = await grab(`${base}island.json`, ms)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new GrapeSourceError(`${base}island.json is not valid JSON`)
  }

  const faults = manifestFaults(raw)
  if (faults.length) {
    throw new GrapeSourceError(`${base}island.json is not loadable:\n  ${faults.join('\n  ')}`)
  }
  const manifest = raw as GrapeManifest

  /* Fetch every module at once. They're a handful of small files, and fetching them one by one is
   * slow on a school connection. */
  const sources = await Promise.all(manifest.modules.map((n) => grab(`${base}${n}`, ms)))
  const files: Record<string, string> = {}
  manifest.modules.forEach((n, i) => { files[n] = sources[i] })

  return { island, base, manifest, files }
}
