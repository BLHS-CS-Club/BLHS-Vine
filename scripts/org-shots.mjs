/* the pictures on the organisation front page, one per project:
 *
 *   node scripts/org-shots.mjs --out=C:/Users/ashcy/atc-profile/profile/screenshots
 *
 * The game's title screen is copied from the islands repo rather than taken again here, so the
 * front page and that repo's own README can never end up showing two different title screens.
 * The other two are photographed off the live sites at 1366x768. Nothing is a mock and nothing
 * comes out of an editor, and a run that cannot reach a moment fails rather than writing a half
 * picture, because a front page carrying a shot of a loading screen reads as a finished project.
 *
 * `--game` additionally takes the two in-game shots, the hub at the walking zoom and the Maw on
 * the first line of its opening. The front page does not use them, but finding the save flags
 * and the standing spot again is an afternoon, so the way to get them stays written down here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { boot, STAMPED, LIVE } from './play-harness.mjs'

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const GAME = process.argv.includes('--game')
const base = (arg('base', LIVE)).replace(/\/$/, '')
const out = path.resolve(arg('out', 'reference/_archive/build-shots/org-shots'))
fs.mkdirSync(out, { recursive: true })

const VIEW = { width: 1366, height: 768 }
const readings = (page) => page.evaluate(() => ({
  map: window.__pmap?.map ?? null,
  z: Number((window.__pmap?.camZ ?? 0).toFixed(2)),
  at: window.__pmap ? `${Math.round(window.__pmap.x)},${Math.round(window.__pmap.y)}` : null,
  line: document.querySelector('.cs-dialogue-text')?.textContent?.trim() ?? '',
}))

/* the browser's own log goes to this repo's shot tree, never beside the two pictures: `out`
 * is a directory somebody publishes, and a run log committed next to a front page is litter */
const logDir = path.resolve('reference/_archive/build-shots/org-shots')

const open = async (name, save, url) => {
  const h = await boot(name, { save, dir: path.join(logDir, name), view: VIEW })
  await h.go(url)
  return h
}

/* --------------------------------------------------- the game's title screen --
 * Copied, not re-shot. The islands repo's README shows this exact file, and Ash asked for the
 * same picture in both places, so the front page takes the bytes rather than a lookalike. The
 * blob hash is checked against what GitHub reports, because a truncated download still writes
 * a file and a half written PNG on a front page is worse than no front page.
 */
const TITLE_IN_ISLANDS = 'docs/screenshots/title.png'
const ISLANDS = 'BLHS-CS-Club/BLHS-Island-Explorer'
{
  const meta = await fetch(`https://api.github.com/repos/${ISLANDS}/contents/${TITLE_IN_ISLANDS}`)
  if (!meta.ok) throw new Error(`${ISLANDS} would not say where its title screen is: ${meta.status}`)
  const { sha, download_url: url, size } = await meta.json()

  const got = await fetch(url)
  if (!got.ok) throw new Error(`the title screen would not download: ${got.status}`)
  const bytes = Buffer.from(await got.arrayBuffer())
  if (bytes.length !== size) throw new Error(`the title screen came back ${bytes.length} bytes, not ${size}`)

  /* git's own blob hash, which is what GitHub reports, so a match means the same picture */
  const { createHash } = await import('node:crypto')
  const mine = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (mine !== sha) throw new Error(`the title screen hashes to ${mine}, not the ${sha} GitHub holds`)

  fs.writeFileSync(path.join(out, 'title.png'), bytes)
  console.log(`title.png copied from ${ISLANDS}, ${sha.slice(0, 8)}`)
}

/* ---------------------------------------------------------------- the hub --
 * `hub:crossed` is the flag the hub's own island writes at the top of the tunnel, so a save
 * carrying it skips the arrival film and hands the player the controls on the first frame.
 * That is the walking zoom: the free camera a student moves around in, not the close shot
 * the film ends on and not the wide one it opens with.
 */
