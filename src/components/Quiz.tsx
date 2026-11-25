// Quiz: hear a name → tap the tile on the real table. Lazy chunk.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { BY_Z, CATS, ELS, nameFor, type Accent, type El, type Lang } from '../data'
import { t } from '../i18n'
import * as audio from '../audio'
import { track } from '../analytics'
import type { TableHandle } from './Table'
import { PlayIcon, SlowIcon } from './Stage'
import { IN_APP, landing } from '../share'

export type QuizHandle = { answer: (el: El) => void; active: () => boolean }
type SetId = 'first20' | 'common40' | 'trickySet' | 'all'
// Common 40: elements 1–30 plus ten everyday metals and gases (selection pending the lead's review)
const COMMON = [...Array.from({ length: 30 }, (_, i) => i + 1), 47, 50, 53, 54, 78, 79, 80, 82, 88, 92]
const pool = (s: SetId) => s === 'first20' ? ELS.slice(0, 20) : s === 'common40' ? COMMON.map(z => BY_Z.get(z)!) : s === 'trickySet' ? ELS.filter(e => e.t >= 2) : ELS
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }

type Props = { lang: Lang; accent: Accent; table: React.RefObject<TableHandle | null>; best: Record<string, number>; onScore: (set: string, score: number, missed: number[], right: number[], streak: number) => void; phone: boolean }

// The score becomes an element: six everyday names, all with two-source IPA and clean name clips.
export type MedalId = 'Au' | 'Ag' | 'Cu' | 'Fe' | 'Pb' | 'He'
const MEDAL_Z: Record<MedalId, number> = { Au: 79, Ag: 47, Cu: 29, Fe: 26, Pb: 82, He: 2 }
export function medalFor(right: number, total: number): MedalId {
  const r = total ? right / total : 0
  return r >= 1 ? 'Au' : r >= 0.8 ? 'Ag' : r >= 0.6 ? 'Cu' : r >= 0.3 ? 'Fe' : r > 0 ? 'Pb' : 'He'
}
const MILESTONE: Record<number, 'streak3' | 'streak5' | 'streak7'> = { 3: 'streak3', 5: 'streak5', 7: 'streak7' }
const reduced = () => document.documentElement.classList.contains('reduce')

