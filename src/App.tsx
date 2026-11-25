import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BY_SLUG, BY_Z, ELS, search, stateAt, type Accent, type El, type Lang, type State } from './data'
import { t } from './i18n'
import * as audio from './audio'
import * as store from './store'
import { pageView, track, bucketMs, type Page } from './analytics'
import { Table, type TableHandle } from './components/Table'
import { Stage, AccentSwitch, PlayIcon, SlowIcon, HookChip, Specimen, warmPicture } from './components/Stage'
import { Detail } from './components/Detail'
import { Legend, StateChips, TempSlider, MiniMap } from './components/Controls'
import { Tricky, About, Practice } from './components/Views'
import type { QuizHandle } from './components/Quiz'

const Quiz = lazy(() => import('./components/Quiz'))
type Mode = 'explore' | 'quiz' | 'tricky' | 'practice' | 'about'
type Route = { lang: Lang; mode: Mode; slug: string | null }

function parse(path: string): Route {
  const zh = path.startsWith('/zh/') || path === '/zh'
  const rest = path.replace(/^\/zh/, '').replace(/^\/+|\/+$/g, '')
  const [a, b] = rest.split('/')
  if (a === 'element' && b && BY_SLUG.has(b)) return { lang: zh ? 'zh' : 'en', mode: 'explore', slug: BY_SLUG.get(b)!.slug }
  if (a === 'quiz' || a === 'tricky' || a === 'practice' || a === 'about') return { lang: zh ? 'zh' : 'en', mode: a, slug: null }
  return { lang: zh ? 'zh' : 'en', mode: 'explore', slug: null }
}
const pathFor = (r: Route) => (r.lang === 'zh' ? '/zh' : '') + (r.slug ? `/element/${r.slug}/` : r.mode !== 'explore' ? `/${r.mode}/` : '/')
const PAGE: Record<Mode, Page> = { explore: 'Table', quiz: 'Quiz', tricky: 'Tricky', practice: 'Repeat', about: 'About' }
const useMQ = (q: string) => {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => { const mm = matchMedia(q); const f = () => setM(mm.matches); mm.addEventListener('change', f); return () => mm.removeEventListener('change', f) }, [q])
  return m
}

