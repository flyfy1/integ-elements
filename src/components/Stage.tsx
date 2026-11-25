import { useEffect, useRef, useState } from 'react'
import { CATS, bothNames, loadDetail, type Accent, type El, type Lang } from '../data'
import { track } from '../analytics'
import { t } from '../i18n'
import * as audio from '../audio'
import { Shells } from './Shells'

export function Respell({ rs }: { rs: string }) {
  if (!rs) return null
  return <span className="respell" lang="en">{rs.split('-').map((p, i, a) => <span key={i}>{/[A-Z]/.test(p) ? <b>{p}</b> : p}{i < a.length - 1 ? '-' : ''}</span>)}</span>
}

export function Ipa({ el, accent, lang, only }: { el: El; accent: Accent; lang: Lang; only?: Accent }) {
  if (!only && el.ipa[0] && el.ipa[0] === el.ipa[1]) {
    return <span className="ipa-line" lang="en"><span className="ipa-item on"><span className="acc">{t(lang, 'us')} · {t(lang, 'uk')}</span><span className="ipa">/{el.ipa[0]}/</span></span></span>
  }
  const both = (['us', 'uk'] as const).filter(a => !only || a === only)
  return (
    <span className="ipa-line" lang="en">
      {both.map(a => {
        const v = el.ipa[a === 'us' ? 0 : 1]
        return (
          <span key={a} className={`ipa-item${a === accent ? ' on' : ''}`}>
            <span className="acc">{t(lang, a)}</span>
            {v ? <span className="ipa">/{v}/</span> : <span className="unv" title={t(lang, 'unverifiedLong')}>{t(lang, 'unverified')}</span>}
          </span>
        )
      })}
    </span>
  )
}

export function Meter() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const lv = [0, 0, 0, 0, 0]
    const tick = () => {
      audio.levels(lv)
      const bars = ref.current?.children
      if (bars) for (let i = 0; i < 5; i++) (bars[i] as HTMLElement).style.transform = `scaleY(${(0.15 + lv[i] * 0.85).toFixed(3)})`
      raf = audio.playing() ? requestAnimationFrame(tick) : 0
      ref.current?.classList.toggle('on', !!raf)
      if (!raf && bars) for (let i = 0; i < 5; i++) (bars[i] as HTMLElement).style.transform = 'scaleY(.15)'
    }
    const start = () => { if (!raf) raf = requestAnimationFrame(() => setTimeout(tick, 60)) as unknown as number }
    window.addEventListener('el-play', start)
    return () => { window.removeEventListener('el-play', start); cancelAnimationFrame(raf) }
  }, [])
  return <div className="meter" ref={ref} aria-hidden="true"><i /><i /><i /><i /><i /></div>
}

export const PlayIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
export const SlowIcon = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 16c0-4 3-7 7-7s6 3 6 5.5c0 1.4-1 2.5-2.4 2.5H5.2M17 14.5h2.2c.9 0 1.6-.8 1.6-1.7 0-.6-.5-1.1-1.1-1.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="11" cy="13.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
export const SentenceIcon = () => <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path d="M4 6.5h16M4 11.5h16M4 16.5h9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>

/** the element's hook, once detail data is in; null until then (never a placeholder) */
export function useHook(el: El | null, lang: Lang) {
  const [h, setH] = useState<{ z: number; text: string } | null>(null)
  useEffect(() => {
    if (!el) return
    let live = true
    void loadDetail().then(d => { const k = d[el.z]?.hook; if (live) setH(k ? { z: el.z, text: lang === 'zh' ? k.zh : k.en } : null) }).catch(() => {})
    return () => { live = false }
  }, [el, lang])
  return el && h?.z === el.z ? h.text : null
}
const Spark = () => <svg className="hk-spark" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0 6.1 3.9 10 5 6.1 6.1 5 10 3.9 6.1 0 5 3.9 3.9Z" fill="currentColor" /></svg>
export function HookChip({ el, lang, onOpen, className = '' }: { el: El | null; lang: Lang; onOpen: () => void; className?: string }) {
  const text = useHook(el, lang)
  if (!el || !text) return null
  return (
    <button type="button" key={`${el.z}-${lang}`} className={`hook-chip ${className}`} lang={lang === 'zh' ? 'zh-Hans' : 'en'}
      onClick={() => { track('hook_open', { element: el.s }, { cap: 20 }); onOpen() }}>
      <Spark /><span>{text}</span>
    </button>
  )
}

