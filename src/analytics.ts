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
