import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BY_Z, CATS, bothNames, loadDetail, type Accent, type Detail as D, type El, type Lang, type State } from '../data'
import { t } from '../i18n'
import * as audio from '../audio'
import { Shells } from './Shells'
import { Respell, PlayIcon, SlowIcon, Meter } from './Stage'
import { StateIcon } from './Table'
import { track } from '../analytics'
import { Sister } from './Sister'
import { hopOut, trackReply } from '../share'

type Props = {
  el: El; lang: Lang; accent: Accent; phone: boolean; origin: DOMRect | null; state: State; starred: boolean
  onClose: () => void; onNav: (z: number) => void; onPlay: (el: El, a: Accent, k: audio.Kind, from: string) => void; onStar: () => void
}

const ease = 'cubic-bezier(.2,.8,.2,1)'
const easeIO = 'cubic-bezier(.65,0,.35,1)'
const reduced = () => document.documentElement.classList.contains('reduce')
const kToC = (k: number | null) => (k == null ? null : Math.round((k - 273.15) * 10) / 10)

export function Detail(p: Props) {
  const { el, lang, accent } = p
  const [d, setD] = useState<D | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const flyer = useRef<HTMLDivElement>(null)
  const badge = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const lastFocus = useRef<Element | null>(null)
  const [slide, setSlide] = useState<'' | 'l' | 'r'>('')

  useEffect(() => { let on = true; void loadDetail().then(all => on && setD(all[el.z])); return () => { on = false } }, [el.z])

  // ---- open animation ----
  useLayoutEffect(() => {
    lastFocus.current = document.activeElement
    const c = card.current!, s = scrim.current!
    s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'both' })
    if (reduced()) { c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'both' }); return }
    if (!p.phone) {
      const o = p.origin, r = c.getBoundingClientRect()
      if (o) {
        const sx = o.width / r.width, sy = o.height / r.height
        const dx = o.left + o.width / 2 - (r.left + r.width / 2), dy = o.top + o.height / 2 - (r.top + r.height / 2)
        c.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy}) rotateY(180deg)` },
          { transform: 'none' },
        ], { duration: 520, easing: ease, fill: 'both' })
      } else c.animate([{ transform: 'scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: ease, fill: 'both' })
    } else {
      c.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 320, easing: ease, fill: 'both' })
      // a copy of the tile lifts off, flies to the head of the sheet and turns over to become the badge
      const o = p.origin, f = flyer.current, b = badge.current
      if (o && f && b) {
        const br = b.getBoundingClientRect()
        const sheetShift = c.getBoundingClientRect().height // badge rect is measured while the sheet sits at translateY(100%)
        const tx = br.left - o.left, ty = br.top - sheetShift - o.top
        b.style.opacity = '0'
        f.style.cssText = `left:${o.left}px;top:${o.top}px;width:${o.width}px;height:${o.height}px;display:flex`
        const sx = br.width / o.width, sy = br.height / o.height
        f.animate([
          { transform: 'translate(0,0) scale(1) rotateY(0)' },
          { transform: `translate(${tx * 0.5}px, ${ty * 0.5 - 40}px) scale(${(1 + sx) / 2}, ${(1 + sy) / 2}) rotateY(90deg)`, offset: 0.5 },
          { transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy}) rotateY(180deg)` },
        ], { duration: 360, easing: ease, fill: 'forwards' }).onfinish = () => { f.style.display = 'none'; b.style.opacity = ''; b.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'none' }], { duration: 160, easing: ease }) }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    if (closing.current) return
    closing.current = true
    audio.stop()
    const c = card.current!, s = scrim.current!
    s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'both' })
    let a: Animation
    if (reduced()) a = c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'both' })
    else if (p.phone) a = c.animate([{ transform: getComputedStyle(c).transform === 'none' ? 'none' : getComputedStyle(c).transform }, { transform: 'translateY(100%)' }], { duration: 260, easing: easeIO, fill: 'both' })
    else {
      const o = p.origin, r = c.getBoundingClientRect()
      a = o
        ? c.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${o.left + o.width / 2 - (r.left + r.width / 2)}px, ${o.top + o.height / 2 - (r.top + r.height / 2)}px) scale(${o.width / r.width}, ${o.height / r.height}) rotateY(180deg)`, opacity: 1 }], { duration: 380, easing: easeIO, fill: 'both' })
        : c.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.95)' }], { duration: 200, fill: 'both' })
    }
    a.onfinish = () => { p.onClose(); (lastFocus.current as HTMLElement | null)?.focus?.() }
  }

  // ---- keyboard: Esc, ←/→, focus trap ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); close() }
      else if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && !(ev.target as HTMLElement).closest('input,textarea')) { ev.preventDefault(); nav(ev.key === 'ArrowLeft' ? -1 : 1) }
      else if (ev.key === 'Tab') {
        const f = [...card.current!.querySelectorAll<HTMLElement>('button,[href],input,[tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent)
        if (!f.length) return
        if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus() }
        else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => { card.current?.focus({ preventScroll: true }) }, [])

  const nav = (dir: number) => {
    const z = ((el.z - 1 + dir + 118) % 118) + 1
    if (!reduced()) { setSlide(dir > 0 ? 'l' : 'r'); setTimeout(() => setSlide(''), 240) }
    p.onNav(z)
  }

  // ---- phone: drag the head down to dismiss; swipe sideways for prev/next ----
  const drag = useRef<{ x: number; y: number; t: number; axis: '' | 'x' | 'y' } | null>(null)
  const onDown = (ev: React.PointerEvent) => {
    if (!p.phone || (ev.target as HTMLElement).closest('button')) return
    drag.current = { x: ev.clientX, y: ev.clientY, t: performance.now(), axis: '' }
  }
  const onMove = (ev: React.PointerEvent) => {
    const g = drag.current
    if (!g) return
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y
    if (!g.axis && Math.hypot(dx, dy) > 8) g.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'
    const body = card.current!.querySelector<HTMLElement>('.dt-scroll')!
    if (g.axis === 'y' && dy > 0 && body.scrollTop <= 0) card.current!.style.transform = `translateY(${dy}px)`
  }
  const onUp = (ev: React.PointerEvent) => {
    const g = drag.current
    drag.current = null
    if (!g) return
    const dx = ev.clientX - g.x, dy = ev.clientY - g.y, v = dy / Math.max(1, performance.now() - g.t)
    if (g.axis === 'y') {
      if (dy > 110 || v > 0.6) close()
      else card.current!.animate([{ transform: card.current!.style.transform }, { transform: 'none' }], { duration: 200, easing: ease }).onfinish = () => (card.current!.style.transform = '')
      if (!(dy > 110 || v > 0.6)) card.current!.style.transform = ''
    } else if (g.axis === 'x' && Math.abs(dx) > 60) nav(dx < 0 ? 1 : -1)
  }

  const cat = CATS[el.c]
  const prev = BY_Z.get(el.z === 1 ? 118 : el.z - 1)!, next = BY_Z.get(el.z === 118 ? 1 : el.z + 1)!
  const sen = d?.sen
  const sentenceText = sen ? (accent === 'us' ? sen.us : sen.uk) : ''
  const nameA = accent === 'us' ? el.us : el.uk
  const highlight = (s: string) => { const i = s.toLowerCase().indexOf(nameA.toLowerCase()); return i < 0 ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + nameA.length)}</mark>{s.slice(i + nameA.length)}</> }
  const mpC = kToC(el.mp), bpC = kToC(el.bp)

  return (
    <div className={`dt-wrap${p.phone ? ' phone' : ''}`}>
      <div className="dt-scrim" ref={scrim} onClick={close} />
      {p.phone ? <div className="flyer" ref={flyer} style={{ ['--c' as string]: cat.hex }} aria-hidden="true"><span className="sym">{el.s}</span></div> : null}
      <div className={`dt-card${slide ? ' slide-' + slide : ''}`} ref={card} role="dialog" aria-modal="true" aria-labelledby="dt-title" tabIndex={-1} style={{ ['--c' as string]: cat.hex }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)}>
        {!p.phone ? <div className="dt-front" aria-hidden="true"><span className="num">{el.z}</span><span className="sym">{el.s}</span></div> : null}
        <div className="dt-back">
          {p.phone ? <div className="grab" aria-hidden="true" /> : null}
          <div className="dt-top">
            <div className="dt-badge" ref={badge}><span className="num">{el.z}</span><span className="sym">{el.s}</span></div>
            <div className="dt-title">
              <h2 id="dt-title" lang="en">{bothNames(el)}</h2>
              <div className="dt-sub"><Respell rs={el.rs[accent === 'us' ? 0 : 1]} /><span className="helper"><span className="zh-ch">{el.zh}</span> <span className="py">{el.py}</span> · <span className="st-cat"><i style={{ background: cat.hex }} />{lang === 'zh' ? cat.zh : cat.en}</span></span></div>
            </div>
            <button type="button" className={`icon-btn star${p.starred ? ' on' : ''}`} onClick={p.onStar} aria-pressed={p.starred} aria-label={t(lang, 'star')}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z" fill={p.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
            </button>
            <button type="button" className="icon-btn dt-close" onClick={close} aria-label={t(lang, 'close')}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="dt-scroll">
            <section className="dt-say" aria-label={lang === 'zh' ? '发音' : 'Pronunciation'}>
              {(['us', 'uk'] as const).map(a => {
                const i = a === 'us' ? 0 : 1
                const n = a === 'us' ? el.us : el.uk
                return (
                  <div key={a} className={`say-row${a === accent ? ' on' : ''}`}>
                    <span className="acc-chip">{t(lang, a)}</span>
                    <div className="say-txt">
                      {el.us !== el.uk ? <span className="say-name" lang="en">{n}</span> : null}
                      {el.ipa[i] ? <span className="ipa" lang="en">/{el.ipa[i]}/</span> : <span className="unv">{t(lang, 'unverified')}</span>}
                      <Respell rs={el.rs[i]} />
                    </div>
                    <button type="button" className="rbtn main sm" onClick={() => p.onPlay(el, a, 'name', 'detail')} aria-label={`${t(lang, 'play')} ${n}, ${a === 'us' ? 'American' : 'British'}`}><PlayIcon /></button>
                    <button type="button" className="rbtn sm" onClick={() => p.onPlay(el, a, 'slow', 'detail')} aria-label={`${t(lang, 'play')} ${n}, ${a === 'us' ? 'American' : 'British'}, ${t(lang, 'slow')}`}><SlowIcon /></button>
                  </div>
                )
              })}
              {!el.ipa[0] || !el.ipa[1] ? <p className="note">* {t(lang, 'unverifiedLong')}</p> : null}
              <Meter />
            </section>
            <Repeat el={el} accent={accent} lang={lang} />
            {d?.traps?.length ? (
              <section className="dt-traps">
                <h3>{t(lang, 'traps')}</h3>
                {d.traps.map((tr, i) => <p key={i}><span className="wrong" lang="en"><s>{tr.wrong}</s></span> {lang === 'zh' ? tr.why_zh : tr.why_en}</p>)}
              </section>
            ) : null}
            {sen ? (
              <section className="dt-sen">
                <h3>{t(lang, 'example')}</h3>
                <div className="sen-row">
                  {d?.sa?.[accent === 'us' ? 0 : 1] !== false ? <button type="button" className="rbtn sm" onClick={() => p.onPlay(el, accent, 'sentence', 'detail')} aria-label={`${t(lang, 'play')} ${t(lang, 'sentence')}`}><PlayIcon /></button> : null}
                  <div><p lang="en" className="sen-en">{highlight(sentenceText)}</p>{lang === 'zh' ? <p className="sen-zh">{sen.zh}</p> : null}</div>
                </div>
              </section>
            ) : null}
            <div className="dt-hero">
              <Picture el={el} d={d} lang={lang} />
              <div className="dt-shell"><Shells el={el} size={p.phone ? 132 : 160} symbolSize={p.phone ? 24 : 28} /><span className="shell-cap">{el.sh.join(' · ')}</span></div>
            </div>
            {d?.fact ? <section className="dt-fact"><h3>{t(lang, 'fact')}</h3>{d.hook?.from === 'fact' ? <p className="dt-hook">{lang === 'zh' ? d.hook.zh : d.hook.en}</p> : null}<p>{lang === 'zh' ? d.fact.zh : d.fact.en}</p></section> : null}
            {d?.ety ? <section className="dt-ety"><h3>{t(lang, 'etymology')}</h3>{d.hook?.from === 'etymology' ? <p className="dt-hook">{lang === 'zh' ? d.hook.zh : d.hook.en}</p> : null}<p>{lang === 'zh' ? d.ety.zh : d.ety.en}</p></section> : null}
            <section className="dt-facts">
              <span><StateIcon s={p.state} size={12} /> {lang === 'zh' ? { solid: '固态', liquid: '液态', gas: '气态', unknown: '未知' }[p.state] : p.state} · 25 °C</span>
              <span>{t(lang, 'melting')} {mpC == null ? t(lang, 'unknown') : `${mpC} °C`}</span>
              <span>{t(lang, 'boiling')} {bpC == null ? t(lang, 'unknown') : `${bpC} °C`}</span>
              {d ? <span>{t(lang, 'period')} {d.period}{d.group ? ` · ${t(lang, 'group')} ${d.group}` : ''}</span> : null}
              {d?.year ? <span>{t(lang, 'discovered')} {d.year}</span> : null}
            </section>
            <Dare el={el} lang={lang} />
            <Sister lang={lang} variant="row" />
          </div>
          <div className="dt-nav">
            <button type="button" className="pill ghost" onClick={() => nav(-1)} aria-label={`${t(lang, 'prev')}: ${prev.n}`}>← <span className="nav-s">{prev.s}</span> <span className="nav-n">{prev.n}</span></button>
            <button type="button" className="pill ghost" onClick={() => nav(1)} aria-label={`${t(lang, 'next')}: ${next.n}`}><span className="nav-n">{next.n}</span> <span className="nav-s">{next.s}</span> →</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 考考朋友: the element's own page (it has its own preview card) with a one-line bet */
function Dare({ el, lang }: { el: El; lang: Lang }) {
  const [done, setDone] = useState(false)
  const go = async () => {
    const url = (how: string) => `https://elements.integ.life${lang === 'zh' ? '/zh' : ''}/element/${el.slug}/?r=${how}${hopOut()}`
    const text = t(lang, 'dareText', { name: el.n })
    let method = ''
    if (navigator.share) {
      try { await navigator.share({ text, url: url('l') }); method = 'link' } catch (e) { if ((e as Error).name === 'AbortError') return }
    }
    if (!method) {
      try { await navigator.clipboard.writeText(`${text} ${url('c')}`); method = 'copy_link'; setDone(true); setTimeout(() => setDone(false), 2000) } catch { return }
    }
    track('dare_share', { method })
    trackReply(method)
  }
  return (
    <div className="dt-dare">
      <button type="button" className="pill ghost" onClick={() => void go()}>{t(lang, 'dare')}</button>
      {done ? <span className="q-toast" role="status">{t(lang, 'linkCopied')}</span> : null}
    </div>
  )
}

