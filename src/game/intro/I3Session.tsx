import { useEffect, useMemo, useRef, useState } from 'react'
import { useNav } from '../../app/SceneManager'
import { track } from '../telemetry'
import { checkClass, classesAreOpen, joinClass } from '../net'
import { loadSave, writeSave } from '../save'
import { LOOKS, drawRecolored } from '../thorLook'
import { cleanName, isBlocked, PRONOUN_CHOICES } from '../names'
import { programmeById } from '../roster/roster'
import { announce, usePanel } from '../ui/a11y'
import { Glyph, Plank } from '../ui/controls'
import { prefersReducedMotion } from '../ui/motion'
import './i3.css'

// The parchment setup on the beach. The player enters a class code, a name and pronouns, picks an
// outfit and names the boat.

/* The invitation letter. Its last line depends on whether there's a class to join. Every student
 * reads the letter, but only some have a class code, so don't promise six code boxes to someone who
 * won't see them. */
const LETTER_BODY =
  'Panther. We saved you a spot.\n' +
  'Bonney Lake High School takes new students every fall. This is your invitation.\n' +
  'Sail to Bonney Lake High School. Go into the mountain and find the principal.\n'
const LETTER_CODE = 'Your teacher left you a class code. Type it in the six boxes below.'
const LETTER_NO_CODE = 'Come as you are. The island is there either way.'

const PRINCIPAL_WORD =
  'Out there, every island is something Bonney Lake really offers. Clubs, sports, classes, honors. ' +
  'You get four years, and you cannot do everything. That is the whole point. Choose like it matters, ' +
  'because it does.'

const HANDLE_A = ['Brave', 'Golden', 'Quiet', 'Swift', 'Salt', 'Ember', 'Lucky', 'Harbor', 'Reef', 'Cedar']
const HANDLE_B = ['Tide', 'Gull', 'Paw', 'Wake', 'Compass', 'Current', 'Anchor', 'Lantern', 'Prowler', 'Drift']
const BOATS = ['Second Wind', "Panther's Wake", 'Late Pass', 'Salt & Chalk', 'First Bell', 'The Golden Gull', 'Homeroom Runner', 'The Field Trip']
const spinHandle = () => HANDLE_A[Math.floor(Math.random() * HANDLE_A.length)] + HANDLE_B[Math.floor(Math.random() * HANDLE_B.length)]
const spinBoat = () => BOATS[Math.floor(Math.random() * BOATS.length)]

/* How long the scroll waits for the class service before deciding on its own. A student on slow
 * school wifi shouldn't sit on a blank page, and a student with no class shouldn't see the code
 * boxes appear and then vanish. */
const CLASS_ASK_MS = 2200

// A class join that failed because of the network keeps retrying quietly in the background until it
// works.
const RETRY_MS = [5_000, 15_000, 45_000, 120_000, 300_000, 300_000, 300_000]
let retryTimer = 0

function queueJoin(code: string, handle: string, attempt = 0): void {
  if (attempt >= RETRY_MS.length) {
    track('join_queue_gave_up', { attempts: attempt })
    return
  }
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => {
    void joinClass(code, handle).then((r) => {
      if (r.ok) { track('join_landed_late', { attempt: attempt + 1 }); return }
      /* Only retry on a network failure. `unknown_code` and `class_closed` are real answers, and
       * `error` means the server said no. */
      if (r.reason === 'offline') queueJoin(code, handle, attempt + 1)
      else track('join_queue_refused', { reason: r.reason })
    })
  }, RETRY_MS[attempt])
}

