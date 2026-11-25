import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react'
import { CATS, ELS, type Accent, type El, type Lang, type State } from '../data'

export type TableHandle = { ripple: (z: number) => void; tile: (z: number) => HTMLButtonElement | null; focus: (z: number) => void; mark: (z: number, cls: string, ms: number) => void; shimmer: (zs: number[]) => void }

type Props = {
  lang: Lang
  accent: Accent
  selected: number | null
  dim: (e: El) => boolean
  states: Record<number, State>
  heard: Record<number, number>
  glow: Set<number>
  stage?: ReactNode
  onActivate: (e: El, tile: HTMLButtonElement, how: 'pointer' | 'key') => void
  onIntent: (e: El) => void
  onKey?: (e: El, ev: React.KeyboardEvent) => boolean
  phone: boolean
}

const fine = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches
const reduced = () => document.documentElement.classList.contains('reduce')

const STATE_ICON: Record<State, string> = {
  solid: 'M2 8h6v-6h-6z',
  liquid: 'M5 1.5c1.8 2.4 3 3.9 3 5.4a3 3 0 0 1-6 0c0-1.5 1.2-3 3-5.4z',
  gas: 'M1.5 6.2c1.5-1.6 2.5 1.6 4 0s2.5 1.6 4 0M1.5 3.2c1.5-1.6 2.5 1.6 4 0s2.5 1.6 4 0',
  unknown: 'M3.6 3.4a1.6 1.6 0 1 1 2 1.6c-.5.2-.6.5-.6 1M5 8.2v.1',
}
export function StateIcon({ s, size = 10 }: { s: State; size?: number }) {
  return (
    <svg className={`sicon s-${s}`} width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
      <path d={STATE_ICON[s]} fill={s === 'solid' || s === 'liquid' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={s === 'solid' || s === 'liquid' ? 0 : 1.2} strokeLinecap="round" />
    </svg>
  )
}

const Tile = memo(function Tile({ el, lang, dim, sel, heard, state, glow, accent }: { el: El; lang: Lang; dim: boolean; sel: boolean; heard: boolean; state: State; glow: boolean; accent: Accent }) {
  const cat = CATS[el.c]
  const nm = accent === 'us' ? el.us : el.uk
  return (
    <button
      type="button"
      className={`tile${dim ? ' dim' : ''}${sel ? ' sel' : ''}${glow ? ' found' : ''}`}
      data-z={el.z}
      data-state={state}
      style={{ gridColumn: el.col, gridRow: el.row >= 8 ? el.row + 1 : el.row, ['--c' as string]: cat.hex, ['--d' as string]: `${(el.col + el.row) * 12}ms` }}
      aria-label={`${lang === 'zh' ? el.zh + '，' : ''}${el.us !== el.uk ? `${el.uk} (${el.us})` : el.n}, ${el.s}, ${lang === 'zh' ? '原子序数' : 'atomic number'} ${el.z}, ${lang === 'zh' ? cat.zh : cat.en.toLowerCase()}`}
      tabIndex={-1}
    >
      <span className="glow" aria-hidden="true" />
      <span className="face" aria-hidden="true">
        <span className="num">{el.z}</span>
        <span className="sym">{el.s}</span>
        <span className={`nm${nm.length > 9 ? ' long' : ''}`} lang="en">{nm}</span>
        <span className="bar" />
        {heard ? <span className="dot" /> : null}
      </span>
    </button>
  )
})

export const Table = forwardRef<TableHandle, Props>(function Table(p, ref) {
  const root = useRef<HTMLDivElement>(null)
  const rip = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const focusZ = useRef<number>(p.selected ?? 1)
  const tileOf = (z: number) => root.current?.querySelector<HTMLButtonElement>(`.tile[data-z="${z}"]`) ?? null

  useImperativeHandle(ref, () => ({
    tile: tileOf,
    focus: (z: number) => { setRoving(z); tileOf(z)?.focus() },
    ripple: (z: number) => {
      const t = tileOf(z), box = rip.current, host = root.current
      if (!t || !box || !host) return
      const hr = host.getBoundingClientRect(), tr = t.getBoundingClientRect()
      box.style.setProperty('--x', `${tr.left - hr.left + tr.width / 2 + host.scrollLeft}px`)
      box.style.setProperty('--y', `${tr.top - hr.top + tr.height / 2}px`)
      box.style.setProperty('--s', `${Math.max(tr.width, tr.height)}px`)
      box.style.setProperty('--c', CATS[ELS[z - 1].c].hex)
      box.classList.remove('go'); void box.offsetWidth; box.classList.add('go')
      t.classList.remove('playing'); void t.offsetWidth; t.classList.add('playing')
      setTimeout(() => t.classList.remove('playing'), 900)
    },
    mark: (z: number, cls: string, ms: number) => {
      const t = tileOf(z); if (!t) return
      t.classList.remove(cls); void t.offsetWidth; t.classList.add(cls)
      setTimeout(() => t.classList.remove(cls), ms)
    },
    shimmer: (zs: number[]) => {
      if (reduced()) return
      for (const z of zs) { const t = tileOf(z); if (!t) continue; t.classList.remove('shimmer'); void t.offsetWidth; t.classList.add('shimmer'); setTimeout(() => t.classList.remove('shimmer'), 320) }
    },
  }))

  const setRoving = (z: number) => {
    const prev = tileOf(focusZ.current)
    if (prev) prev.tabIndex = -1
    focusZ.current = z
    const t = tileOf(z)
    if (t) t.tabIndex = 0
  }
  useEffect(() => { setRoving(p.selected ?? focusZ.current) }) // keep exactly one tile tabbable

  // ---- pointer effects (imperative: CSS variables in rAF, never React state) ----
  const hoverT = useRef<HTMLButtonElement | null>(null)
  const onMove = useCallback((ev: React.PointerEvent) => {
    if (!fine || reduced() || ev.pointerType !== 'mouse') return
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tile')
    if (hoverT.current && hoverT.current !== t) { hoverT.current.classList.remove('hover'); hoverT.current.style.willChange = '' }
    if (!t) { hoverT.current = null; return }
    if (hoverT.current !== t) { hoverT.current = t; t.style.willChange = 'transform'; t.classList.add('hover'); p.onIntent(ELS[Number(t.dataset.z) - 1]) }
    const r = t.getBoundingClientRect()
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      t.style.setProperty('--rx', `${((0.5 - y) * 20).toFixed(2)}deg`)
      t.style.setProperty('--ry', `${((x - 0.5) * 20).toFixed(2)}deg`)
      t.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
      t.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
    })
  }, [p])
  const onLeave = useCallback(() => {
    const t = hoverT.current
    if (t) { t.classList.remove('hover'); t.style.removeProperty('--rx'); t.style.removeProperty('--ry'); t.style.willChange = '' }
    hoverT.current = null
  }, [])

  const pressT = useRef<HTMLButtonElement | null>(null)
  const onDown = useCallback((ev: React.PointerEvent) => {
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tile')
    if (!t) return
    const el = ELS[Number(t.dataset.z) - 1]
    p.onIntent(el)
    if (ev.pointerType !== 'mouse' && !reduced()) {
      const r = t.getBoundingClientRect()
      const x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5
      t.style.setProperty('--rx', `${(-y * 16).toFixed(1)}deg`)
      t.style.setProperty('--ry', `${(x * 16).toFixed(1)}deg`)
      t.style.willChange = 'transform'
      t.classList.add('press')
    } else t.classList.add('press-m')
    pressT.current = t
  }, [p])
  const release = useCallback(() => {
    const t = pressT.current
    if (!t) return
    t.classList.remove('press', 'press-m')
    t.style.removeProperty('--rx'); t.style.removeProperty('--ry')
    setTimeout(() => { if (!t.classList.contains('hover')) t.style.willChange = '' }, 300)
    pressT.current = null
  }, [])
  const onClick = useCallback((ev: React.MouseEvent) => {
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tile')
    if (!t) return
    const el = ELS[Number(t.dataset.z) - 1]
    setRoving(el.z)
    const touch = (ev.nativeEvent as PointerEvent).pointerType && (ev.nativeEvent as PointerEvent).pointerType !== 'mouse'
    if (touch && !reduced()) {
      t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop')
      setTimeout(() => t.classList.remove('pop'), 260)
      navigator.vibrate?.(8)
      // the eight neighbours nudge outward: a small shock wave
      let i = 0
      for (const n of ELS) {
        const dc = n.col - el.col, dr = (n.row >= 8 ? n.row + 1 : n.row) - (el.row >= 8 ? el.row + 1 : el.row)
        if ((dc || dr) && Math.abs(dc) <= 1 && Math.abs(dr) <= 1) {
          const nt = tileOf(n.z)
          if (!nt) continue
          nt.style.setProperty('--nx', `${dc * 2}px`); nt.style.setProperty('--ny', `${dr * 2}px`)
          nt.style.setProperty('--nd', `${30 * i++}ms`)
          nt.classList.remove('nudge'); void nt.offsetWidth; nt.classList.add('nudge')
          setTimeout(() => nt.classList.remove('nudge'), 420)
        }
      }
    }
    p.onActivate(el, t, ev.detail === 0 ? 'key' : 'pointer')
  }, [p])

  // ---- keyboard: arrows move to the nearest tile, skipping gaps ----
  const onKeyDown = useCallback((ev: React.KeyboardEvent) => {
    const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tile')
    if (!t) return
    const el = ELS[Number(t.dataset.z) - 1]
    if (p.onKey?.(el, ev)) return
    const gr = (e: El) => (e.row >= 8 ? e.row + 1 : e.row)
    let best: El | null = null
    const pick = (cands: El[], score: (e: El) => number) => cands.reduce<El | null>((b, e) => (b === null || score(e) < score(b) ? e : b), null)
    if (ev.key === 'ArrowRight') best = pick(ELS.filter(e => gr(e) === gr(el) && e.col > el.col), e => e.col)
    else if (ev.key === 'ArrowLeft') best = pick(ELS.filter(e => gr(e) === gr(el) && e.col < el.col), e => -e.col)
    else if (ev.key === 'ArrowDown') best = pick(ELS.filter(e => gr(e) > gr(el)), e => (gr(e) - gr(el)) * 100 + Math.abs(e.col - el.col))
    else if (ev.key === 'ArrowUp') best = pick(ELS.filter(e => gr(e) < gr(el)), e => (gr(el) - gr(e)) * 100 + Math.abs(e.col - el.col))
    else if (ev.key === 'Home') best = pick(ELS.filter(e => gr(e) === gr(el)), e => e.col)
    else if (ev.key === 'End') best = pick(ELS.filter(e => gr(e) === gr(el)), e => -e.col)
    else return
    ev.preventDefault()
    if (best) { setRoving(best.z); const bt = tileOf(best.z); bt?.focus(); bt?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); p.onIntent(best) }
  }, [p])

  return (
    <div
      ref={root}
      className="ptable"
      role="grid"
      aria-label="Periodic table"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerUp={release}
      onPointerCancel={release}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={ev => { const t = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tile'); if (t) p.onIntent(ELS[Number(t.dataset.z) - 1]) }}
    >
      {ELS.map(el => (
        <Tile key={el.z} el={el} lang={p.lang} dim={p.dim(el)} sel={p.selected === el.z} heard={!!p.heard[el.z]} state={p.states[el.z]} glow={p.glow.has(el.z)} accent={p.accent} />
      ))}
      <div className="ph" style={{ gridColumn: 3, gridRow: 6 }} aria-hidden="true"><span>57–71</span></div>
      <div className="ph" style={{ gridColumn: 3, gridRow: 7 }} aria-hidden="true"><span>89–103</span></div>
      <div className="fconn" aria-hidden="true" />
      {p.stage && !p.phone ? <div className="stage-slot">{p.stage}</div> : null}
      <div ref={rip} className="ripple" aria-hidden="true"><i /><i /></div>
    </div>
  )
})
