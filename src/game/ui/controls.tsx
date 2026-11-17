/* The drawn controls the game's screens are built from. Each one wears a piece of the kit art. */
import {
  useEffect, useRef, useState, useSyncExternalStore,
  type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react'
import { faceStyle } from './kitFaceStyle'
import { kitCached, kitFace, kitGeneration, kitOptedIn, kitPiece, onKitLanded } from './kit'
import { playUi } from '../audio'
import './controls.css'

/* Makes a control redraw as soon as the kit art finishes loading. */
export function useKitReady(): number {
  return useSyncExternalStore(onKitLanded, kitGeneration, () => 0)
}

/* One drawn icon from a kit sprite sheet, or the caller's fallback if there's no drawing for it. */
export function Glyph({
  piece, face, size = 22, fallback = null, className = '', title,
}: {
  piece: string
  face: string
  /** The height of the icon, in CSS pixels. */
  size?: number
  fallback?: ReactNode
  className?: string
  title?: string
}) {
  useKitReady()
  const style = faceStyle(piece, face)
  if (!style) return <>{fallback}</>
  /* Keep the icon's drawn shape. size sets the height and the width is worked out from it. */
  const cut = kitFace(kitCached() ?? [], piece, face)
  const w = cut && cut.h > 0 ? Math.round(size * (cut.w / cut.h)) : size
  return (
    <span
      className={`kit-glyph ${className}`}
      style={{ ...style, width: w, height: size }}
      aria-hidden="true"
      title={title}
    />
  )
}

/* Gives back the CSS class for a drawn background, or `kit-bare` if the platform didn't publish
 * one. */
export function useSurface(piece: string): string {
  useKitReady()
  const worn = kitOptedIn()
  return worn && kitPiece(kitCached() ?? [], piece) ? `kit-surface-${piece}` : 'kit-bare'
}

/** The same icon as a plain style object, for a caller that draws its own box. */
export function useFace(piece: string, face: string): CSSProperties | undefined {
  useKitReady()
  return faceStyle(piece, face)
}

/* The plank is the button every screen uses. It has six states: rest, hover, pressed, focused,
 * disabled and busy. */
export type PlankSize = 'sm' | 'md' | 'lg'

export function Plank({
  children, sub, keyCap, busy = false, size = 'md', wide = false, glyph, className = '',
  disabled, ...rest
}: {
  children: ReactNode
  /* An optional quieter second line inside the same sign. */
  sub?: ReactNode
  /** The keyboard key that also presses this, drawn onto the sign. */
  keyCap?: string
  /** The press went through and something is happening. */
  busy?: boolean
  size?: PlankSize
  /** Stretch to fill the row instead of sizing to the label. */
  wide?: boolean
  /** A drawn icon before the label, given as `[piece, face]`. */
  glyph?: [string, string]
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`kit-plank kit-surface-plank kit-plank-${size}`
        + `${wide ? ' kit-plank-wide' : ''}${sub ? ' kit-plank-two' : ''} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {keyCap && <span className="kit-plank-key" aria-hidden="true">{keyCap}</span>}
      {glyph && <Glyph piece={glyph[0]} face={glyph[1]} size={18} className="kit-plank-glyph" />}
      <span className="kit-plank-lines">
        <span className="kit-plank-ink">{children}</span>
        {sub && <span className="kit-plank-sub">{sub}</span>}
      </span>
      {busy && <span className="kit-plank-busy" aria-hidden="true" />}
    </button>
  )
}

/* The chip is a small round counter that can be plain, lit or spent. */
export function Chip({
  state = 'plate', children, label, className = '', ...rest
}: {
  state?: 'plate' | 'plate_lit' | 'plate_spent'
  children?: ReactNode
  label?: string
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const face = useFace('chip', state)
  const press = rest.onClick
  const Node = press ? 'button' : 'span'
  return (
    <Node
      className={`kit-chip kit-chip-${state}${face ? ' kit-chip-drawn' : ''} ${className}`}
      style={face}
      aria-label={label}
      title={label}
      {...(press ? { type: 'button' as const, ...rest } : {})}
    >
      {children}
    </Node>
  )
}

/* A tab. Tabs sit in a row that scrolls sideways instead of wrapping. */
export function Tab({
  active, children, className = '', ...rest
}: { active: boolean; children: ReactNode; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`kit-tab ${useSurface('tab')}${active ? ' kit-tab-on' : ''} ${className}`}
      {...rest}
    >
      <span className="kit-tab-ink">{children}</span>
    </button>
  )
}

/* A text box where the student types. It can show a unit, a hint, and an error that says why the
 * value was refused. */
export function Field({
  label, error, unit, hint, className = '', id, ...rest
}: {
  label: string
  error?: string | null
  unit?: string
  hint?: string
  className?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  const surface = useSurface('field')
  const auto = `kf-${label.replace(/\W+/g, '-').toLowerCase()}`
  const fid = id ?? auto
  return (
    <div className={`kit-field-row ${className}`}>
      <label className="kit-field-label" htmlFor={fid}>{label}</label>
      <span className={`kit-field ${surface}${error ? ' kit-field-bad' : ''}`}>
        <input
          id={fid}
          className="kit-field-input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
          {...rest}
        />
        {unit && <span className="kit-field-unit" aria-hidden="true">{unit}</span>}
      </span>
      {hint && !error && <span className="kit-field-hint" id={`${fid}-hint`}>{hint}</span>}
      {error && (
        <span className="kit-field-err" id={`${fid}-err`} role="alert">
          <Glyph piece="icon_set" face="cross" size={14} />
          {error}
        </span>
      )}
    </div>
  )
}

/* A progress bar. It fills to a real number, or slides back and forth when there's nothing to
 * count. */
export function Gauge({
  value, label, reading, className = '',
}: {
  /** A number from 0 to 1, or null when there's no real progress number to show. */
  value: number | null
  label: string
  /** The text printed inside the bar. */
  reading?: string
  className?: string
}) {
  const pct = value === null ? null : Math.max(0, Math.min(1, value))
  return (
    <div
      className={`kit-gauge ${useSurface('gauge')}${pct === null ? ' kit-gauge-waiting' : ''} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : Math.round(pct * 100)}
      aria-valuetext={pct === null ? 'Loading' : `${Math.round(pct * 100)} percent`}
    >
      <span className="kit-gauge-fill" style={pct === null ? undefined : { width: `${pct * 100}%` }} />
      {reading && <span className="kit-gauge-reading">{reading}</span>}
    </div>
  )
}

