// a practice link plays somebody's island on a run kept in memory, and every other address is left exactly as it was
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPracticeLink, practiceMapOf, shortReason } from './practice'

const ORIGIN = 'https://blhs-island-explorer.vercel.app'
const RAW = 'https://raw.githubusercontent.com/BLHS-CS-Club/BLHS-Island-Explorer/main/examples/03-remember/'
const q = (grape: string, rest = 'scene=pmap&map=atc-1') => `?${rest}&grape=${encodeURIComponent(grape)}`

describe('is this tab a practice link', () => {
  it('is, when the island comes from github', () => {
    expect(isPracticeLink(q(RAW), ORIGIN)).toBe(true)
  })

  it('is, for any other origin, a different port on the same machine included', () => {
    expect(isPracticeLink(q('http://localhost:8000/my-island/'), 'http://localhost:5173')).toBe(true)
    expect(isPracticeLink(q('//raw.githubusercontent.com/o/r/main/x/'), ORIGIN)).toBe(true)
  })

  it('is not, when the island is served from this game itself', () => {
    expect(isPracticeLink(q(`${ORIGIN}/grapes/atc/`), ORIGIN)).toBe(false)
  })

  it('is not, for a relative island, which is always this game', () => {
    expect(isPracticeLink(q('/grapes/atc/'), ORIGIN)).toBe(false)
    expect(isPracticeLink(q('grapes/atc/'), ORIGIN)).toBe(false)
  })

  it('is not, when the grape cannot be read as an address', () => {
    expect(isPracticeLink(q('http://[::1'), ORIGIN)).toBe(false)
    expect(isPracticeLink(q('https://'), ORIGIN)).toBe(false)
  })

  it('is not, with no grape or an empty one', () => {
    expect(isPracticeLink('?scene=pmap&map=atc-1', ORIGIN)).toBe(false)
    expect(isPracticeLink('', ORIGIN)).toBe(false)
    expect(isPracticeLink('?grape=', ORIGIN)).toBe(false)
  })
})

describe('which map the practice island belongs to', () => {
  it('is the map the link opened', () => {
    expect(practiceMapOf(q(RAW))).toBe('atc-1')
  })

  it('is the remembered one once a door has moved the map on', () => {
    expect(practiceMapOf(`${q(RAW, 'scene=pmap&map=hub')}&grape_map=atc-1`)).toBe('atc-1')
  })

  it('is nobody, when the address names no map', () => {
    expect(practiceMapOf(`?grape=${encodeURIComponent(RAW)}`)).toBeNull()
  })
})

/* the reason goes in the dialogue box, which a raw github address on its own nearly fills */
describe('why a practice island did not load, as the room says it', () => {
  const missing = 'https://raw.githubusercontent.com/o/r/no-such-branch/x/'

  it('names the file and what it answered, without the address in front', () => {
    expect(shortReason(`${missing}island.json answered 404`, missing)).toBe('island.json answered 404')
    expect(shortReason(`could not reach ${missing}island.json: Failed to fetch`, missing))
      .toBe('could not reach island.json: Failed to fetch')
  })

  it('shortens every file in a list of faults', () => {
    expect(shortReason(`${missing}island.json is not loadable:\n  \`format\` is missing`, missing))
      .toBe('island.json is not loadable:\n  `format` is missing')
  })

  it('keeps the address when the address is the thing that was refused', () => {
    const refused = 'https://example.com/x/ is not somewhere an island may be loaded from.'
    expect(shortReason(refused, 'https://example.com/x/')).toBe(refused)
  })

  it('leaves a reason that names no file alone', () => {
    expect(shortReason('NameError: name \'x\' is not defined', missing)).toBe('NameError: name \'x\' is not defined')
    expect(shortReason('anything', '')).toBe('anything')
  })
})

/* the answer is read off the page's own address once, when the module loads */
describe('deciding it once, from the page', () => {
  const was = window.location.href
  afterEach(() => { window.history.replaceState(null, '', was) })

  const load = async (search: string) => {
    window.history.replaceState(null, '', `/${search}`)
    vi.resetModules()
    return await import('./practice')
  }

  it('turns on for a link to github', async () => {
    const p = await load(q(RAW))
    expect(p.PRACTICE).toBe(true)
    expect(p.PRACTICE_MAP).toBe('atc-1')
  })

  it('stays off for this game\'s own island', async () => {
    const p = await load(q('/grapes/atc/'))
    expect(p.PRACTICE).toBe(false)
    expect(p.PRACTICE_MAP).toBeNull()
  })

  it('stays off with no grape at all', async () => {
    const p = await load('?scene=pmap&map=atc-1')
    expect(p.PRACTICE).toBe(false)
  })

  it('does not change its mind when the address changes later', async () => {
    const p = await load(q(RAW))
    window.history.replaceState(null, '', '/?scene=pmap&map=hub')
    expect(p.PRACTICE).toBe(true)
  })
})
