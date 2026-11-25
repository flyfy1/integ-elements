import { memo, useEffect, useRef } from 'react'
import { CATS, ELS, STATES, type El, type Lang, type State } from '../data'
import { t } from '../i18n'
import { StateIcon } from './Table'

// Piecewise-linear track (track % → °C) so everyday temperatures get the room.
const ANCH: [number, number][] = [[0, -273], [5, -200], [25, 0], [40, 100], [70, 1000], [90, 3500], [100, 5727]]
export function pctToC(p: number) {
  for (let i = 1; i < ANCH.length; i++) {
    const [p0, c0] = ANCH[i - 1], [p1, c1] = ANCH[i]
    if (p <= p1) return c0 + ((p - p0) / (p1 - p0)) * (c1 - c0)
  }
  return 5727
}
export function cToPct(c: number) {
  for (let i = 1; i < ANCH.length; i++) {
    const [p0, c0] = ANCH[i - 1], [p1, c1] = ANCH[i]
    if (c <= c1) return p0 + ((c - c0) / (c1 - c0)) * (p1 - p0)
  }
  return 100
}
export const snapC = (c: number) => (c < 100 ? Math.round(c) : c < 1000 ? Math.round(c / 5) * 5 : Math.round(c / 25) * 25)
const stepC = (c: number, dir: number) => snapC(c + dir * (c < 100 || (c === 100 && dir < 0) ? 1 : c < 1000 || (c === 1000 && dir < 0) ? 5 : 25))

export const TempSlider = memo(function TempSlider({ c, onChange, lang, counts }: { c: number; onChange: (c: number) => void; lang: Lang; counts: Record<State, number> }) {
  const track = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const pending = useRef<number | null>(null)
  const set = (v: number) => {
    pending.current = Math.max(-273, Math.min(5727, v))
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (pending.current != null) onChange(pending.current) })
  }
  const fromX = (x: number) => { const r = track.current!.getBoundingClientRect(); return snapC(pctToC(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)))) }
  const onDown = (ev: React.PointerEvent) => { (ev.target as HTMLElement).setPointerCapture(ev.pointerId); set(fromX(ev.clientX)) }
  const onMove = (ev: React.PointerEvent) => { if ((ev.target as HTMLElement).hasPointerCapture(ev.pointerId)) set(fromX(ev.clientX)) }
  const onKey = (ev: React.KeyboardEvent) => {
    const k = ev.key
    if (k === 'ArrowRight' || k === 'ArrowUp') set(stepC(c, 1))
    else if (k === 'ArrowLeft' || k === 'ArrowDown') set(stepC(c, -1))
    else if (k === 'PageUp') set(ANCH.map(a => a[1]).concat(25).sort((a, b) => a - b).find(a => a > c) ?? 5727)
    else if (k === 'PageDown') set(ANCH.map(a => a[1]).concat(25).sort((a, b) => b - a).find(a => a < c) ?? -273)
    else if (k === 'Home') set(-273)
    else if (k === 'End') set(5727)
    else return
    ev.preventDefault()
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const pct = cToPct(c)
  const kel = Math.round(c + 273.15)
  return (
    <div className="temp">
      <div className="temp-head">
        <span className="temp-lbl">{t(lang, 'temperature')}</span>
        <span className="temp-val"><b>{c.toLocaleString('en-US')} °C</b> <span className="muted">{kel.toLocaleString('en-US')} K</span></span>
        <span className="temp-counts" aria-live="polite">
          {STATES.map(s => <span key={s.id} className={`cnt s-${s.id}`}><StateIcon s={s.id} size={11} /> {lang === 'zh' ? s.zh : s.en.toLowerCase()} {counts[s.id]}</span>)}
        </span>
      </div>
      <div className="temp-track" ref={track} onPointerDown={onDown} onPointerMove={onMove}>
        <div className="temp-fill" style={{ transform: `scaleX(${pct / 100})` }} />
        {[[0, '−273'], [5, '−200'], [25, '0'], [40, '100'], [70, '1000'], [90, '3500'], [100, '5727']].map(([p, l]) => <span key={p} className="tick" style={{ left: `${p}%` }}><i />{l}</span>)}
        <span className="tick room" style={{ left: `${cToPct(25)}%` }}><i /></span>
        <div className="temp-thumb" role="slider" tabIndex={0} aria-label={`${t(lang, 'temperature')} °C`} aria-valuemin={-273} aria-valuemax={5727} aria-valuenow={c} aria-valuetext={`${c} °C, ${kel} K`}
          onKeyDown={onKey} style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
})