const imgUrl = (el: El) => `/img/${el.slug}.480.webp`
/** warm the 480 picture on intent (hover, touch start, focus), like the name clip */
export function warmPicture(el: El) {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection
  if (!el.img || conn?.saveData) return
  const im = new Image(); im.decoding = 'async'; im.src = imgUrl(el)
}
/** the element's picture in a small window: category-colour ground until decoded, then fade + settle */
export function Specimen({ el, lang, className = '' }: { el: El; lang: Lang; className?: string }) {
  const [ready, setReady] = useState<number | null>(null)
  useEffect(() => {
    if (!el.img) return
    let live = true
    const im = new Image(); im.src = imgUrl(el)
    im.decode().then(() => live && setReady(el.z), () => live && setReady(el.z))
    return () => { live = false }
  }, [el])
  return (
    <span className={`spec ${className}`} style={{ ['--c' as string]: CATS[el.c].hex }}>
      {el.img && ready === el.z ? <img key={el.z} src={imgUrl(el)} alt={lang === 'zh' ? `${el.zh}（${el.n}）的示意图片` : `Illustration of ${el.n}`} width={480} height={480} /> : null}
    </span>
  )
}

type Props = {
  el: El | null; lang: Lang; accent: Accent; compact?: boolean
  onPlay: (k: audio.Kind, from: string) => void; onAccent: (a: Accent) => void; onDetails: () => void
}
export function AccentSwitch({ accent, lang, onAccent, el }: { accent: Accent; lang: Lang; onAccent: (a: Accent) => void; el?: El | null }) {
  return (
    <div className="seg" role="radiogroup" aria-label={t(lang, 'accent')}>
      {(['us', 'uk'] as const).map(a => (
        <button key={a} type="button" role="radio" aria-checked={accent === a} className={accent === a ? 'on' : ''} onClick={() => onAccent(a)}>
          {t(lang, a)}{el && !el.ipa[a === 'us' ? 0 : 1] ? <sup aria-hidden="true">*</sup> : null}
        </button>
      ))}
    </div>
  )
}

export function Stage({ el, lang, accent, onPlay, onAccent, onDetails }: Props) {
  if (!el) {
    return (
      <div className="stage welcome">
        <div className="wl-mark" aria-hidden="true"><span>Og</span><i /><i /><i /></div>
        <div>
          <h1 className="wl-title">{t(lang, 'title')}</h1>
          <p className="wl-sub">{t(lang, 'tagline')}</p>
          <p className="wl-hint"><span className="pulse-dot" />{t(lang, 'tapAny')}</p>
        </div>
      </div>
    )
  }
  const cat = CATS[el.c]
  const name = accent === 'us' ? el.us : el.uk
  const a = accent === 'us' ? 0 : 1
  return (
    <div className="stage" style={{ ['--c' as string]: cat.hex }}>
      {el.img ? (
        <div className="st-shell st-spec"><Specimen el={el} lang={lang} /><span className="st-badge"><Shells el={el} size={64} symbolSize={15} /></span></div>
      ) : <div className="st-shell"><Shells el={el} size={150} symbolSize={30} /></div>}
      <div className="st-mid">
        <div className="st-name-row">
          <h2 className="st-name" lang="en" key={el.z}>{el.us !== el.uk ? bothNames(el) : el.n}</h2>
          <span className="st-cat"><i style={{ background: cat.hex }} />{lang === 'zh' ? cat.zh : cat.en}</span>
        </div>
        <Ipa el={el} accent={accent} lang={lang} />
        <div className="st-row2">
          <Respell rs={el.rs[a]} />
          <span className="zh-name"><span className="zh-ch">{el.zh}</span> <span className="py">{el.py}</span></span>
        </div>
      </div>
      <div className="st-ctl">
        <div className="st-btns">
          <button type="button" className="rbtn main" onClick={() => onPlay('name', 'stage')} aria-label={`${t(lang, 'play')} ${name}, ${accent === 'us' ? 'American' : 'British'}`}><PlayIcon /></button>
          <button type="button" className="rbtn" onClick={() => onPlay('slow', 'stage')} aria-label={`${t(lang, 'play')} ${name}, ${accent === 'us' ? 'American' : 'British'}, ${t(lang, 'slow')}`}><SlowIcon /></button>
          {el.a[a] & 4 ? <button type="button" className="rbtn" onClick={() => onPlay('sentence', 'stage')} aria-label={`${t(lang, 'play')} ${t(lang, 'sentence')}: ${name}`}><SentenceIcon /></button> : null}
          <Meter />
        </div>
        <div className="st-btns2">
          <AccentSwitch accent={accent} lang={lang} onAccent={onAccent} el={el} />
          <button type="button" className="pill" onClick={onDetails}>{t(lang, 'details')} <span aria-hidden="true">→</span></button>
        </div>
      </div>
      <HookChip el={el} lang={lang} onOpen={onDetails} className="st-hook" />
    </div>
  )
}