function Picture({ el, d, lang }: { el: El; d: D | null; lang: Lang }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [el.z])
  if (!el.img) return <div className="pic none" />
  return (
    <div className={`pic${loaded ? ' loaded' : ''}`} style={d?.prev ? { backgroundImage: `url(${d.prev})` } : undefined}>
      <img key={el.z} src={`/img/${el.slug}.960.webp`} srcSet={`/img/${el.slug}.480.webp 480w, /img/${el.slug}.960.webp 960w`} sizes="(max-width: 600px) 60vw, 300px"
        alt={lang === 'zh' ? `${el.zh}（${el.n}）的示意图片` : `Illustration of ${el.n}`} width={960} height={960} decoding="async" onLoad={() => setLoaded(true)} />
    </div>
  )
}

export function Repeat({ el, accent, lang }: { el: El; accent: Accent; lang: Lang }) {
  const [st, setSt] = useState<'idle' | 'rec' | 'ready' | 'denied'>(typeof MediaRecorder === 'undefined' || !navigator.mediaDevices ? 'denied' : 'idle')
  const take = useRef<audio.Take | null>(null)
  useEffect(() => () => { audio.stopRecording(); if (take.current) URL.revokeObjectURL(take.current.blobUrl); take.current = null }, [])
  useEffect(() => { take.current = null; setSt(s => (s === 'denied' ? s : 'idle')) }, [el.z])
  if (st === 'denied') return <section className="dt-rep"><p className="note">{t(lang, 'micDenied')}</p></section>
  const rec = async () => {
    if (st === 'rec') { audio.stopRecording(); return }
    try {
      track('record_use', { step: 'record' })
      const tk = await audio.record(4000, () => setSt('rec'))
      take.current = tk
      setSt(tk ? 'ready' : 'idle')
    } catch { setSt('denied') }
  }
  const compare = async () => {
    if (!take.current) return
    track('record_use', { step: 'compare' })
    await audio.playAndWait(el.slug, accent, 'name')
    await new Promise(r => setTimeout(r, 300))
    await audio.playBuffer(take.current.buf)
  }
  return (
    <section className="dt-rep">
      <h3>{t(lang, 'repeat')}</h3>
      <div className="rep-row">
        <button type="button" className={`pill rec${st === 'rec' ? ' on' : ''}`} onClick={rec}><span className="rec-dot" />{st === 'rec' ? t(lang, 'stop') : t(lang, 'record')}</button>
        <button type="button" className="pill" disabled={st !== 'ready'} onClick={compare}>{t(lang, 'compare')}</button>
      </div>
      <p className="note">{t(lang, 'recordNote')}</p>
    </section>
  )
}
