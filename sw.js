// Say the Elements service worker. Cache name carries the build id; a new deploy drops the old cache.
const CACHE = 'elements-614918d0fb50'
const SHELL = ['/', '/zh/', '/data/detail.json', '/fonts/inter.woff2', '/fonts/ipa.woff2', '/assets/Quiz-CNR1HHJM.js', '/assets/index-DMhAdt_x.js', '/assets/index-Ne-MdCvB.css', '/assets/shareCard-BOA_k2t2.js']
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', e => {
  const r = e.request
  if (r.method !== 'GET') return
  const u = new URL(r.url)
  if (u.origin !== location.origin) return
  if (r.mode === 'navigate') {
    e.respondWith(Promise.race([
      fetch(r).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(r, c)); return res }),
      new Promise((_, rej) => setTimeout(rej, 3000)),
    ]).catch(() => caches.match(r).then(m => m || caches.match(u.pathname.startsWith('/zh') ? '/zh/' : '/'))))
    return
  }
  if (/^\/(audio|img|og|fonts|assets|data)\//.test(u.pathname)) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(r, c)) } return res })))
  }
})