/* A socket is a slot where something can be dropped. When it can't take what's offered, it says why
 * in words. */
export function Socket({
  caption, filled, refusing, over, children, className = '', ...rest
}: {
  caption: string
  filled?: boolean
  /* Why this can't take what's being offered, in words. */
  refusing?: string | null
  /** Something is being dragged over it right now. */
  over?: boolean
  children?: ReactNode
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const state = filled ? 'filled' : refusing ? 'refusing' : over ? 'over' : 'empty'
  /* Play the deny sound once each time the reason changes, not on every render. */
  useEffect(() => { if (refusing) playUi('deny') }, [refusing])
  return (
    <button
      type="button"
      className={`kit-socket ${useSurface('socket')} ${className}`}
      data-state={state}
      aria-label={refusing ? `${caption}. ${refusing}` : caption}
      {...rest}
    >
      <span className="kit-socket-cap">{caption}</span>
      <span className="kit-socket-well">{children}</span>
      {refusing && (
        <span className="kit-socket-why">
          <Glyph piece="icon_set" face="cross" size={13} />
          {refusing}
        </span>
      )}
    </button>
  )
}

/* Where a portrait file lives, written in one place so no caller gets the path wrong. */
export const portraitUrl = (id: string): string => `/art/portraits/${id}.png`

/* Portraits that exist as drawings. They're loaded early so the game's first line of dialogue
 * doesn't show an empty frame. */
export const DRAWN_PORTRAITS = ['principal']

let warmed = false
export function warmPortraits() {
  if (warmed || typeof Image === 'undefined') return
  warmed = true
  for (const id of DRAWN_PORTRAITS) {
    const img = new Image()
    img.decoding = 'async'
    img.src = portraitUrl(id)
  }
}

/* The portrait frame: a drawn face with a caption under it. */
export function PortraitFrame({
  id, caption, className = '',
}: { id: string; caption?: string; className?: string }) {
  useKitReady()
  const src = portraitUrl(id)
  const surface = useSurface('portrait_frame')
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  return (
    <span className={`kit-portrait ${surface} ${className}`}>
      {!failed && (
        <img
          className="kit-portrait-pic"
          src={src}
          alt=""
          draggable={false}
          onError={() => {
            /* Name the missing file in the console. Hiding it silently would leave a scene with no
             * face and no clue why. */
            console.warn(`[kit] no portrait art at ${src}`)
            setFailed(true)
          }}
        />
      )}
      {caption && <span className="kit-portrait-cap">{caption}</span>}
    </span>
  )
}

/* Further down, Empty, Loading and Failed are what a panel shows when it's empty, still loading or
 * failed to load. */
/* A scrolling area inside a panel. It shows a "more below" cue while there's more to scroll to. */
export function Scroller({ className = '', wrapClassName = '', children, ...rest }: HTMLAttributes<HTMLDivElement> & { wrapClassName?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    check()
    el.addEventListener('scroll', check, { passive: true })
    /* Content can show up after the first paint, like a kit icon or a chart, so check again
     * whenever the size or children change. jsdom has neither observer, so in tests the cue keeps
     * its first value. */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(check) : null
    mo?.observe(el, { childList: true, subtree: true })
    return () => { el.removeEventListener('scroll', check); ro?.disconnect(); mo?.disconnect() }
  }, [])
  return (
    <div className={`kit-scrollwrap ${wrapClassName}`}>
      <div ref={ref} className={className} {...rest}>{children}</div>
      {more && (
        <span className="kit-morecue" aria-hidden="true">
          <span className="kit-morecue-caret" />
          more below
        </span>
      )}
    </div>
  )
}

export function Empty({ what, fills }: { what: string; fills: string }) {
  return (
    <div className="kit-empty" role="note">
      <Glyph piece="pointer" face="pin_tail" size={26} className="kit-empty-mark" />
      <p className="kit-empty-what">{what}</p>
      <p className="kit-empty-fills">{fills}</p>
    </div>
  )
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="kit-loading" role="status" aria-live="polite">
      <Gauge value={null} label={what} />
      <p className="kit-loading-what">{what}</p>
    </div>
  )
}

export function Failed({ what, retry }: { what: string; retry?: () => void }) {
  return (
    <div className="kit-failed" role="alert">
      <p className="kit-failed-what">
        <Glyph piece="icon_set" face="cross" size={16} />
        {what}
      </p>
      {retry && <Plank size="sm" onClick={retry}>Try again</Plank>}
    </div>
  )
}
