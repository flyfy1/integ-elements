// Google Analytics 4. Reuses the Lingulet property (English-learning audience); this site is told
// apart by hostname and "Elements · …" titles. integ.life convention: production host only,
// consent queued first, no auto page_view, no ads signals, fixed titles, empty referrer.
// Event parameters come from closed sets or numbers: never search text, never audio.
export const MEASUREMENT_ID = 'G-9YQMKJLGYB'
const HOST = 'elements.integ.life'

export type Page = 'Table' | 'Element' | 'Tricky' | 'Quiz' | 'Repeat' | 'About'
type W = Window & { dataLayer?: unknown[] }
let gtag: ((...args: unknown[]) => void) | null = null
const counts: Record<string, number> = {}
const once = new Set<string>()

function start() {
  const w = window as W
  if (gtag || !MEASUREMENT_ID || w.location.hostname !== HOST || w.top !== w.self) return !!gtag
  w.dataLayer = w.dataLayer || []
  gtag = function () {
    // gtag expects the Arguments object, not an array
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments)
  }
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' })
  gtag('js', new Date())
  gtag('set', { allow_google_signals: false, allow_ad_personalization_signals: false })
  gtag('config', MEASUREMENT_ID, { send_page_view: false })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.append(s)
  startEngage()
  return true
}

export function pageView(page: Page, path: string) {
  if (!start()) return
  gtag!('event', 'page_view', { send_to: MEASUREMENT_ID, page_title: `Elements · ${page}`, page_location: `https://${HOST}${path}`, page_referrer: '' })
}

export function track(event: string, params: Record<string, string | number> = {}, opts: { onceKey?: string; cap?: number } = {}) {
  if (!gtag) return
  if (opts.onceKey) { if (once.has(opts.onceKey)) return; once.add(opts.onceKey) }
  if (opts.cap) { counts[event] = (counts[event] ?? 0) + 1; if (counts[event] > opts.cap) return }
  gtag('event', event, { send_to: MEASUREMENT_ID, ...params })
}

export const bucketMs = (ms: number) => (ms < 50 ? 50 : ms < 100 ? 100 : ms < 150 ? 150 : ms < 300 ? 300 : ms < 600 ? 600 : ms < 1000 ? 1000 : 2000)

// ---- engagement (same scheme as the integ.life toys' engage.ts) ----
// The app calls act(kind) once per action; nothing is sent per tap. Sent, batched:
//   engage {kind, n, active_s}: per kind, deltas since the last flush; at most every 30 s of input, and on hide.
//   engage_milestone {kind, n}: a kind first reaches 1/10/50/100/500/1000 this page session (with the next flush).
//   session_end {active_s, actions, kinds, visit_n}: on hide; deltas since the last session_end; visit_n = distinct
//   days with a visit on this device (max 99).
// Active time: time with input in the last 5 s while visible, credited to the latest act() kind.
export type ActKind = 'play_audio' | 'slow' | 'quiz_answer' | 'element_open'
const STEPS = [1, 10, 50, 100, 500, 1000]
const tot: Record<string, number> = {}
const sent: Record<string, number> = {}
const ms: Record<string, number> = {}
let cur = ''
let last = -1e9
let upto = 0
let flushed = 0
let acts = 0
let actsSent = 0
let msAll = 0
let visit = 1

export function act(kind: ActKind) {
  if (!gtag) return
  cur = kind
  tot[kind] = (tot[kind] || 0) + 1
  acts++
}

function credit(t: number) {
  const e = Math.min(t, last + 5000)
  if (e > upto) {
    msAll += e - upto
    if (cur) ms[cur] = (ms[cur] || 0) + e - upto
    upto = e
  }
}

function input() {
  const t = performance.now()
  if (document.hidden) return
  credit(t)
  if (t > last + 5000) upto = t
  last = t
  if (t - flushed >= 30000) flush()
}

function flush(end?: 1) {
  for (const k in tot) {
    const n = tot[k] - (sent[k] || 0)
    const s = Math.round((ms[k] || 0) / 1000)
    if (n || s) {
      track('engage', { kind: k, n, active_s: s })
      ms[k] = (ms[k] || 0) - s * 1000
      flushed = performance.now()
    }
    for (const m of STEPS) if ((sent[k] || 0) < m && m <= tot[k]) track('engage_milestone', { kind: k, n: m })
    sent[k] = tot[k]
  }
  const s = Math.round(msAll / 1000)
  if (end && (acts > actsSent || s)) {
    track('session_end', { active_s: s, actions: acts - actsSent, kinds: Object.keys(tot).length, visit_n: visit })
    actsSent = acts
    msAll -= s * 1000
  }
}

function hide() {
  credit(performance.now())
  last = -1e9
  flush(1)
}

function startEngage() {
  try {
    const d = new Date()
    const day = d.getFullYear() * 1e4 + d.getMonth() * 100 + d.getDate() // a local-day key, not a date
    const [ld, n] = (localStorage.getItem('integ_visit') || '0,0').split(',').map(Number)
    visit = Math.min(99, ld === day ? n || 1 : n + 1)
    localStorage.setItem('integ_visit', day + ',' + visit)
  } catch {
    /* storage blocked: visit_n stays 1 */
  }
  for (const e of ['pointerdown', 'pointermove', 'keydown']) addEventListener(e, input, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => document.hidden && hide())
  addEventListener('pagehide', hide)
}
