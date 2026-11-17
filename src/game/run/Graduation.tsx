import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { hasFlag, loadSave, setFlag, type FrozenRun, type SaveGame } from '../save'
import { cordsOf, PASSING_GRADE, ranksOf, type CordProgress } from '../progress'
import {
  diplomaFileName, diplomaOf, diplomaRows, DIPLOMA_COPY, renderDiploma, sealRun,
  standingsOf, artifactText, type Standing,
} from './diploma'
import { gpaThrough } from './yearbook-page'
import { rankTrackOf } from '../roster/roster'
import { track } from '../telemetry'
import { announce, usePanel } from '../ui/a11y'
import { Gauge, Glyph, Plank, useKitReady } from '../ui/controls'
import { note, saved } from '../ui/feedback'
import { AdvanceCue } from './YearStart'
import './run.css'

/* The graduation ceremony, shown as a series of cards: walking the stage, the cords, the board of
 * cords not earned, and the diploma. */

type Stage = 'processional' | 'honours' | 'board' | 'diploma'

/* One line saying where a cord came from. It's either one moment (an event) or something built up
 * over years (an accumulation). */
type Moment = { kind: 'event' | 'accumulation'; line: string }

function earnedMoment(cordId: string, s: SaveGame): Moment {
  const nth = (tag: string, n: number): string => {
    const hits = s.ledger.filter((e) => e.tags?.includes(tag) && e.grade >= PASSING_GRADE)
    const hit = hits[n - 1]
    return hit ? `${hit.title}, year ${hit.year}` : 'a class on your transcript'
  }
  switch (cordId) {
    case 'highest-honors':
    case 'high-honors':
      return { kind: 'accumulation', line: 'four years of the transcript, all of it' }
    case 'key-club':
      return { kind: 'accumulation', line: 'two years of showing up for other people' }
    case 'career-readiness':
      return { kind: 'event', line: `sealed by ${nth('cte', 2)}` }
    case 'ap-honors':
      return { kind: 'event', line: `the fifth: ${nth('ap', 5)}` }
    case 'ap-capstone':
      return { kind: 'event', line: `Seminar, Research, and the sixth: ${nth('ap', 6)}` }
    case 'seal-biliteracy':
      return { kind: 'event', line: `the fourth credit: ${nth('lang', 4)}` }
    default:
      return { kind: 'event', line: 'earned from what you did these four years' }
  }
}

/**
 * The GPA for each year so far. An accumulation cord shows these, because that's what it was earned
 * from.
 */
function gpaSeries(s: SaveGame): { year: number; gpa: number }[] {
  const out: { year: number; gpa: number }[] = []
  for (let y = 1; y <= Math.min(4, s.year); y++) {
    const g = gpaThrough(s, y)
    if (g !== null) out.push({ year: y, gpa: g })
  }
  return out
}