export function Legend({ lang, cats, toggle }: { lang: Lang; cats: Set<number>; toggle: (i: number) => void }) {
  return (
    <div className="legend" role="group" aria-label={t(lang, 'legend')}>
      {CATS.map((c, i) => (
        <button key={c.id} type="button" className={`chip${cats.has(i) ? ' on' : ''}${cats.size && !cats.has(i) ? ' off' : ''}`} aria-pressed={cats.has(i)} onClick={() => toggle(i)} style={{ ['--c' as string]: c.hex }}>
          <i />{lang === 'zh' ? c.zh : c.en}
        </button>
      ))}
    </div>
  )
}

export function StateChips({ lang, states, toggle }: { lang: Lang; states: Set<State>; toggle: (s: State) => void }) {
  return (
    <div className="legend" role="group" aria-label={t(lang, 'state')}>
      {STATES.map(s => (
        <button key={s.id} type="button" className={`chip st${states.has(s.id) ? ' on' : ''}${states.size && !states.has(s.id) ? ' off' : ''}`} aria-pressed={states.has(s.id)} onClick={() => toggle(s.id)} style={{ ['--c' as string]: s.hex }}>
          <StateIcon s={s.id} size={11} />{lang === 'zh' ? s.zh : s.en}
        </button>
      ))}
    </div>
  )
}

/** Phone mini-map: the whole table at 18 × 12 px cells with a rectangle for the visible part. */
export function MiniMap({ dim, scroller, sel, pulse }: { dim: (e: El) => boolean; scroller: React.RefObject<HTMLDivElement | null>; sel: number | null; pulse: number }) {
  const svg = useRef<SVGSVGElement>(null)
  const rect = useRef<SVGRectElement>(null)
  const W = 18, H = 11.4
  useEffect(() => {
    const s = scroller.current
    if (!s) return
    const upd = () => {
      const r = rect.current
      if (!r) return
      const total = s.scrollWidth, vis = s.clientWidth
      r.setAttribute('x', String((s.scrollLeft / total) * W * 18))
      r.setAttribute('width', String(Math.min(1, vis / total) * W * 18))
      const band = s.parentElement
      band?.style.setProperty('--fl', s.scrollLeft > 4 ? '1' : '0')
      band?.style.setProperty('--fr', s.scrollLeft + vis < total - 4 ? '1' : '0')
    }
    upd()
    s.addEventListener('scroll', upd, { passive: true })
    window.addEventListener('resize', upd)
    return () => { s.removeEventListener('scroll', upd); window.removeEventListener('resize', upd) }
  }, [scroller])
  const jump = (clientX: number, smooth: boolean) => {
    const s = scroller.current, g = svg.current
    if (!s || !g) return
    const r = g.getBoundingClientRect()
    const f = (clientX - r.left) / r.width
    s.scrollTo({ left: f * s.scrollWidth - s.clientWidth / 2, behavior: smooth ? 'smooth' : 'auto' })
  }
  const dragging = useRef(false)
  return (
    <svg ref={svg} className="minimap" viewBox={`0 0 ${W * 18} ${H * 10}`} role="img" aria-label="Table overview"
      onPointerDown={ev => { dragging.current = true; (ev.target as Element).setPointerCapture?.(ev.pointerId); jump(ev.clientX, true) }}
      onPointerMove={ev => dragging.current && jump(ev.clientX, false)}
      onPointerUp={() => (dragging.current = false)}>
      {ELS.map(e => {
        const r = e.row >= 8 ? e.row + 0.35 : e.row - 1
        return <rect key={e.z} x={(e.col - 1) * W + 1} y={r * H + 1} width={W - 2} height={H - 2} rx={2} fill={CATS[e.c].hex}
          opacity={dim(e) ? 0.14 : 0.78} className={e.z === sel ? `mm-sel p${pulse % 2}` : undefined} />
      })}
      <rect ref={rect} className="mm-view" x={0} y={0.5} width={100} height={H * 10 - 1} rx={4} />
    </svg>
  )
}