// Shows a block of text one character at a time. A click shows the rest right away.
function useTypewriter(text: string, cps = 42) {
  const [n, setN] = useState(0)
  const done = n >= text.length
  useEffect(() => {
    if (prefersReducedMotion()) { setN(text.length); return }
    setN(0)
    const t0 = performance.now()
    let raf = 0
    const step = () => {
      const k = Math.floor(((performance.now() - t0) / 1000) * cps)
      setN(Math.min(text.length, k))
      if (k < text.length) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [text, cps])
  return { shown: text.slice(0, n), done, finish: () => setN(text.length) }
}

/** The Principal's signature, with the school crest next to the name. */
function Signature() {
  return (
    <div className="i3-sig">
      <span className="i3-crest" aria-hidden="true" />
      <span>Principal Panther</span>
    </div>
  )
}

type Result = { handle: string; pronouns: string; boatName: string; castaway: boolean; thorLook: string }
type Card = 'code' | 'identity' | 'word' | 'wardrobe' | 'boat' | 'rollup'

const CARD_SAID: Record<Card, string> = {
  code: 'A letter from Bonney Lake. Type the class code your teacher gave you.',
  identity: 'That code worked. Choose the name your class will see.',
  word: 'The letter turns over. A word from the Principal.',
  wardrobe: 'Pick what Thor wears.',
  boat: 'A postscript. Name your boat.',
  rollup: 'The letter rolls itself up.',
}

export function I3Session({ onDone }: { onDone: (r: Result) => void }) {
  // After a refresh partway through the intro, the cards fill in from the save and skip what's
  // already answered. A student who already joined never types the code again.
  const saved = loadSave()
  const alreadyJoined = !!saved?.participantId || !!saved?.castaway
  const [card, setCard] = useState<Card>(alreadyJoined ? 'identity' : 'code')
  /* Ask whether there's a class before drawing the letter. Otherwise the letter and its boxes show
   * up first and then get replaced, which makes the first page flicker. Don't wait forever, though:
   * no answer from the server counts as a no. */
  const [asking, setAsking] = useState(!alreadyJoined)
  /* The letter shows either way. Only the six code boxes depend on there being a class. Don't skip
   * the whole card, or the scroll opens on a name box. */
  const [classOpen, setClassOpen] = useState<boolean | null>(null)
  useEffect(() => {
    if (alreadyJoined) return
    let gone = false
    const settle = (open: boolean) => {
      if (gone) return
      setClassOpen(open)
      if (!open) {
        track('join_skipped', { why: 'no server' })
        setCastaway(true)
      }
      setAsking(false)
    }
    const late = window.setTimeout(() => settle(true), CLASS_ASK_MS)
    void classesAreOpen().then((open) => { window.clearTimeout(late); settle(open) })
      .catch(() => { window.clearTimeout(late); settle(false) })
    return () => { gone = true; window.clearTimeout(late) }
  }, [alreadyJoined])
  const [castaway, setCastaway] = useState(!!saved?.castaway)
  const [code, setCode] = useState(saved?.classCode ?? '')
  const [className, setClassName] = useState<string | undefined>()
  const [handle, setHandle] = useState(saved?.handle ?? '')
  const [pronouns, setPronouns] = useState(saved?.pronouns ?? '')
  const [boat, setBoat] = useState(saved?.boatName ?? '')
  const [look, setLook] = useState(saved?.thorLook ?? 'classic')
  const [joining, setJoining] = useState(false)
  const [joinErr, setJoinErr] = useState('')
  const result = useRef<Result>({ handle: 'Panther', pronouns: 'they/them', boatName: 'The Bonney', castaway: false, thorLook: 'classic' })
  const nav = useNav()

  // Each new card replaces the whole screen, so it announces its name to screen readers and takes
  // focus.
  const stage = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    announce(CARD_SAID[card])
    if (card === 'rollup') return
    // If a card has no control yet, the paper takes focus, so Tab stays inside the letter.
    const first = stage.current?.querySelector<HTMLElement>('input, button')
    ;(first ?? stage.current)?.focus()
  }, [card])

  const next = (c: Card) => setCard(c)

  // The order of the cards. Back goes to the card before, and Back on the first card goes to the
  // title screen.
  /* With no class to join the code card is skipped, so Back from the name card goes to the title
   * screen instead of a card the player never saw. */
  const ORDER: Card[] = castaway ? ['identity', 'word', 'wardrobe', 'boat']
    : ['code', 'identity', 'word', 'wardrobe', 'boat']
  const first: Card = ORDER[0]
  const back = () => {
    const at = ORDER.indexOf(card)
    if (at <= 0 || card === first) { nav.go('title'); return }
    setCard(ORDER[at - 1])
  }
  const finish = () => {
    const r = result.current
    // Once joined, the handle in the save is the right one, because the server may have added a
    // suffix to tell two matching names apart.
    r.handle = (loadSave()?.handle || handle).trim() || 'Panther'
    r.pronouns = pronouns || 'they/them'
    r.boatName = boat.trim() || 'The Bonney'
    r.castaway = castaway
    r.thorLook = look
    setCard('rollup')
    window.setTimeout(() => onDone(r), 650)
  }

  // The real join happens here, with the name the student picked. The code card only checks that
  // the class exists. Joining there with a placeholder name would merge every student in a class
  // into one participant.
  const confirmIdentity = async () => {
    if (castaway || (alreadyJoined && !!saved?.participantId)) { next('word'); return }
    setJoining(true); setJoinErr('')
    const r = await joinClass(code, handle.trim() || 'Panther')
    setJoining(false)
    if (r.ok) {
      if (r.handle && r.handle !== handle) setHandle(r.handle)   // A matching name got a suffix from the server.
      track('join_ok', { returning: !!r.returning })
      next('word')
      return
    }
    if (r.reason === 'offline') {
      /* The run keeps going and shows no error. The student can't fix the wifi, and stopping here
       * would lock out the students with the worst networks. */
      track('join_queued', { at: 'identity' })
      queueJoin(code, handle.trim() || 'Panther')
      next('word')
      return
    }
    if (r.reason === 'unknown_code' || r.reason === 'class_closed') {
      /* A closed class gets a different message than a wrong code. A wrong code means check it
       * again, and a closed class means the teacher has to open it. */
      setJoinErr(r.reason === 'class_closed'
        ? 'That class is closed right now. Your teacher can open it again.'
        : 'That code does not work any more. Check it with your teacher.')
      setCard('code')
      return
    }
    setJoinErr('Something went wrong. Give it one more try.')
  }

  // The scroll is a modal panel that keeps focus inside it, and Escape doesn't close it.
  const panel = usePanel({ label: 'A letter from Bonney Lake', closeOnEscape: false })

  return (
    <div className="i3-root">
      <div className={`i3-scroll ${card === 'rollup' ? 'i3-rollup' : ''}`} {...panel}>
        <div className="i3-paper" ref={stage} tabIndex={-1}>
          {/* One Back button for every card, on the paper instead of inside each card. */}
          {card !== 'rollup' && (
            <button className="i3-back" onClick={back}>
              {/* The drawn arrow, turned to point back. The word still makes sense without it. */}
              <Glyph piece="icon_set" face="arrow" size={12} className="i3-back-mark" />
              {card === first ? 'Quit to the title screen' : 'Back'}
            </button>
          )}
          {/* Nothing is drawn while the scroll is still checking for a class to join. A card that
            * shows up and then gets swapped out would be a bad first thing for a student to see. */}
          {asking && <div className="i3-card i3-asking" aria-hidden="true" />}
          {!asking && card === 'code' && (
            <CodeCard
              initial={code}
              err={joinErr}
              classOpen={classOpen !== false}
              onVerified={(c, name) => { setCode(c); setClassName(name); setJoinErr(''); next('identity') }}
              onCastaway={() => { setCastaway(true); setJoinErr(''); next('identity') }}
            />
          )}
          {!asking && card === 'identity' && (
            <IdentityCard
              castaway={castaway}
              className={className}
              handle={handle} setHandle={setHandle}
              pronouns={pronouns} setPronouns={setPronouns}
              joining={joining} err={joinErr}
              onNext={confirmIdentity}
            />
          )}
          {!asking && card === 'word' && <WordCard onNext={() => next('wardrobe')} />}
          {!asking && card === 'wardrobe' && <WardrobeCard look={look} setLook={setLook} onNext={() => next('boat')} />}
          {!asking && card === 'boat' && <BoatCard boat={boat} setBoat={setBoat} onNext={finish} />}
        </div>
      </div>
    </div>
  )
}

