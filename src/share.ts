// Who sent this visit, and the quiz challenge it carries. Read once, at load, before routing re-appends
// location.search: `r` = how the link left + hop (f1, c2, q1 …), no person or device id. A challenge is
// `c` (the atomic numbers of the questions, in order, joined by '.'), `s` (the sender's score) and
// `x` (the first one they missed; optional). All of it is taken out of the address bar here.
import { BY_Z } from './data'
import { track } from './analytics'

export type Method = 'f' | 'l' | 'c' | 'q' | 'd'
export type Challenge = { zs: number[]; score: number; tripped: number }
/** the last challenge sent from this device (questions, score and hop: a reply to it differs in score or hop),
 *  so opening your own link is not a "recipient" visit, but the friend's answer to it is */
const MINE = 'share.mine'

export const landing = (() => {
  const out = { recipient: false, src: 'none' as Method | 'none', hop: 0, challenge: null as Challenge | null }
  try {
    const q = new URLSearchParams(location.search)
    const m = /^([flcqd])([1-9])$/.exec(q.get('r') || '')
    if (m) { out.src = m[1] as Method; out.hop = Number(m[2]) }
    const raw = q.get('c') || ''
    const zs = raw ? raw.split('.').map(Number) : []
    const score = Number(q.get('s'))
    const x = Number(q.get('x'))
    let mine = ''
    try { mine = localStorage.getItem(MINE) || '' } catch { /* private mode */ }
    const own = !!raw && `${raw}|${score}|${out.hop}` === mine
    if (zs.length && zs.length <= 10 && zs.every(z => BY_Z.has(z)) && new Set(zs).size === zs.length
      && q.has('s') && Number.isInteger(score) && score >= 0 && score <= zs.length && !own)
      out.challenge = { zs, score, tripped: zs.includes(x) ? x : 0 }
    out.recipient = (!!m || !!out.challenge) && !own
    if (['r', 'c', 's', 'x'].some(k => q.has(k))) {
      for (const k of ['r', 'c', 's', 'x']) q.delete(k)
      history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash)
    }
  } catch { /* no URL API: a plain visit */ }
  return out
})()

/** `shared_landing`, once, recipients only (call after the first page_view has started GA) */
export const trackLanding = () => {
  if (landing.recipient) track('shared_landing', { src: landing.src, hop: landing.hop, kind: landing.challenge ? 'set' : 'plain' }, { onceKey: 'landing' })
}

/** hop for a share made now: one more than the link this visit arrived on */
export const hopOut = () => (landing.recipient ? Math.min(9, Math.max(1, landing.hop) + 1) : 1)

/** a share by somebody who came in through a shared link */
export const trackReply = (method: string) => {
  if (landing.recipient) track('reply_share', { method, hop: landing.hop })
}

/** the challenge link for a finished set: same questions, in the same order */
export function challengeUrl(lang: 'en' | 'zh', zs: number[], score: number, tripped: number, how: Method) {
  return `https://elements.integ.life${lang === 'zh' ? '/zh' : ''}/quiz/?c=${zs.join('.')}&s=${score}${tripped ? `&x=${tripped}` : ''}&r=${how}${hopOut()}`
}
export const markMine = (zs: number[], score: number) => {
  try { localStorage.setItem(MINE, `${zs.join('.')}|${score}|${hopOut()}`) } catch { /* private mode */ }
}

/** in-app browsers (WeChat, Weibo, QQ …) cannot share or download a file: the picture is shown to long-press */
export const IN_APP = typeof navigator !== 'undefined' && /MicroMessenger|Weibo|QQ\/|AlipayClient|DingTalk|Lark|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent)
