// Quiz: hear a name → tap the tile on the real table. Lazy chunk.
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { BY_Z, ELS, nameFor, type Accent, type El, type Lang } from '../data'
import { t } from '../i18n'
import * as audio from '../audio'
import { track } from '../analytics'
import type { TableHandle } from './Table'
import { PlayIcon, SlowIcon } from './Stage'

export type QuizHandle = { answer: (el: El) => void; active: () => boolean }
type SetId = 'first20' | 'common40' | 'trickySet' | 'all'
// Common 40: elements 1–30 plus ten everyday metals and gases (selection pending the lead's review)
const COMMON = [...Array.from({ length: 30 }, (_, i) => i + 1), 47, 50, 53, 54, 78, 79, 80, 82, 88, 92]
const pool = (s: SetId) => s === 'first20' ? ELS.slice(0, 20) : s === 'common40' ? COMMON.map(z => BY_Z.get(z)!) : s === 'trickySet' ? ELS.filter(e => e.t >= 2) : ELS
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }

type Props = { lang: Lang; accent: Accent; table: React.RefObject<TableHandle | null>; best: Record<string, number>; onScore: (set: string, score: number, missed: number[], right: number[]) => void; phone: boolean }

export const Quiz = forwardRef<QuizHandle, Props>(function Quiz(p, ref) {
  const [setId, setSetId] = useState<SetId>('first20')
  const [qs, setQs] = useState<El[]>([])
  const [i, setI] = useState(0)
  const [missed, setMissed] = useState<El[]>([])
  const [feedback, setFeedback] = useState<{ ok: boolean; tapped: El } | null>(null)
  const [done, setDone] = useState(false)
  const lock = useRef(false)
  const rights = useRef<number[]>([])

  const q = qs[i]
  const say = (k: audio.Kind = 'name', el = q) => { if (el) { audio.unlock(); void audio.play(el.slug, p.accent, k); window.dispatchEvent(new Event('el-play')) } }
  const begin = (list: El[], sid: SetId | 'missed') => {
    const qq = shuffle(list).slice(0, 10)
    setQs(qq); setI(0); setMissed([]); setFeedback(null); setDone(false); rights.current = []
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
      if (ok) { p.table.current?.mark(el.z, 'q-right', 600); rights.current.push(el.z); void audio.play(el.slug, p.accent, 'name') }
      else {
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
          track('quiz_finish', { set: setId, score, total: qs.length })
          p.onScore(setId, score, (ok ? missed : [...missed, q]).map(e => e.z), rights.current)
        } else { setI(i + 1); setTimeout(() => void audio.play(qs[i + 1].slug, p.accent, 'name'), 200) }
      }, ok ? 1100 : 2400)
    },
  }))

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
    const score = qs.length - missed.length
    return (
      <div className="quiz-end">
        <div className="q-score"><b>{score}</b>/{qs.length}<span>{t(p.lang, 'score')}</span></div>
        {missed.length ? (
          <div className="q-missed">
            <h3>{t(p.lang, 'missed')}</h3>
            <ul>{missed.map(e => <li key={e.z}><button type="button" className="rbtn sm" onClick={() => say('name', e)} aria-label={`${t(p.lang, 'play')} ${nameFor(e, p.accent)}`}><PlayIcon /></button><span className="sym-chip">{e.s}</span> {nameFor(e, p.accent)} <span className="muted">{e.zh}</span></li>)}</ul>
          </div>
        ) : null}
        <div className="q-end-btns">
          {missed.length ? <button type="button" className="pill primary" onClick={() => begin(missed, 'missed')}>{t(p.lang, 'tryMissed')}</button> : null}
          <button type="button" className="pill" onClick={() => { setQs([]); setDone(false) }}>{t(p.lang, 'again')}</button>
        </div>
      </div>
    )
  }
  return (
    <div className={`quiz-bar${feedback ? (feedback.ok ? ' ok' : ' bad') : ''}`} aria-live="polite">
      <div className="q-btns">
        <button type="button" className="rbtn main" onClick={() => say('name')} aria-label={t(p.lang, 'replay')}><PlayIcon /></button>
        <button type="button" className="rbtn" onClick={() => say('slow')} aria-label={`${t(p.lang, 'replay')} ${t(p.lang, 'slow')}`}><SlowIcon /></button>
      </div>
      <div className="q-mid">
        {feedback ? (
          feedback.ok
            ? <span className="q-fb ok">✓ {t(p.lang, 'right')} <b lang="en">{nameFor(q, p.accent)}</b> {q.zh}</span>
            : <span className="q-fb bad">✕ {t(p.lang, 'wrongWas')} <b lang="en">{nameFor(feedback.tapped, p.accent)}</b>; {t(p.lang, 'answerIs')} <b lang="en">{nameFor(q, p.accent)}</b> {q.zh}</span>
        ) : <span className="q-ask">{t(p.lang, 'question')}</span>}
        <div className="q-prog" aria-label={`${i + 1} / ${qs.length}`}>{qs.map((_, k) => <i key={k} className={k < i ? 'd' : k === i ? 'c' : ''} />)}<span>{i + 1}/{qs.length}</span></div>
      </div>
    </div>
  )
})
export default Quiz