// ---- card 1: the letter + the code ----
function CodeCard({ initial, err: outerErr, classOpen = true, onVerified, onCastaway }: {
  initial: string
  err?: string
  /**
   * Whether this deploy has a class service answering. The letter shows either way. Only the six
   * boxes and 'Join my class' depend on it.
   */
  classOpen?: boolean
  onVerified: (code: string, className?: string) => void
  onCastaway: () => void
}) {
  const tw = useTypewriter(LETTER_BODY + (classOpen ? LETTER_CODE : LETTER_NO_CODE))
  const [code, setCode] = useState<string[]>(() => {
    const pre = (initial ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6).split('')
    return Array.from({ length: 6 }, (_, i) => pre[i] ?? '')
  })
  const [err, setErr] = useState(outerErr ?? '')
  const [shake, setShake] = useState(0)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const tries = useRef(0)
  const lockUntil = useRef(0)   // The rate limit wears off by itself.

  const put = (i: number, v: string) => {
    const ch = v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    if (ch.length > 1) { paste(i, ch); return }
    const nextCode = [...code]; nextCode[i] = ch
    setCode(nextCode); setErr('')
    if (ch && i < 5) refs.current[i + 1]?.focus()
  }
  const paste = (i: number, text: string) => {
    const chars = text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6 - i).split('')
    const nextCode = [...code]
    chars.forEach((c, k) => { nextCode[i + k] = c })
    setCode(nextCode)
    refs.current[Math.min(5, i + chars.length)]?.focus()
  }
  const back = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'Enter') void submit()
  }
  // A refused code shakes the boxes, shows one friendly line and reads it out to screen readers.
  const refuse = (line: string) => {
    setErr(line)
    setShake((s) => s + 1)
    announce(line)
  }
  const [checking, setChecking] = useState(false)
  const submit = async () => {
    const joined = code.join('')
    if (Date.now() < lockUntil.current) {
      refuse('Too many tries. Wait a minute, then try again.')
      return
    }
    /* A half-typed code doesn't count as a try. Check the length before bumping the counter, so
     * only codes the server refused count toward the limit. */
    if (joined.length < 6) {
      refuse('The code is six characters. Fill in every box.')
      return
    }
    tries.current++
    track('join_attempt', { len: joined.length, tries: tries.current })
    if (tries.current > 5) {
      tries.current = 0
      lockUntil.current = Date.now() + 60_000
      refuse('Too many tries. Wait a minute, then try again.')
      return
    }
    // Only check the class here. The real join happens on the identity card, with the name the
    // student picked.
    setChecking(true)
    const r = await checkClass(joined)
    setChecking(false)
    if (r.ok) {
      /* A code that worked resets the count. The limit is there to stop people guessing codes, and
       * a student who got in isn't guessing. */
      tries.current = 0
      writeSave({ classCode: joined.toUpperCase() })
      onVerified(joined.toUpperCase(), r.className)
      return
    }
    // A student on bad wifi keeps going with the code they typed instead of getting stuck.
    if (r.reason === 'offline') {
      track('class_check_offline')
      onVerified(joined.toUpperCase())
      return
    }
    refuse(r.reason === 'unknown_code'
      ? 'That code does not work. Check it with your teacher.'
      : r.reason === 'class_closed'
        ? 'That class is closed right now. Your teacher can open it again.'
        : 'Something went wrong. Give it one more try.')
  }

  return (
    /* The letter scrolls and takes the leftover space, so the boxes and the two buttons stay on the
     * paper. */
    <div className="i3-card i3-card-code" onClick={() => { if (!tw.done) tw.finish() }}>
      <div className="i3-letter i3-letter-scroll">{tw.shown}{!tw.done && <span className="i3-caret" aria-hidden="true" />}</div>
      {tw.done && !classOpen && (
        /* There's no class to join, but the letter still shows. Six empty boxes that nothing can
         * check would be pointless, so the card offers the one real option: set sail anyway. */
        <div className="i3-codefoot">
          <Signature />
          <p className="i3-noclass">Nobody has a class open right now, so there is no code to type.</p>
          <Plank size="lg" onClick={onCastaway}>Set sail</Plank>
        </div>
      )}
      {tw.done && classOpen && (
        <div className="i3-codefoot">
          <Signature />
          {/* Six code boxes. The group has one label, and each box says which character it is. */}
          <div
            key={shake}
            className={`i3-codeboxes ${shake ? 'i3-shake' : ''}`}
            role="group"
            aria-label="Class code, six characters"
            aria-describedby={err ? 'i3-code-err' : undefined}
          >
            {code.map((c, i) => (
              <input
                key={i}
                ref={(el) => { refs.current[i] = el }}
                className="i3-codebox"
                value={c}
                maxLength={6}
                autoFocus={i === 0}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label={`Class code character ${i + 1} of 6`}
                aria-invalid={err ? true : undefined}
                onChange={(e) => put(i, e.target.value)}
                onKeyDown={(e) => back(i, e)}
                onPaste={(e) => { e.preventDefault(); paste(i, e.clipboardData.getData('text')) }}
              />
            ))}
          </div>
          {err && <div className="i3-err" id="i3-code-err" role="alert">{err}</div>}
          {/* Two buttons of equal weight: join a class, or play without one. */}
          <Plank className="i3-plank" busy={checking} onClick={() => void submit()}>
            {checking ? 'Checking the code' : 'Join my class'}
          </Plank>
          <Plank className="i3-plank" onClick={() => { track('demo_entered'); onCastaway() }}>
            No code? Play without a class.
          </Plank>
        </div>
      )}
    </div>
  )
}