if (GAME) {
  const save = STAMPED()
  save.flags = [...save.flags, 'hub:crossed', 'maw:railed', 'maw:handed_over']
  const { page, say, finish } = await open('hub', save, `${base}/?scene=pmap&deep=1&map=hub`)
  await page.waitForTimeout(9000)

  /* the square below the tunnel mouth, where the market, the waterfalls and the gate into
   * the mountain are all in one frame */
  const landed = await page.evaluate(() => window.__warp(360, 440))
  if (!/^ok/.test(String(landed))) throw new Error(`the hub would not take the standing spot: ${landed}`)
  await page.waitForTimeout(2500)

  const v = await readings(page)
  say(`hub ${JSON.stringify(v)}`)
  if (v.z > 4) throw new Error(`the camera is at ${v.z}, which is a film's shot and not the walking zoom`)
  await page.screenshot({ path: path.join(out, 'hub.png') })
  await finish()
}

/* --------------------------------------------------------------- the Maw --
 * dropping every `maw:` flag makes the room play its founding film from the top, and the
 * first line the principal says is the one worth keeping.
 */
if (GAME) {
  const save = STAMPED()
  save.flags = save.flags.filter((f) => !f.startsWith('maw:'))
  const { page, say, finish } = await open('maw', save, `${base}/?scene=pmap&deep=1&map=panther-maw`)
  /* the first gesture, because a browser holds its sound until one has happened */
  await page.mouse.click(683, 740)
  await page.waitForFunction(
    () => /Welcome to Bonney Lake High/.test(document.querySelector('.cs-dialogue-text')?.textContent ?? ''),
    null, { timeout: 90000 },
  )
  /* the hint only shows once the line has finished typing itself out, so waiting on it is
   * what keeps the picture off a half written sentence */
  await page.waitForSelector('.cs-continue-hint', { timeout: 15000 })
  await page.waitForTimeout(600)

  const v = await readings(page)
  say(`maw ${JSON.stringify(v)}`)
  await page.screenshot({ path: path.join(out, 'maw.png') })
  await finish()
}

/* ------------------------------------------------- the other two projects --
 * Ordinary web pages, so no game harness: open them, wait for the front door to stop moving,
 * and photograph what a visitor gets. The club site types its own headline a letter at a
 * time, so a shot taken on a timer catches a half written sentence about half the time.
 */
const SITES = [
  {
    file: 'wisegraph.png',
    url: 'https://wisegraph.vercel.app',
    /* the radial chart is the thing worth showing, and it is drawn after the copy lands.
     * Matched on the sentence under the headline, because the headline itself is one span
     * per letter and reads back out of the DOM with every space missing */
    ready: () => /WiseGraph draws the standardized scores/i.test(document.body.innerText),
  },
  {
    file: 'atc-site.png',
    url: 'https://atc-blhs.vercel.app',
    ready: () => /BONNEY LAKE HIGH SCHOOL/i.test(document.body.innerText),
    settle: true,
  },
]

{
  const browser = await chromium.launch()
  for (const s of SITES) {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1 })
    await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60000 })
    await page.waitForFunction(s.ready, null, { timeout: 45000 })
    if (s.settle) {
      /* held still rather than waited out: the headline is done when it has read the same
       * three times running, which is what a letter by letter animation cannot fake */
      let last = null
      let same = 0
      while (same < 3) {
        const now = await page.evaluate(() => document.body.innerText.slice(0, 400))
        same = now === last ? same + 1 : 0
        last = now
        await page.waitForTimeout(700)
      }
    }
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(out, s.file) })
    console.log(`${s.file} from ${s.url}`)
    await page.close()
  }
  await browser.close()
}

const made = ['title.png', 'wisegraph.png', 'atc-site.png', ...(GAME ? ['hub.png', 'maw.png'] : [])]
for (const f of made) {
  const { size } = fs.statSync(path.join(out, f))
  console.log(`${f}  ${(size / 1024).toFixed(0)} KB`)
}
console.log(`wrote to ${out}`)