export default function App() {
  const init = useMemo(() => parse(location.pathname), [])
  const prog0 = useMemo(() => store.load(), [])
  const [lang, setLang] = useState<Lang>(init.lang)
  const [mode, setMode] = useState<Mode>(init.mode)
  const [accent, setAccent] = useState<Accent>(prog0.accent ?? (navigator.language === 'en-GB' ? 'uk' : 'us'))
  const [sel, setSel] = useState<number | null>(init.slug ? BY_SLUG.get(init.slug)!.z : null)
  const [detail, setDetail] = useState<{ z: number; origin: DOMRect | null } | null>(init.slug ? { z: BY_SLUG.get(init.slug)!.z, origin: null } : null)
  const [prog, setProg] = useState(prog0)
  const [cats, setCats] = useState<Set<number>>(new Set())
  const [stF, setStF] = useState<Set<State>>(new Set())
  const [mine, setMine] = useState(false)
  const [tempC, setTempC] = useState(25)
  const [q, setQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sheet, setSheet] = useState<'' | 'filter' | 'more'>('')
  const [help, setHelp] = useState(false)
  const [pulse, setPulse] = useState(0)
  const [reduce, setReduce] = useState(!!prog0.reduce)
  const phone = useMQ('(max-width: 599px)')
  const table = useRef<TableHandle>(null)
  const quiz = useRef<QuizHandle>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pushedDetail = useRef(false)
  const firstSound = useRef(false)

  // ---- persistence, html lang, reduce motion ----
  useEffect(() => { store.save({ ...prog, accent, lang, reduce }) }, [prog, accent, lang, reduce])
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en' }, [lang])
  useEffect(() => {
    const sys = matchMedia('(prefers-reduced-motion: reduce)')
    const f = () => document.documentElement.classList.toggle('reduce', reduce || sys.matches)
    f(); sys.addEventListener('change', f); return () => sys.removeEventListener('change', f)
  }, [reduce])
  useEffect(() => { // pause CSS animation while hidden
    const f = () => document.documentElement.classList.toggle('hidden-tab', document.hidden)
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f)
  }, [])
  // first visit to "/" from a Chinese browser → /zh/
  useEffect(() => {
    if (location.pathname === '/' && !prog0.lang && /^zh\b/i.test(navigator.language)) { setLang('zh'); history.replaceState(null, '', '/zh/' + location.search) }
  }, [prog0.lang])

  // ---- routing ----
  const route = useCallback((r: Partial<Route>, replace = false) => {
    const next: Route = { lang, mode, slug: null, ...r }
    const p = pathFor(next)
    if (p !== location.pathname) (replace ? history.replaceState : history.pushState).call(history, null, '', p + location.search)
  }, [lang, mode])
  useEffect(() => {
    const r = parse(location.pathname)
    pageView(r.slug ? 'Element' : PAGE[r.mode], location.pathname)
    const onPop = () => {
      const r2 = parse(location.pathname)
      setLang(r2.lang); setMode(r2.mode)
      if (r2.slug) { const z = BY_SLUG.get(r2.slug)!.z; setSel(z); setDetail({ z, origin: null }) } else setDetail(null)
      pushedDetail.current = false
      pageView(r2.slug ? 'Element' : PAGE[r2.mode], location.pathname)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const go = (m: Mode) => {
    if (m === mode) return
    setMode(m); setDetail(null); setSheet('')
    route({ mode: m }); pageView(PAGE[m], pathFor({ lang, mode: m, slug: null }))
    if (m === 'tricky') track('tricky_open')
  }
  const switchLang = () => {
    const l: Lang = lang === 'en' ? 'zh' : 'en'
    setLang(l); route({ lang: l, slug: detail ? BY_Z.get(detail.z)!.slug : null }, true); track('lang_switch', { to: l })
  }
  const switchAccent = (a: Accent) => {
    if (a === accent) return
    setAccent(a); track('accent_switch', { to: a })
    if (firstSound.current) audio.prefetchAll(a)
  }

  // ---- playing ----
  const playEl = useCallback((el: El, a: Accent, k: audio.Kind, from: string, t0?: number) => {
    audio.unlock()
    window.dispatchEvent(new Event('el-play'))
    const cached = audio.isCached(el.slug, a, k)
    void audio.play(el.slug, a, k, { t0 }).then(ms => {
      if (ms != null && !firstSound.current) { firstSound.current = true; track('first_sound', { ms: bucketMs(ms), cached: cached ? 1 : 0 }, { onceKey: 'fs' }) }
      if (!firstSound.current) firstSound.current = true
      audio.prefetchAll(a)
    })
    window.dispatchEvent(new Event('el-play'))
    track('audio_play', { element: el.s, accent: a, kind: k, from }, { cap: 60 })
    if (k === 'name') setProg(p => {
      const heard = { ...p.heard, [el.z]: (p.heard[el.z] ?? 0) + 1 }
      const n = Object.keys(heard).length, n0 = Object.keys(p.heard).length
      for (const m of [10, 50, 118]) if (n >= m && n0 < m) track('progress_milestone', { n: m })
      return { ...p, heard }
    })
  }, [])

  const openDetail = useCallback((z: number, origin: DOMRect | null) => {
    setSel(z); setDetail({ z, origin })
    const el = BY_Z.get(z)!
    route({ mode: 'explore', slug: el.slug }); pushedDetail.current = true
    pageView('Element', pathFor({ lang, mode: 'explore', slug: el.slug }))
    track('detail_open', { element: el.s })
    if (mode !== 'explore') setMode('explore')
  }, [route, lang, mode])
  const closeDetail = useCallback(() => {
    setDetail(null)
    if (pushedDetail.current) { pushedDetail.current = false; history.back() } else route({ mode: 'explore', slug: null }, true)
    setTimeout(() => sel && table.current?.focus(sel), 0)
  }, [route, sel])

  const tapT0 = useRef(0)
  useEffect(() => { const f = () => (tapT0.current = performance.now()); window.addEventListener('pointerup', f, true); window.addEventListener('keydown', f, true); return () => { window.removeEventListener('pointerup', f, true); window.removeEventListener('keydown', f, true) } }, [])

  const onActivate = useCallback((el: El, tile: HTMLButtonElement, how: 'pointer' | 'key') => {
    audio.unlock()
    if (mode === 'quiz' && quiz.current?.active()) { quiz.current.answer(el); return }
    if (sel === el.z && how === 'pointer' && mode === 'explore') { openDetail(el.z, tile.getBoundingClientRect()); return }
    setSel(el.z)
    setPulse(p => p + 1)
    table.current?.ripple(el.z)
    playEl(el, accent, 'name', 'tile', tapT0.current || performance.now())
  }, [mode, sel, accent, openDetail, playEl])
  const onIntent = useCallback((el: El) => { void audio.load(el.slug, accent, 'name'); warmPicture(el) }, [accent])
  const onKey = useCallback((el: El, ev: React.KeyboardEvent) => {
    const k = ev.key.toLowerCase()
    if (ev.key === ' ' ) { ev.preventDefault(); setSel(el.z); table.current?.ripple(el.z); playEl(el, accent, 'name', 'tile', performance.now()); return true }
    if (k === 's' && !ev.metaKey && !ev.ctrlKey) { setSel(el.z); playEl(el, accent, 'slow', 'tile'); return true }
    if (k === 'e' && !ev.metaKey && !ev.ctrlKey && el.a[accent === 'us' ? 0 : 1] & 4) { setSel(el.z); playEl(el, accent, 'sentence', 'tile'); return true }
    if (ev.key === 'Enter') { ev.preventDefault(); if (mode === 'quiz' && quiz.current?.active()) quiz.current.answer(el); else openDetail(el.z, table.current?.tile(el.z)?.getBoundingClientRect() ?? null); return true }
    return false
  }, [accent, playEl, openDetail, mode])

  // global keys: / search, ? help, A accent, Esc
  useEffect(() => {
    const f = (ev: KeyboardEvent) => {
      const tgt = ev.target as HTMLElement
      if (tgt.closest('input,textarea')) { if (ev.key === 'Escape') { setQ(''); setSearchOpen(false); (tgt as HTMLInputElement).blur() } return }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      if (ev.key === '/') { ev.preventDefault(); setSearchOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>('.search input')?.focus(), 0) }
      else if (ev.key === '?') setHelp(h => !h)
      else if (ev.key.toLowerCase() === 'a' && !detail) switchAccent(accent === 'us' ? 'uk' : 'us')
      else if (ev.key === 'Escape') { setHelp(false); setSheet('') }
    }
    window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f)
  })

  // ---- temperature states, filters, search ----
  const states = useMemo(() => { const k = tempC + 273.15; const o: Record<number, State> = {}; for (const e of ELS) o[e.z] = stateAt(e, k); return o }, [tempC])
  const prevStates = useRef(states)
  useEffect(() => {
    const changed = ELS.filter(e => prevStates.current[e.z] !== states[e.z]).map(e => e.z)
    prevStates.current = states
    if (changed.length && changed.length < 60) table.current?.shimmer(changed)
  }, [states])
  const counts = useMemo(() => { const c: Record<State, number> = { solid: 0, liquid: 0, gas: 0, unknown: 0 }; for (const e of ELS) c[states[e.z]]++; return c }, [states])
  const results = useMemo(() => search(q), [q])
  const glow = useMemo(() => new Set(results.map(e => e.z)), [results])
  const starred = useMemo(() => new Set(prog.starred), [prog.starred])
  const dim = useCallback((e: El) => (cats.size > 0 && !cats.has(e.c)) || (stF.size > 0 && !stF.has(states[e.z])) || (mine && !starred.has(e.z)) || (q.trim() !== '' && results.length > 0 && !glow.has(e.z)), [cats, stF, states, mine, starred, q, results, glow])
  const filtersOn = cats.size > 0 || stF.size > 0 || tempC !== 25 || mine
  const usedFilter = useRef(new Set<string>())
  const useF = (type: string) => { if (!usedFilter.current.has(type)) { usedFilter.current.add(type); track('filter_use', { type }) } }
  const resetFilters = () => { setCats(new Set()); setStF(new Set()); setTempC(25); setMine(false) }
  const toggleCat = (i: number) => { useF('category'); setCats(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n }) }
  const toggleSt = (s: State) => { useF('state'); setStF(x => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n }) }
  const onTemp = useCallback((c: number) => { useF('temperature'); setTempC(c) }, [])
  const searchSent = useRef('')
  useEffect(() => {
    if (!q.trim()) return
    const id = setTimeout(() => { const key = `${q.trim().length > 0}-${results.length > 0}`; if (searchSent.current !== key) { searchSent.current = key; track('search_use', { found: results.length ? 1 : 0 }) } }, 800)
    if (phone && results[0]) table.current?.tile(results[0].z)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    return () => clearTimeout(id)
  }, [q, results, phone])
  const pickResult = (el: El) => {
    setQ(''); setSearchOpen(false)
    setSel(el.z); table.current?.ripple(el.z)
    table.current?.tile(el.z)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    playEl(el, accent, 'name', 'tile', performance.now())
    setTimeout(() => table.current?.focus(el.z), 50)
  }

  const heardN = Object.keys(prog.heard).length
  const selEl = sel ? BY_Z.get(sel)! : null
  const resetProgress = () => { if (confirm(t(lang, 'resetConfirm'))) setProg({ heard: {}, starred: [], quiz: {}, best: {} }) }
  const onScore = (set: string, score: number, missed: number[], right: number[], streak: number) => setProg(p => {
    const quizS = { ...p.quiz }
    for (const z of right) quizS[z] = { right: (quizS[z]?.right ?? 0) + 1, wrong: quizS[z]?.wrong ?? 0 }
    for (const z of missed) quizS[z] = { right: quizS[z]?.right ?? 0, wrong: (quizS[z]?.wrong ?? 0) + 1 }
    return { ...p, quiz: quizS, best: { ...p.best, [set]: Math.max(score, p.best[set] ?? 0) }, bestStreak: Math.max(streak, p.bestStreak ?? 0) }
  })

  // ---- pieces ----
  const stage = <Stage el={selEl} lang={lang} accent={accent} onAccent={switchAccent} onDetails={() => sel && openDetail(sel, table.current?.tile(sel)?.getBoundingClientRect() ?? null)}
    onPlay={(k, from) => selEl && playEl(selEl, accent, k, from, performance.now())} />
  const searchBox = (
    <div className={`search${searchOpen ? ' open' : ''}`} role="search">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      <input type="search" value={q} placeholder={t(lang, phone ? 'searchShort' : 'search')} aria-label={t(lang, 'search')} enterKeyHint="go"
        onChange={ev => setQ(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter' && results[0]) pickResult(results[0]) }} onBlur={() => setTimeout(() => !q && setSearchOpen(false), 150)} />
      {q.trim() ? (
        <ul className="results" role="listbox">
          {results.length ? results.map(e => (
            <li key={e.z} role="option" aria-selected={false}><button type="button" onMouseDown={ev => ev.preventDefault()} onClick={() => pickResult(e)} style={{ ['--c' as string]: ['#FF6B6B', '#FF9F43', '#FFD43B', '#A3B8CC', '#2DD4BF', '#7EE787', '#38BDF8', '#A78BFA', '#F472B6', '#D946EF'][e.c] }}>
              <span className="sym-chip">{e.s}</span><span className="r-n" lang="en">{e.us !== e.uk ? `${e.uk} / ${e.us}` : e.n}</span><span className="r-z">{e.z}</span><span className="zh-ch">{e.zh}</span><span className="muted">{e.py}</span>
            </button></li>
          )) : <li className="empty">{t(lang, 'noMatch')}</li>}
        </ul>
      ) : null}
    </div>
  )
  const tabs = (
    <nav className="tabs" aria-label="Mode">
      {(['explore', 'quiz', 'tricky', 'practice'] as Mode[]).map(m => (
        <a key={m} href={pathFor({ lang, mode: m, slug: null })} className={mode === m ? 'on' : ''} aria-current={mode === m ? 'page' : undefined} onClick={ev => { ev.preventDefault(); go(m) }}>{t(lang, m as 'explore')}</a>
      ))}
    </nav>
  )
  const heardBar = (
    <div className="heard" title={`${heardN} / 118 ${t(lang, 'heard')}`}>
      <span>{heardN} / 118 {t(lang, 'heard')}</span>
      <i><b style={{ transform: `scaleX(${heardN / 118})` }} /></i>
    </div>
  )
  const tableEl = (
    <Table ref={table} lang={lang} accent={accent} selected={sel} dim={dim} states={states} heard={prog.heard} glow={q.trim() ? glow : EMPTY} stage={mode === 'explore' ? stage : quizSlot()} onActivate={onActivate} onIntent={onIntent} onKey={onKey} phone={phone} />
  )
  function quizSlot() {
    return <div className="stage quiz-stage"><Suspense fallback={null}><Quiz ref={quiz} lang={lang} accent={accent} table={table} best={prog.best} onScore={onScore} phone={phone} /></Suspense></div>
  }
  const showTable = mode === 'explore' || mode === 'quiz'
  const det = detail ? BY_Z.get(detail.z)! : null
  const detailEl = det ? (
    <Detail key="detail" el={det} lang={lang} accent={accent} phone={phone} origin={detail!.origin} state={stateAt(det, 298.15)} starred={starred.has(det.z)}
      onClose={closeDetail} onNav={z => { setDetail({ z, origin: null }); setSel(z); route({ slug: BY_Z.get(z)!.slug }, true) }}
      onPlay={(el, a, k, from) => playEl(el, a, k, from, performance.now())}
      onStar={() => setProg(p => ({ ...p, starred: p.starred.includes(det.z) ? p.starred.filter(z => z !== det.z) : [...p.starred, det.z] }))} />
  ) : null
  const links = (
    <div className="ctl-links">
      <a href={lang === 'zh' ? '/zh/about/' : '/about/'} onClick={ev => { ev.preventDefault(); go('about') }}>{t(lang, 'about')}</a>
      <label className="tog"><input type="checkbox" checked={reduce} onChange={ev => setReduce(ev.target.checked)} /> {t(lang, 'reduce')}</label>
      <button type="button" className="linkish" onClick={() => setHelp(true)}>{t(lang, 'shortcuts')} <kbd>?</kbd></button>
    </div>
  )
  const controls = (
    <div className="controls">
      <div className="ctl-row">
        <Legend lang={lang} cats={cats} toggle={toggleCat} />
      </div>
      <div className="ctl-row two">
        <StateChips lang={lang} states={stF} toggle={toggleSt} />
        <TempSlider c={tempC} onChange={onTemp} lang={lang} counts={counts} />
        <div className="ctl-end">
          {prog.starred.length ? <button type="button" className={`chip${mine ? ' on' : ''}`} aria-pressed={mine} onClick={() => setMine(m => !m)}>★ {t(lang, 'myList')} {prog.starred.length}</button> : null}
          <button type="button" className="chip" disabled={!filtersOn} onClick={resetFilters}>{t(lang, 'reset')}</button>
          {links}
        </div>
      </div>
    </div>
  )

  if (phone) {
    return (
      <div className={`app phone mode-${mode}`}>
        <header className="p-head">
          <a className="logo" href={lang === 'zh' ? '/zh/' : '/'} onClick={ev => { ev.preventDefault(); go('explore') }} aria-label={t(lang, 'title')}><LogoMark /></a>
          {tabs}
          <button type="button" className="icon-btn" aria-label={t(lang, 'searchShort')} onClick={() => { setSearchOpen(true); setTimeout(() => document.querySelector<HTMLInputElement>('.search input')?.focus(), 0) }}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className={`icon-btn${filtersOn ? ' dot' : ''}`} aria-label={t(lang, 'filters')} aria-expanded={sheet === 'filter'} onClick={() => setSheet(s => (s === 'filter' ? '' : 'filter'))}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className="icon-btn" aria-label={t(lang, 'more')} aria-expanded={sheet === 'more'} onClick={() => setSheet(s => (s === 'more' ? '' : 'more'))}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
          </button>
          {searchOpen ? <div className="p-search">{searchBox}<button type="button" className="linkish" onClick={() => { setQ(''); setSearchOpen(false) }}>{t(lang, 'close')}</button></div> : null}
        </header>
        {showTable ? (
          <>
            <div className="p-mini"><MiniMap dim={dim} scroller={scroller} sel={sel} pulse={pulse} /></div>
            <div className="p-band">
              <div className="p-scroll" ref={scroller}>{tableEl}</div>
            </div>
            <div className="p-bar">
              {mode === 'quiz' ? quizSlot() : <PhoneBar el={selEl} lang={lang} accent={accent} onPlay={k => selEl && playEl(selEl, accent, k, 'stage', performance.now())} onOpen={() => sel && openDetail(sel, table.current?.tile(sel)?.getBoundingClientRect() ?? null)} heardN={heardN} />}
            </div>
          </>
        ) : (
          <main className="p-page">{mode === 'tricky' ? <Tricky lang={lang} accent={accent} onPlay={e => playEl(e, accent, 'name', 'tricky', performance.now())} onOpen={e => openDetail(e.z, null)} /> : mode === 'practice' ? <Practice lang={lang} accent={accent} onAccent={switchAccent} onPlay={(e, k) => playEl(e, accent, k, 'practice', performance.now())} onOpen={e => openDetail(e.z, null)} /> : <About lang={lang} onReset={resetProgress} />}</main>
        )}
        {sheet ? <div className="p-scrim" onClick={() => setSheet('')} /> : null}
        <div className={`p-sheet${sheet ? ' open' : ''}`} aria-hidden={!sheet}>
          {sheet === 'filter' ? (
            <div className="sheet-body">
              <Legend lang={lang} cats={cats} toggle={toggleCat} />
              <StateChips lang={lang} states={stF} toggle={toggleSt} />
              <TempSlider c={tempC} onChange={onTemp} lang={lang} counts={counts} />
              <div className="sheet-end">
                {prog.starred.length ? <button type="button" className={`chip${mine ? ' on' : ''}`} onClick={() => setMine(m => !m)}>★ {t(lang, 'myList')} {prog.starred.length}</button> : null}
                <button type="button" className="chip" disabled={!filtersOn} onClick={resetFilters}>{t(lang, 'reset')}</button>
              </div>
            </div>
          ) : sheet === 'more' ? (
            <div className="sheet-body more">
              <div className="more-row"><span>{t(lang, 'accent')}</span><AccentSwitch accent={accent} lang={lang} onAccent={switchAccent} /></div>
              <button type="button" className="more-item" onClick={() => { switchLang(); setSheet('') }}>{t(lang, 'language')}</button>
              <button type="button" className="more-item" onClick={() => go('about')}>{t(lang, 'about')}</button>
              <label className="more-item tog"><input type="checkbox" checked={reduce} onChange={ev => setReduce(ev.target.checked)} /> {t(lang, 'reduce')}</label>
              {heardBar}
            </div>
          ) : null}
        </div>
        {detailEl}
      </div>
    )
  }

  return (
    <div className={`app desk mode-${mode}`}>
      <header className="d-head">
        <a className="brand" href={lang === 'zh' ? '/zh/' : '/'} onClick={ev => { ev.preventDefault(); go('explore') }}>
          <LogoMark /><span className="brand-t"><b>{t(lang, 'title')}</b><span>{lang === 'zh' ? 'Say the Elements' : '元素怎么读'}</span></span>
        </a>
        {searchBox}
        {tabs}
        <div className="head-end">
          {heardBar}
          <AccentSwitch accent={accent} lang={lang} onAccent={switchAccent} />
          <button type="button" className="pill ghost lang" onClick={switchLang} lang={lang === 'en' ? 'zh-Hans' : 'en'}>{t(lang, 'language')}</button>
        </div>
      </header>
      {showTable ? (
        <main className="d-main">
          <div className="tablet-stage">{mode === 'explore' ? stage : null}</div>
          <div className="table-wrap">{tableEl}</div>
          {controls}
        </main>
      ) : (
        <main className="d-page">{mode === 'tricky' ? <Tricky lang={lang} accent={accent} onPlay={e => playEl(e, accent, 'name', 'tricky', performance.now())} onOpen={e => openDetail(e.z, null)} /> : mode === 'practice' ? <Practice lang={lang} accent={accent} onAccent={switchAccent} onPlay={(e, k) => playEl(e, accent, k, 'practice', performance.now())} onOpen={e => openDetail(e.z, null)} /> : <About lang={lang} onReset={resetProgress} />}</main>
      )}
      {showTable ? null : <footer className="d-foot">
        <a href={lang === 'zh' ? '/zh/about/' : '/about/'} onClick={ev => { ev.preventDefault(); go('about') }}>{t(lang, 'about')}</a>
        <label className="tog"><input type="checkbox" checked={reduce} onChange={ev => setReduce(ev.target.checked)} /> {t(lang, 'reduce')}</label>
        <button type="button" className="linkish" onClick={() => setHelp(true)}>{t(lang, 'shortcuts')} <kbd>?</kbd></button>
        <span className="muted">{lang === 'zh' ? '读音经两部词典核对 · 数据来源见「关于」' : 'Pronunciations cross-checked in two dictionaries · sources on About'}</span>
      </footer>}
      {help ? <Help lang={lang} onClose={() => setHelp(false)} /> : null}
      {detailEl}
    </div>
  )
}
const EMPTY = new Set<number>()

function PhoneBar({ el, lang, accent, onPlay, onOpen, heardN }: { el: El | null; lang: Lang; accent: Accent; onPlay: (k: audio.Kind) => void; onOpen: () => void; heardN: number }) {
  const startY = useRef<number | null>(null)
  if (!el) return <div className="pbar welcome"><div><b>{t(lang, 'title')}</b><span>{t(lang, 'tapAny')}</span></div><span className="muted">{heardN}/118</span></div>
  const a = accent === 'us' ? 0 : 1
  return (
    <div className="pbar" style={{ ['--c' as string]: ['#FF6B6B', '#FF9F43', '#FFD43B', '#A3B8CC', '#2DD4BF', '#7EE787', '#38BDF8', '#A78BFA', '#F472B6', '#D946EF'][el.c] }}
      onPointerDown={ev => (startY.current = ev.clientY)} onPointerUp={ev => { if (startY.current != null && startY.current - ev.clientY > 30) onOpen(); startY.current = null }}>
      <button type="button" className="pb-open" onClick={onOpen} aria-label={`${t(lang, 'details')}: ${el.n}`}>
        {el.img ? <Specimen el={el} lang={lang} className="pb-thumb" /> : <span className="pb-shell"><ShellsLazy el={el} /></span>}
        <span className="pb-txt">
          <span className="pb-name" lang="en" key={el.z}>{accent === 'us' ? el.us : el.uk}</span>
          <span className="pb-ipa" lang="en">{el.ipa[a] ? `/${el.ipa[a]}/` : <span className="unv">{t(lang, 'unverified')}</span>}</span>
          <span className="pb-zh"><span className="zh-ch">{el.zh}</span> {el.py}</span>
        </span>
      </button>
      <button type="button" className="rbtn main" onClick={() => onPlay('name')} aria-label={t(lang, 'play')}><PlayIcon /></button>
      <button type="button" className="rbtn" onClick={() => onPlay('slow')} aria-label={t(lang, 'slow')}><SlowIcon /></button>
      <span className="pb-up" aria-hidden="true">⌃</span>
      <HookChip el={el} lang={lang} onOpen={onOpen} className="float" />
    </div>
  )
}
import { Shells } from './components/Shells'
function ShellsLazy({ el }: { el: El }) { return <Shells el={el} size={56} symbolSize={15} /> }

function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 40 40" width="32" height="32" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="9" fill="#0F1626" stroke="#7CF5D4" strokeOpacity=".55" />
      <ellipse cx="20" cy="20" rx="13" ry="5.2" fill="none" stroke="#7CF5D4" strokeOpacity=".55" transform="rotate(-28 20 20)" />
      <ellipse cx="20" cy="20" rx="13" ry="5.2" fill="none" stroke="#A78BFA" strokeOpacity=".6" transform="rotate(32 20 20)" />
      <circle cx="20" cy="20" r="3.4" fill="#7CF5D4" />
      <path d="M29 9.5c1.6 1.2 2.6 3 2.6 5M31.5 6.5c2.4 1.8 3.8 4.6 3.8 7.6" fill="none" stroke="#EAF0FF" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Help({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const rows: [string, string, string][] = [
    ['← ↑ → ↓', 'Move between elements', '在元素之间移动'], ['Space', 'Play the name', '播放读音'], ['S', 'Play slowly', '慢速播放'], ['E', 'Play the example sentence', '播放例句'],
    ['A', 'Switch US / UK', '切换美音 / 英音'], ['Enter', 'Open details', '打开详情'], ['Esc', 'Close', '关闭'], ['← →', 'Previous / next (in details)', '上一个 / 下一个（详情中）'], ['/', 'Search', '搜索'], ['?', 'This list', '显示本列表'],
  ]
  return (
    <div className="help" role="dialog" aria-modal="true" aria-label={t(lang, 'shortcuts')} onClick={onClose}>
      <div className="help-card" onClick={ev => ev.stopPropagation()}>
        <h2>{t(lang, 'shortcuts')}</h2>
        <dl>{rows.map(([k, en, zh]) => <div key={k + en}><dt><kbd>{k}</kbd></dt><dd>{lang === 'zh' ? zh : en}</dd></div>)}</dl>
        <button type="button" className="pill" onClick={onClose} autoFocus>{t(lang, 'close')}</button>
      </div>
    </div>
  )
}