/* One card in the ceremony. Clicking it or pressing a key moves on to the next card. */
function TapCard({
  label, onAdvance, cue, className = '', children,
}: {
  label: string
  onAdvance: () => void
  cue: string
  className?: string
  children: ReactNode
}) {
  const el = useRef<HTMLDivElement>(null)
  /* Move focus to each new card so a keyboard player can still see where they are. */
  useEffect(() => { el.current?.focus() }, [])
  return (
    <div
      ref={el}
      className={`gr-card gr-tap kit-surface-panel ${className}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onAdvance}
    >
      {children}
      <AdvanceCue words={cue} className="gr-cue" />
    </div>
  )
}

export function Graduation({ onClose }: { onClose: () => void }) {
  const s = loadSave()
  const [stage, setStage] = useState<Stage>('processional')
  const [idx, setIdx] = useState(0)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panel = usePanel({ label: 'Graduation', closeOnEscape: false })
  useKitReady()

  /* The transcript is frozen once, at graduation, so the code printed on the diploma never changes. */
  const [sealed, setSealed] = useState<FrozenRun | null>(() => {
    const cur = loadSave()
    return cur ? diplomaOf(cur) : null
  })
  useEffect(() => {
    const cur = loadSave()
    if (!cur?.graduated) return
    if (cur.diploma) { setSealed(cur.diploma); return }
    /* Send the run_complete event at the moment the run is sealed, not on some later button press. */
    const rec = sealRun(cur)
    setSealed(rec)
    track('run_complete', { transcript: rec.transcript, code: rec.code })
  }, [])

  /* Space and Enter move to the next card on the stages that only need a tap. */
  const advanceRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      const go = advanceRef.current
      if (!go) return
      e.preventDefault()
      go()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const all = useMemo(() => (s ? cordsOf(s) : []), [s])
  const earned = useMemo(() => all.filter((c) => c.earned), [all])
  /* The board lists every cord the student didn't earn. It leaves out High Honors when they already
   * got Highest Honors. */
  const board = useMemo(() => {
    const gotHighest = all.some((c) => c.id === 'highest-honors' && c.earned)
    return all.filter((c) => !c.earned && !(gotHighest && c.id === 'high-honors'))
  }, [all])
  const standings = useMemo(() => (s && sealed ? standingsOf(s, sealed) : []), [s, sealed])
  const series = useMemo(() => (s ? gpaSeries(s) : []), [s])
  const keyYears = useMemo(() => (s ? ranksOf(s)[rankTrackOf('key-club') ?? 'keyclub'] ?? 0 : 0), [s])

  /* When no cord was earned, this stage shows the student's standings instead and is never skipped.
   * `standingsOf` always returns at least one entry, so every run gets something here. */
  const honours = useMemo<(CordProgress | Standing)[]>(
    () => (earned.length ? earned : standings), [earned, standings])
  const here: CordProgress | Standing | undefined = honours[Math.min(idx, Math.max(0, honours.length - 1))]

  /* Read the card's sentences out loud so a screen reader user hears what the cord was given for. */
  useEffect(() => {
    if (!s || !here) return
    if (stage !== 'honours') return
    announce('rule' in here
      ? `${here.name}. ${here.rule}. ${earnedMoment(here.id, s).line}.`
      : `${here.name}. ${here.count}. ${here.what}`)
  }, [stage, here, s])

  if (!s || !sealed) return null

  const code = sealed.code
  const rows = diplomaRows(s, sealed)
  const isCord = (h: CordProgress | Standing): h is CordProgress => 'rule' in h

  const nextHonour = () => {
    if (idx + 1 < honours.length) setIdx(idx + 1)
    else setStage('board')
  }
  /* This is set during render, not in an effect, because it's a ref and not state. The key press
   * has to do whatever the card on screen right now would do. */
  advanceRef.current = stage === 'processional'
    ? () => setStage('honours')
    : stage === 'honours' ? nextHonour : null

  const savePng = async () => {
    setSaving(true)
    try {
      const cv = canvasRef.current ?? document.createElement('canvas')
      /* Wait for the game's fonts to load before drawing the diploma. */
      await renderDiploma(cv, s, sealed)
      const a = document.createElement('a')
      a.download = diplomaFileName(s, sealed)
      a.href = cv.toDataURL('image/png')
      a.click()
      track('artifact_exported', { code, form: 'png' })
      saved('Your diploma is drawn and downloading')
    } finally {
      setSaving(false)
    }
  }

  /* Copies the diploma as plain text, for a computer that can't download the picture. */
  const copyArtifact = () => {
    const text = artifactText(s, sealed)
    void navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); saved('The whole thing is on your clipboard') })
      .catch(() => note('This Chromebook would not let the page copy', 'Read the code out to your teacher instead. It is the same code on their roster.'))
    track('artifact_exported', { code, form: 'text' })
  }

  const finish = () => {
    if (!hasFlag('gear2')) { track('gear2_unlocked'); setFlag('gear2') }
    onClose()
  }

  return (
    <div className="gr-veil">
      <div className="gr-stage" {...panel}>
        {stage === 'processional' && (
          <TapCard
            label="Walk the stage"
            cue="walk the stage"
            onAdvance={() => setStage('honours')}
          >
            <h2 className="gr-title">Graduation</h2>
            {/* The walk across the stage is told only in words for now, with no art behind it. */}
            <p className="gr-line">
              Graduation day. Everyone you met these four years is in the crowd.
            </p>
            <p className="gr-line">Thor walks the stage in teal. The stole reads BONNEY LAKE.</p>
          </TapCard>
        )}

        {stage === 'honours' && here && (
          <TapCard
            label={isCord(here)
              ? `${here.name}. Next card, ${idx + 1} of ${honours.length}`
              : `${here.name}. Next card, ${idx + 1} of ${honours.length}`}
            cue={idx + 1 < honours.length ? `${idx + 1} of ${honours.length}` : 'see the cords you missed'}
            className={isCord(here) ? 'gr-cordcard' : 'gr-standcard'}
            onAdvance={nextHonour}
          >
            {isCord(here) ? (
              <>
                <h2 className="gr-cordname">{here.name}</h2>
                <p className="gr-cordcolors">{here.colors}</p>

                {/* The school's own rule for the cord, with what the game actually counted next to
                  * it. */}
                <p className="gr-ruleline">
                  <span className="gr-rulelabel">Bonney Lake gives it for</span>
                  <span className="gr-rule">{here.rule}</span>
                </p>
                {here.model && (
                  <p className="gr-modelline">
                    <span className="gr-rulelabel">what this game counted</span>
                    <span className="gr-model">{here.model}</span>
                  </p>
                )}

                <p className="gr-moment">{earnedMoment(here.id, s).line}</p>

                {/* An accumulation cord shows the whole build-up, like the GPA for each year,
                  * instead of pointing at a single class that didn't earn it on its own. */}
                {earnedMoment(here.id, s).kind === 'accumulation' && (
                  here.id === 'key-club'
                    ? <p className="gr-series">{keyYears} {keyYears === 1 ? 'year' : 'years'} in Key Club</p>
                    : (
                      <ul className="gr-series" aria-label="Grade point average, year by year">
                        {series.map((p) => (
                          <li key={p.year}><span className="gr-seriesyear">Year {p.year}</span><b>{p.gpa.toFixed(2)}</b></li>
                        ))}
                      </ul>
                    )
                )}

                <p className="gr-source">{here.source}</p>
              </>
            ) : (
              <>
                {/* An accomplishment uses the same card shape but never looks like a cord. It has
                  * no colors, no rule and no gold, only what it is, what it took and its count. */}
                <h2 className="gr-standname">{here.name}</h2>
                <p className="gr-standcount">{here.count}</p>
                <p className="gr-line">{here.what}</p>
              </>
            )}
          </TapCard>
        )}

        {stage === 'board' && (
          /* The board is a plain area with one real button. Tapping it doesn't move on. */
          <div className="gr-card gr-boardcard kit-surface-panel">
            <h2 className="gr-title">{earned.length ? 'The cords you did not earn' : 'The cords you could earn next time'}</h2>
            {board.length === 0 ? (
              <p className="gr-line">Every cord this school gives is on your cape. Nobody does that.</p>
            ) : (
              <>
                <p className="gr-line gr-dim">
                  Everything Bonney Lake gives that is not on your cape, and what each one takes.
                </p>
                <ul className="gr-boardlist">
                  {board.map((c) => (
                    <li className="gr-boardrow" key={c.id}>
                      <span className="gr-boardhead">
                        <span className="gr-boardname">{c.name}</span>
                        <span className="gr-boarddetail">
                          {/* A different sentence for a cord with no published rules, one the
                            * student made progress on, and one they never touched. */}
                          {!c.published ? 'criteria not published'
                            : c.progress > 0 ? c.detail
                              : 'you never went near this one'}
                        </span>
                      </span>
                      {c.published && <Gauge value={c.progress} label={`${c.name}, ${c.detail}`} />}
                      <span className="gr-boardrule">{c.rule}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="gr-acts">
              <Plank size="lg" onClick={() => setStage('diploma')}>See your diploma</Plank>
            </div>
          </div>
        )}

        {stage === 'diploma' && (
          <div className="gr-card gr-diploma kit-surface-panel">
            <span className="gr-crest" aria-hidden="true" />
            <h2 className="gr-dip-school">{DIPLOMA_COPY.school}</h2>
            <p className="gr-dip-sub">{DIPLOMA_COPY.certifies}</p>
            <p className="gr-dip-name">{s.handle || DIPLOMA_COPY.unnamed}</p>
            <p className="gr-dip-sub">{DIPLOMA_COPY.completed}</p>

            {/* The card, the PNG and the copied text all show the same rows in the same order. */}
            <dl className="gr-dip-grid">
              {rows.map((r) => (
                <div className="gr-dip-pair" key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>

            <p className="gr-dip-code">
              <Glyph piece="stamp" face="sealed" size={26} className="gr-dip-seal" />
              <span className="gr-dip-codelabel">{DIPLOMA_COPY.verification}</span>
              <b>{code}</b>
            </p>
            <p className="gr-dip-sub gr-dim">{DIPLOMA_COPY.roster}</p>
            {/* If nothing downloads, the student can show this screen instead. It has the same
              * code. */}
            <p className="gr-dip-sub gr-dim">
              If nothing downloads, show them this screen. The code is the same one.
            </p>

            <div className="gr-acts">
              <Plank size="md" busy={saving} glyph={['icon_set', 'star']} onClick={() => { void savePng() }}>
                Save my diploma
              </Plank>
              <Plank size="md" onClick={copyArtifact}>
                {copied ? 'Copied it again' : 'Copy it as text'}
              </Plank>
              <Plank size="md" glyph={['icon_set', 'compass']} onClick={finish}>
                Start free play
              </Plank>
            </div>
            <canvas ref={canvasRef} className="gr-canvas" />
          </div>
        )}
      </div>
    </div>
  )
}