// ---- card 2: handle + pronouns (the real join happens on confirm, in the parent) ----
function IdentityCard(p: {
  castaway: boolean
  className?: string
  handle: string; setHandle: (v: string) => void
  pronouns: string; setPronouns: (v: string) => void
  joining: boolean; err: string
  onNext: () => void
}) {
  const [spins, setSpins] = useState(0)
  const ok = p.handle.trim().length >= 3 && !isBlocked(p.handle)
  const bad = isBlocked(p.handle)
  const confirm = () => {
    if (p.joining) return
    if (!ok) { p.setHandle(spinHandle()); return }
    track('identity_set', { generated: spins > 0, spins, pronouns: p.pronouns || 'unset' })
    p.onNext()
  }
  const spin = () => { const v = spinHandle(); p.setHandle(v); setSpins((s) => s + 1); announce(`Name set to ${v}`) }
  return (
    <div className="i3-card">
      <div className="i3-head">
        {p.castaway ? 'Playing without a class.'
          : p.className ? `Found your class: ${p.className}.` : 'That code worked.'}
      </div>
      {/* A real label tied to the text box, so a screen reader reads the question instead of only
        * saying 'edit text'. */}
      <label className="i3-sub" htmlFor="i3-handle">What should your class call you?</label>
      <div className="i3-fieldrow">
        <span className="i3-fieldbox">
          <input
            id="i3-handle"
            className="i3-field"
            value={p.handle}
            placeholder="your name"
            autoComplete="off"
            aria-invalid={bad || undefined}
            aria-describedby={bad ? 'i3-handle-err' : 'i3-handle-note'}
            onChange={(e) => p.setHandle(cleanName(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
          />
        </span>
        {/* The button says its job in words, so a screen reader has a real name to read out. */}
        <Plank size="sm" className="i3-spin" onClick={spin}>Spin a name</Plank>
      </div>
      {bad && <div className="i3-err" id="i3-handle-err" role="alert">That name is not allowed. Try another one.</div>}
      {p.err && <div className="i3-err" role="alert">{p.err}</div>}
      <div className="i3-reassure" id="i3-handle-note">This name is what your class sees. Your real name never leaves the room.</div>
      <div className="i3-chips" role="group" aria-label="Pronouns">
        {PRONOUN_CHOICES.map((c) => (
          <button
            key={c}
            className={`i3-chip ${p.pronouns === c ? 'i3-chip-on' : ''}`}
            aria-pressed={p.pronouns === c}
            onClick={() => { p.setPronouns(c); announce(`Pronouns ${c}`) }}
          >{c}</button>
        ))}
      </div>
      <Plank className="i3-plank i3-plank-solo" busy={p.joining} onClick={confirm}>
        {p.joining ? 'Joining your class' : ok ? 'That is me' : 'Spin one for me'}
      </Plank>
    </div>
  )
}

// ---- card 3: the Principal's word ----
function WordCard({ onNext }: { onNext: () => void }) {
  const tw = useTypewriter(PRINCIPAL_WORD, 48)
  return (
    <div className="i3-card" onClick={() => { if (!tw.done) tw.finish() }}>
      <div className="i3-head">The letter turns over.</div>
      <div className="i3-letter">{tw.shown}{!tw.done && <span className="i3-caret" aria-hidden="true" />}</div>
      {tw.done && (
        <>
          <Signature />
          <Plank className="i3-plank i3-plank-solo" onClick={onNext}>Understood</Plank>
        </>
      )}
    </div>
  )
}

// Card 4 is the wardrobe: Thor's coat colors and the locked items. What earns a locked item is
// looked up from the roster, so it never promises an island that doesn't exist.
const earnByCompleting = (id: string) => {
  const g = programmeById(id)
  return g ? `complete the ${g.name} island` : 'that island is not open yet'
}

const LOCKED = [
  { name: 'Letterman jacket', earn: 'reach Varsity in any sport' },
  { name: 'Robotics goggles', earn: earnByCompleting('robotics') },
  { name: 'Graduation cap', earn: 'finish all four years' },
]

function drawThor(cv: HTMLCanvasElement, hue: number | null) {
  const img = new Image()
  /* This is the same dye the beach and the painted world apply when they load. Both `PmapScene` and
   * `BeachIso` subscribe to the save, so they apply it again as soon as it changes. */
  img.onload = () => drawRecolored(cv, img, hue)
  img.src = '/art/characters/thor/walk/south/0.png'
}

function WardrobeCard(p: { look: string; setLook: (v: string) => void; onNext: () => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [pop, setPop] = useState(0)
  useEffect(() => {
    if (cvRef.current) drawThor(cvRef.current, LOOKS[p.look]?.hue ?? null)
  }, [p.look])
  const pick = (k: string) => {
    p.setLook(k); setPop((v) => v + 1)
    track('cosmetic_change', { look: k })
    /* The mirror is a canvas, so a student who can't see it would get no feedback from the button.
     * The announcement tells them what changed. `Wardrobe.tsx` does the same for its copy of this
     * control. */
    announce(`Wearing ${LOOKS[k]?.label ?? k}`)
  }
  const spin = () => pick(Object.keys(LOOKS)[Math.floor(Math.random() * Object.keys(LOOKS).length)])
  return (
    <div className="i3-card">
      <div className="i3-head">Pick what Thor wears.</div>
      <div className="i3-wardrobe">
        <img className="i3-trunk" src="/art/island/castaway-trunk.png" alt="" draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <canvas key={pop} ref={cvRef} className="i3-thorview" aria-hidden="true" />
        <img className="i3-tailor" src="/art/characters/heron/south-west.png" alt="" draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
      </div>
      {/* The coat swatches. Each has its own name, so they aren't told apart only by color. */}
      <div className="i3-swatches" role="group" aria-label="Coats">
        {Object.entries(LOOKS).map(([k, v]) => (
          <button
            key={k}
            className={`i3-swatch ${p.look === k ? 'i3-swatch-on' : ''}`}
            style={{ background: v.hue === null ? 'var(--kit-front-teal)' : `hsl(${v.hue}, 48%, 42%)` }}
            aria-label={v.label} aria-pressed={p.look === k}
            onClick={() => pick(k)}
          />
        ))}
      </div>
      <Plank size="sm" className="i3-spin i3-spin-wide" onClick={spin}>Surprise me</Plank>
      {/* A quiet list of locked items and what earns each one. Nothing here is pressable. */}
      <ul className="i3-locked" aria-label="Locked items">
        {LOCKED.map((it) => (
          <li key={it.name} className="i3-lockrow">
            <Glyph
              piece="icon_set" face="lock" size={12} className="i3-lockmark"
              fallback={<span className="i3-lockmark i3-lockshape" aria-hidden="true" />}
            />
            <span className="i3-lockname">{it.name}</span>
            {' '}
            <span className="i3-lockearn">{it.earn}</span>
          </li>
        ))}
      </ul>
      <div className="i3-reassure">Locked items are earned by playing, never bought.</div>
      <Plank className="i3-plank i3-plank-solo" onClick={() => { track('dressing_done', { look: p.look }); p.onNext() }}>
        {p.look === 'classic' ? 'Keep this outfit' : 'Wear this outfit'}
      </Plank>
    </div>
  )
}

// ---- card 5: name the boat ----
function BoatCard(p: { boat: string; setBoat: (v: string) => void; onNext: () => void }) {
  const [spun, setSpun] = useState(false)
  const ok = p.boat.trim().length >= 2 && !isBlocked(p.boat)
  const bad = isBlocked(p.boat)
  const postscript = useMemo(() => 'P.S. The boat at the pier is yours. Give it a name.', [])
  const confirm = () => {
    track('boat_named', { generated: spun, skipped: !ok })
    p.onNext()
  }
  const spin = () => { const v = spinBoat(); p.setBoat(v); setSpun(true); announce(`Boat named ${v}`) }
  return (
    <div className="i3-card">
      <div className="i3-letter i3-ps">{postscript}</div>
      <label className="i3-sub" htmlFor="i3-boat">Your boat's name</label>
      <div className="i3-fieldrow">
        <span className="i3-fieldbox">
          <input
            id="i3-boat"
            className="i3-field"
            value={p.boat}
            placeholder="your boat name"
            autoComplete="off"
            aria-invalid={bad || undefined}
            aria-describedby={bad ? 'i3-boat-err' : undefined}
            onChange={(e) => p.setBoat(cleanName(e.target.value, 18))}
            onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
          />
        </span>
        <Plank size="sm" className="i3-spin" onClick={spin}>Spin a name</Plank>
      </div>
      {bad && <div className="i3-err" id="i3-boat-err" role="alert">That boat name will not work. Try another.</div>}
      <Plank className="i3-plank i3-plank-solo" onClick={confirm}>{ok ? 'Paint it on' : 'Name it The Bonney'}</Plank>
    </div>
  )
}
