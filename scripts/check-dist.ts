// Post-build guard: nothing gateway-related may reach the public bundle; every page and asset referenced exists.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/manifest.ts'

const DIST = join(ROOT, 'dist')
const BAD = [/127\.0\.0\.1:8111/, /localhost:8111/, /X-Integ/i, /gateway\.env/, /GATEWAY_/, /sk-[A-Za-z0-9]{20,}/, /xi-api-key/i]
const problems: string[] = []
let files = 0
function walk(d: string) {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!/\.(html|js|css|json|txt|xml|webmanifest)$/.test(f)) continue
    files++
    const s = readFileSync(p, 'utf8')
    for (const re of BAD) if (re.test(s)) problems.push(`${p.slice(DIST.length)} matches ${re}`)
  }
}
walk(DIST)
const els = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8')) as { slug: string }[]
for (const e of els) {
  for (const pre of ['', '/zh']) if (!existsSync(join(DIST, `${pre}/element/${e.slug}/index.html`))) problems.push(`missing page ${pre}/element/${e.slug}/`)
  for (const a of ['us', 'uk']) for (const k of ['', '.slow', '.sentence']) if (!existsSync(join(DIST, `audio/${a}/${e.slug}${k}.mp3`))) problems.push(`missing audio ${a}/${e.slug}${k}.mp3`)
  for (const f of [`img/${e.slug}.960.webp`, `img/${e.slug}.480.webp`, `og/${e.slug}.jpg`]) if (!existsSync(join(DIST, f))) problems.push(`missing ${f}`)
}
for (const f of ['sitemap.xml', 'robots.txt', 'llms.txt', 'sw.js', 'manifest.webmanifest', '404.html', 'CNAME', 'elements.json', 'data/detail.json']) if (!existsSync(join(DIST, f))) problems.push(`missing ${f}`)
const strict = !process.argv.includes('--lenient')
const missing = problems.filter(p => p.startsWith('missing '))
const leaks = problems.filter(p => !p.startsWith('missing '))
console.log(`check-dist: ${files} text files scanned; ${leaks.length} leak hits; ${missing.length} missing`)
for (const p of problems.slice(0, 30)) console.log('  ' + p)
if (leaks.length || (strict && missing.length)) process.exit(1)