export const Quiz = forwardRef<QuizHandle, Props>(function Quiz(p, ref) {
  const [setId, setSetId] = useState<SetId>('first20')
  const [qs, setQs] = useState<El[]>([])
  const [i, setI] = useState(0)
  const [missed, setMissed] = useState<El[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; tapped: El } | null>(null)
  const [done, setDone] = useState(false)
  const lock = useRef(false)
  const rights = useRef<number[]>([])
  const [streak, setStreak] = useState(0)
  const [broke, setBroke] = useState(0)
  const longest = useRef(0)
  const chip = useRef(2)
  const lastSet = useRef<SetId | 'missed' | 'challenge'>('first20')
  // a challenge link: its questions in its order, offered once on the setup screen
  const [dare, setDare] = useState(landing.challenge)

  const q = qs[i]
  const say = (k: audio.Kind = 'name', el = q) => { if (el) { audio.unlock(); void audio.play(el.slug, p.accent, k); window.dispatchEvent(new Event('el-play')) } }
  const begin = (list: El[], sid: SetId | 'missed' | 'challenge') => {
    const qq = sid === 'challenge' ? list : shuffle(list).slice(0, 10)
    setQs(qq); setI(0); setMissed([]); setFeedback(null); setDone(false); rights.current = []
    setStreak(0); setBroke(0); longest.current = 0; lastSet.current = sid
    track('quiz_start', { set: sid })
    audio.unlock()
    setTimeout(() => void audio.play(qq[0].slug, p.accent, 'name'), 250)
  }

  useImperativeHandle(ref, () => ({
    active: () => !!q && !done,
    answer: (el: El) => {
      if (!q || done || lock.current) return
      lock.current = true
      const ok = el.z === q.z
      setFeedback({ ok, tapped: el })
      const n = ok ? streak + 1 : 0
      setBroke(!ok && streak >= 3 ? streak : 0)
      setStreak(n)
      longest.current = Math.max(longest.current, n)
      if (ok) {
        p.table.current?.mark(el.z, 'q-right', 600); rights.current.push(el.z); void audio.play(el.slug, p.accent, 'name')
        // the chain travels across the table: every tile answered right so far, in answer order
        if (MILESTONE[n]) { setTimeout(() => p.table.current?.shimmer([...rights.current], 40), 120); track('quiz_streak', { n, set: setId }) }
      } else {
        p.table.current?.mark(el.z, 'q-wrong', 340)
        setTimeout(() => p.table.current?.mark(q.z, 'q-show', 900), 300)
        setMissed(m => [...m, q])
        setTimeout(() => void audio.play(el.slug, p.accent, 'name').then(() => {}), 0)
        setTimeout(() => void audio.play(q.slug, p.accent, 'name'), 1100)
      }
      setTimeout(() => {
        lock.current = false
        setFeedback(null)
        if (i + 1 >= qs.length) {
          setDone(true)
          const score = rights.current.length
          // a challenge run is its own set: not logged or saved as a best under the selected chip
          const sk = lastSet.current === 'challenge' ? 'challenge' : setId
          track('quiz_finish', { set: sk, score, total: qs.length, medal: medalFor(score, qs.length), streak: longest.current })
          p.onScore(sk, score, (ok ? missed : [...missed, q]).map(e => e.z), rights.current, longest.current)
        } else { setI(i + 1); setTimeout(() => void audio.play(qs[i + 1].slug, p.accent, 'name'), 200) }
      }, ok ? 1100 : 2400)
    },
  }))

  if (!qs.length && dare) {
    const el = BY_Z.get(dare.tripped)
    return (
      <div className="quiz-setup q-dare">
        <p className="q-intro">{t(p.lang, el ? 'challengeIntro' : 'challengeIntro0', { n: dare.score, total: dare.zs.length, name: el ? nameFor(el, p.accent) : '' })}</p>
        <div className="q-end-btns">
          <button type="button" className="pill primary" onClick={() => begin(dare.zs.map(z => BY_Z.get(z)!), 'challenge')}><PlayIcon /> {t(p.lang, 'start')}</button>
          <button type="button" className="pill ghost" onClick={() => setDare(null)}>{t(p.lang, 'challengeOther')}</button>
        </div>
      </div>
    )
  }
  if (!qs.length || (done && !qs.length)) {
    return (
      <div className="quiz-setup">
        <p className="q-intro">{t(p.lang, 'quizIntro')}</p>
        <div className="q-sets" role="radiogroup" aria-label={t(p.lang, 'quizSet')}>
          {(['first20', 'common40', 'trickySet', 'all'] as SetId[]).map(s => (
            <button key={s} type="button" role="radio" aria-checked={setId === s} className={`chip big${setId === s ? ' on' : ''}`} onClick={() => setSetId(s)}>
              {t(p.lang, s)}{p.best[s] != null ? <span className="best">{t(p.lang, 'best')} {p.best[s]}/10</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="pill primary" onClick={() => begin(pool(setId), setId)}><PlayIcon /> {t(p.lang, 'start')}</button>
      </div>
    )
  }
  if (done) {
    return <QuizEnd lang={p.lang} accent={p.accent} score={qs.length - missed.length} total={qs.length} missed={missed} longest={longest.current} answered={rights.current}
      table={p.table} onMissed={() => begin(missed, 'missed')} onNew={() => { setQs([]); setDone(false); setDare(null) }} say={e => say('name', e)} setName={lastSet.current}
      zs={qs.map(e => e.z)} rival={lastSet.current === 'challenge' && dare ? dare.score : null} />
  }
  if (streak >= 2) chip.current = streak
  return (
    <div className={`quiz-bar${feedback ? (feedback.ok ? ' ok' : ' bad') : ''}`} aria-live="polite">
      <div className="q-btns">
        <button type="button" className="rbtn main" onClick={() => say('name')} aria-label={t(p.lang, 'replay')}><PlayIcon /></button>
        <button type="button" className="rbtn" onClick={() => say('slow')} aria-label={`${t(p.lang, 'replay')} ${t(p.lang, 'slow')}`}><SlowIcon /></button>
      </div>
      <div className="q-mid">
        {feedback ? (
          feedback.ok
            ? <span className={`q-fb ok${MILESTONE[streak] ? ' chain' : ''}`}>✓ {MILESTONE[streak] ? t(p.lang, MILESTONE[streak]) : t(p.lang, 'right')} <b lang="en">{nameFor(q, p.accent)}</b> {q.zh}</span>
            : <span className="q-fb bad">{broke ? <span className="q-broke">{t(p.lang, 'streakBroken', { n: broke })} </span> : null}✕ {t(p.lang, 'wrongWas')} <b lang="en">{nameFor(feedback.tapped, p.accent)}</b>; {t(p.lang, 'answerIs')} <b lang="en">{nameFor(q, p.accent)}</b> {q.zh}</span>
        ) : <span className="q-ask">{t(p.lang, 'question')}</span>}
        <div className="q-prog" aria-label={`${i + 1} / ${qs.length}`}>{qs.map((_, k) => <i key={k} className={k < i ? 'd' : k === i ? 'c' : ''} />)}<span>{i + 1}/{qs.length}</span>
          <b className={`q-streak${streak >= 2 ? ' on' : ''}`} key={chip.current} aria-hidden={streak < 2}>×{chip.current}</b></div>
      </div>
    </div>
  )
})
type EndProps = { lang: Lang; accent: Accent; score: number; total: number; missed: El[]; longest: number; answered: number[]; table: React.RefObject<TableHandle | null>; onMissed: () => void; onNew: () => void; say: (e: El) => void; setName: string
  /** the questions, in order (the challenge link carries them) */
  zs: number[]
  /** the sender's score when this run answered a challenge */
  rival: number | null }

export function MedalTile({ el, accent, lang, onPlay }: { el: El; accent: Accent; lang: Lang; onPlay?: () => void }) {
  const nm = nameFor(el, accent)
  return (
    <button type="button" className="medal" style={{ ['--c' as string]: CATS[el.c].hex }} onClick={onPlay} aria-label={`${t(lang, 'play')} ${nm}`}>
      <span className="m-num">{el.z}</span><span className="m-sym">{el.s}</span><span className="m-nm" lang="en">{nm}</span>
    </button>
  )
}

function QuizEnd(p: EndProps) {
  const medal = medalFor(p.score, p.total)
  const el = BY_Z.get(MEDAL_Z[medal])!
  const ipa = el.ipa[p.accent === 'us' ? 0 : 1] ?? el.ipa[0]
  const num = useRef<HTMLElement>(null)
  const [toast, setToast] = useState('')
  const playMedal = (auto = false) => { audio.unlock(); void audio.play(el.slug, p.accent, 'name'); if (!auto) track('medal_play', { medal }) }

  useEffect(() => {
    const timers: number[] = []
    let raf = 0
    if (!reduced() && num.current) {
      const t0 = performance.now()
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / 600)
        const e = 1 - Math.pow(1 - k, 3)
        if (num.current) num.current.textContent = String(Math.round(p.score * e))
        if (k < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    // the medal says its own name once the flip lands, never over the last answer's clip
    let waited = 0
    const sayMedal = () => { if (audio.playing() && waited < 2000) { waited += 100; timers.push(window.setTimeout(sayMedal, 100)) } else playMedal(true) }
    timers.push(window.setTimeout(sayMedal, reduced() ? 300 : 920))
    if (medal === 'Au' && !reduced()) timers.push(window.setTimeout(() => p.table.current?.shimmer(p.answered, 40), 920))
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [pic, setPic] = useState('')
  const card = () => ({ lang: p.lang, accent: p.accent, medal: el, medalId: medal, line: t(p.lang, `medal${medal}`), score: p.score, total: p.total, longest: p.longest, missed: p.missed, setName: p.setName, zs: p.zs })
  const share = async () => {
    const m = await import('./shareCard')
    if (IN_APP) {
      // WeChat and friends: no file share, no download; the picture (with its QR) is held to send or save
      const blob = await m.cardBlob(card())
      if (blob) setPic(URL.createObjectURL(blob))
      return
    }
    const how = await m.shareCard(card())
    if (how) track('quiz_share', { medal, method: how })
    if (how === 'download') { setToast(t(p.lang, 'saved')); setTimeout(() => setToast(''), 2200) }
  }
  const held = useRef(0)
  const onHold = () => { held.current = window.setTimeout(() => { track('quiz_share', { medal, method: 'longpress' }, { onceKey: 'longpress' }); if (landing.recipient) track('reply_share', { method: 'longpress', hop: landing.hop }) }, 500) }
  const offHold = () => clearTimeout(held.current)
  const closePic = () => { URL.revokeObjectURL(pic); setPic('') }

  return (
    <div className={`quiz-end medal-${medal}`}>
      <div className="q-verdict">
        <div className="medal-wrap">
          <MedalTile el={el} accent={p.accent} lang={p.lang} onPlay={() => playMedal()} />
          {medal === 'Au' ? <><i className="m-spark" aria-hidden="true" /><i className="m-spark two" aria-hidden="true" /></> : null}
        </div>
        <div className="q-vtext">
          <div className="q-score"><b ref={num}>{reduced() ? p.score : 0}</b>/{p.total}</div>
          <div className="q-mname"><b lang="en">{nameFor(el, p.accent)}</b> {ipa ? <span className="ipa" lang="en">/{ipa}/</span> : null} <span className="zh-ch">{el.zh}</span></div>
          <div className="q-joke">{t(p.lang, `medal${medal}`)}</div>
          {p.longest >= 3 ? <div className="q-chain">{t(p.lang, 'longestChain', { n: p.longest })}</div> : null}
          {p.rival != null ? <div className="q-vs">{t(p.lang, 'vs', { a: p.score, n: p.rival, total: p.total })}</div> : null}
        </div>
      </div>
      {p.missed.length ? (
        <div className="q-missed">
          <h3>{t(p.lang, 'missed')}</h3>
          <ul>{p.missed.map(e => <li key={e.z}><button type="button" className="rbtn sm" onClick={() => p.say(e)} aria-label={`${t(p.lang, 'play')} ${nameFor(e, p.accent)}`}><PlayIcon /></button><span className="sym-chip">{e.s}</span> <span lang="en">{nameFor(e, p.accent)}</span> <span className="muted">{e.zh}</span></li>)}</ul>
        </div>
      ) : null}
      <div className="q-end-btns">
        {p.missed.length ? <button type="button" className={`pill${p.rival != null ? '' : ' primary'}`} onClick={p.onMissed}>{t(p.lang, 'tryMissed')}</button> : null}
        <button type="button" className={`pill${p.missed.length ? '' : ' primary'}`} onClick={p.onNew}>{t(p.lang, 'again')}</button>
        <button type="button" className={`pill${p.rival != null ? ' primary' : ' ghost'}`} onClick={() => void share()}><ShareIcon /> {t(p.lang, p.rival != null ? 'sendBack' : 'shareResult')}</button>
        {toast ? <span className="q-toast" role="status">{toast}</span> : null}
      </div>
      {pic ? (
        <div className="q-pic" role="dialog" aria-modal="true" aria-label={t(p.lang, 'holdToSend')} onClick={closePic}>
          <img src={pic} alt={t(p.lang, 'labReport')} onPointerDown={onHold} onPointerUp={offHold} onPointerCancel={offHold} onContextMenu={offHold} onClick={e => e.stopPropagation()} />
          <p>{t(p.lang, 'holdToSend')}</p>
          <button type="button" className="pill" onClick={closePic}>{t(p.lang, 'close')}</button>
        </div>
      ) : null}
    </div>
  )
}

function ShareIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
export default Quiz
