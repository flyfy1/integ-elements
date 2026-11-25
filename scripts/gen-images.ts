// gen:images — one "specimen on dark slate" picture per element via the Pi gateway, then
// local webp 960/480, palette + blurred preview, and the 1200×630 OG card (sharp, free).
//   node scripts/gen-images.ts            dry run: prints count and estimate
//   --go  --only Cu,Ne  --quality medium|high  --pilot  --attempt N (new attempt = new key)
//   --post-only   (rebuild webp/OG from the cached PNGs, $0)
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { gw } from './lib/gateway.ts'
import { ROOT, sha256, writeAtomic, loadManifest, saveManifest, args, type Row } from './lib/manifest.ts'

type El = { z: number; symbol: string; slug: string; category: string; name: { iupac: string; us: string; uk: string }; ipa: { us: string | null; uk: string | null }; zh: { name: string; pinyin: string }; image_subject: string | null; image_style: 'specimen' | 'sealed' | 'trace' | null; review: { ipa: { us: string; uk: string } } }
const A = args()
const els: El[] = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8'))
const MAN = join(ROOT, A.pilot ? '.agent/pilot/image-manifest.json' : 'data/image-manifest.json')
const man = loadManifest(MAN)
const RAW = join(ROOT, '.agent/cache/img')
const quality = A.val('--quality') ?? 'medium'
const maxUsd = A.maxUsd ?? 10
mkdirSync(RAW, { recursive: true })

export const CAT_HEX: Record<string, string> = {
  alkali: '#FF6B6B', 'alkaline-earth': '#FF9F43', transition: '#FFD43B', 'post-transition': '#A3B8CC', metalloid: '#2DD4BF',
  nonmetal: '#7EE787', halogen: '#38BDF8', 'noble-gas': '#A78BFA', lanthanide: '#F472B6', actinide: '#D946EF',
}
const STYLE_ANCHOR = `Studio macro photograph for a museum catalogue. One single subject, centred, filling about
60 percent of the frame, resting on a matte dark slate surface. Background is a smooth deep
navy-charcoal gradient (#0B1020 to #05070D), completely empty. Soft key light from the upper
left, a thin rim light from behind in the accent colour, gentle reflection on the slate,
shallow depth of field, crisp focus on the subject, physically accurate materials, rich but
natural colour. Square composition with clear empty margin on all sides.
Absolutely no text, letters, numbers, symbols, labels, captions, logos, watermarks, borders
or frames anywhere in the image. No people, no hands, no faces.`
const VARIANT = {
  specimen: 'The subject is shown as the real material or object, clean and undamaged.',
  sealed: 'The subject is sealed inside a small clear glass ampoule lying on the slate, with a faint soft glow from within.',
  trace: 'The subject is a solid block of clear optical glass containing one thin, bright, curved particle track of light inside it; nothing else.',
}
// trace pictures are abstract on purpose; vary only the shape of the track so the set is not 22 copies
const TRACK = ['a gentle spiral that tightens toward its end', 'a long graceful arc', 'a short curl that splits into two fine branches', 'a looping S-curve', 'a tight helix seen from the side', 'a wide sweeping hook', 'a slow wavy line', 'a curve that ends in a small bright burst']
const SUBJ_OVR: Record<string, { subject: string }> = existsSync(join(ROOT, 'data/image-overrides.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/image-overrides.json'), 'utf8')) : {}
export const subjectOf = (el: El) => SUBJ_OVR[el.slug]?.subject ?? el.image_subject
export function promptFor(el: El) {
  const subj = el.image_style === 'trace' ? `${subjectOf(el)}, shaped as ${TRACK[el.z % TRACK.length]}` : subjectOf(el)
  return `${STYLE_ANCHOR}\n\nSubject: ${subj}.\n${VARIANT[el.image_style!]}\nAccent light colour: ${CAT_HEX[el.category]}.`
}

const PILOT = ['Cu', 'Ne', 'Au', 'He', 'U', 'Og']
const list = els.filter(e => (A.only ? A.only.includes(e.symbol) : A.pilot ? PILOT.includes(e.symbol) : true))
const attemptOverride = A.val('--attempt') ? Number(A.val('--attempt')) : undefined

async function postProcess(el: El, png: string, row: Partial<Row>) {
  const outDir = A.pilot ? join(ROOT, '.agent/pilot/img', quality) : join(ROOT, 'public/img')
  mkdirSync(outDir, { recursive: true })
  const img = sharp(png)
  const f960 = join(outDir, `${el.slug}.960.webp`), f480 = join(outDir, `${el.slug}.480.webp`)
  // keep each file ≤ 90 KB: step quality down if needed
  for (const [file, w, q0] of [[f960, 960, 82], [f480, 480, 80]] as const) {
    let q = q0
    let buf = await img.clone().resize(w, w).webp({ quality: q, effort: 6 }).toBuffer()
    while (buf.length > (w === 960 ? 90_000 : 32_000) && q > 50) { q -= 6; buf = await img.clone().resize(w, w).webp({ quality: q, effort: 6 }).toBuffer() }
    writeAtomic(file, buf)
  }
  // 16 px blurred preview + 4-colour palette (k-means-lite over a 24 px thumbnail)
  const tiny = await img.clone().resize(16, 16).webp({ quality: 40 }).toBuffer()
  const { data } = await img.clone().resize(24, 24).raw().toBuffer({ resolveWithObject: true })
  const px: number[][] = []
  for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i + 1], data[i + 2]])
  const bright = px.filter(p => p[0] + p[1] + p[2] > 90)
  const pool = bright.length > 20 ? bright : px
  let cents = [0, 1, 2, 3].map(k => pool[Math.floor((k + 0.5) * pool.length / 4)])
  for (let it = 0; it < 8; it++) {
    const sums = cents.map(() => [0, 0, 0, 0])
    for (const p of pool) {
      let bi = 0, bd = 1e9
      cents.forEach((c, i) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (d < bd) { bd = d; bi = i } })
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; sums[bi][3]++
    }
    cents = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[i]))
  }
  const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
  row.palette = cents.map(hex)
  row.preview = `data:image/webp;base64,${tiny.toString('base64')}`
  row.bytes_960 = readFileSync(f960).length
  row.bytes_480 = readFileSync(f480).length
  if (!A.pilot) await og(el, png)
}

const escX = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
async function og(el: El, png: string) {
  const dir = join(ROOT, 'public/og'); mkdirSync(dir, { recursive: true })
  const hexc = CAT_HEX[el.category]
  const ipaLine = [el.review.ipa.us === 'two-source' && el.ipa.us ? `US /${el.ipa.us}/` : '', el.review.ipa.uk === 'two-source' && el.ipa.uk ? `UK /${el.ipa.uk}/` : ''].filter(Boolean).join('   ')
  const nameLine = el.name.us !== el.name.uk ? `${el.name.uk} / ${el.name.us}` : el.name.iupac
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><radialGradient id="g" cx="0.25" cy="0.3" r="0.9"><stop offset="0" stop-color="#101A33"/><stop offset="1" stop-color="#070B14"/></radialGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="64" y="96" width="180" height="200" rx="22" fill="${hexc}" fill-opacity="0.16" stroke="${hexc}" stroke-opacity="0.5" stroke-width="2"/>
  <text x="84" y="132" font-family="Inter, Helvetica, Arial" font-size="24" fill="#93A0BD">${el.z}</text>
  <text x="154" y="236" text-anchor="middle" font-family="Inter, Helvetica, Arial" font-weight="700" font-size="92" fill="${hexc}">${el.symbol}</text>
  <text x="64" y="380" font-family="Inter, Helvetica, Arial" font-weight="700" font-size="${nameLine.length > 16 ? 50 : 64}" fill="#EAF0FF">${escX(nameLine)}</text>
  <text x="64" y="436" font-family="'Noto Sans', 'Lucida Grande', 'DejaVu Sans', sans-serif" font-size="30" fill="#7CF5D4">${escX(ipaLine)}</text>
  <text x="64" y="492" font-family="'PingFang SC', 'Noto Sans SC', sans-serif" font-size="34" fill="#EAF0FF">${escX(el.zh.name)} <tspan fill="#93A0BD">${escX(el.zh.pinyin)}</tspan></text>
  <text x="64" y="572" font-family="Inter, Helvetica, Arial" font-size="24" fill="#93A0BD">Say the Elements · 元素怎么读 · elements.integ.life</text>
</svg>`
  const pic = await sharp(png).resize(520, 520).toBuffer()
  const mask = Buffer.from(`<svg width="520" height="520"><defs><radialGradient id="m"><stop offset="0.6" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><rect width="520" height="520" fill="url(#m)"/></svg>`)
  const faded = await sharp(pic).composite([{ input: await sharp(mask).toColourspace('b-w').toBuffer(), blend: 'dest-in' }]).png().toBuffer()
  const out = await sharp(Buffer.from(svg)).composite([{ input: faded, left: 640, top: 55 }]).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  writeAtomic(join(dir, `${el.slug}.jpg`), out)
}

// ---- main ----
const COST_EST = quality === 'high' ? 0.054 : quality === 'low' ? 0.025 : 0.045 // measured in the pilot (gateway log, 1024×1024)
let spent = 0, made = 0, skipped = 0
const todo: El[] = []
for (const el of list) {
  if (!el.image_subject || !el.image_style) { console.log('no subject', el.symbol); continue }
  const assetId = A.pilot ? `${quality}/${el.slug}` : el.slug
  const cur = man.assets[assetId]
  const attempt = attemptOverride ?? (cur?.attempt as number | undefined) ?? 1
  const prompt = promptFor(el)
  const key = sha256(JSON.stringify({ model: 'openai/gpt-image-2.6-flare', prompt, size: '1024x1024', quality, attempt }))
  const png = join(RAW, `${key}.png`)
  if (A.has('--post-only')) { if (cur && existsSync(join(RAW, `${cur.key}.png`))) { await postProcess(el, join(RAW, `${cur.key}.png`), cur); man.assets[assetId] = cur; saveManifest(MAN, man) } continue }
  if (!A.force && cur && cur.key === key && existsSync(png)) { skipped++; continue }
  todo.push(el)
  if (!A.go) { console.log(`[dry] ${el.symbol} ${el.image_style} q=${quality} attempt ${attempt}: ${el.image_subject}`); continue }
  let row: Partial<Row>
  if (existsSync(png)) row = { ...(cur ?? {}), key }
  else {
    if (spent + COST_EST > maxUsd) { console.log(`STOP: --max-usd ${maxUsd}`); break }
    const body = { model: 'openai/gpt-image-2.6-flare', prompt, size: '1024x1024', quality, output_format: 'png' }
    const r = await gw('/v1/images/generations', { json: body, env: A.pilot ? 'test' : 'production', task: A.pilot ? 'elements.pilot' : 'elements.image', timeoutMs: 300_000 })
    spent += COST_EST
    man.calls.push({ id: r.requestId, key, asset: assetId, cost_usd: COST_EST, status: r.status, at: new Date().toISOString(), kind: 'image' })
    saveManifest(MAN, man)
    if (r.status !== 200) { console.log(`ERR ${el.symbol} ${r.status} ${r.text().slice(0, 200)}`); continue } // never retried
    const b64 = JSON.parse(r.text()).data?.[0]?.b64_json
    if (!b64) { console.log(`ERR ${el.symbol} no image`); continue }
    writeAtomic(png, Buffer.from(b64, 'base64'))
    row = { key, gateway_request_id: r.requestId, cost_usd: COST_EST, created: new Date().toISOString() }
  }
  const buf = readFileSync(png)
  Object.assign(row, { file: png.replace(ROOT, ''), sha256: sha256(buf), bytes: buf.length, attempt, quality, prompt_subject: subjectOf(el), style: el.image_style, qa: (cur?.key === key ? cur.qa : null) ?? { machine: null, human: null } })
  await postProcess(el, png, row)
  man.assets[assetId] = row as Row
  saveManifest(MAN, man)
  made++
  console.log(`ok ${el.symbol} ${(buf.length / 1024).toFixed(0)} KB png → ${((row.bytes_960 as number) / 1024).toFixed(0)} KB webp`)
}
console.log(JSON.stringify({ todo: todo.length, made, skipped, est_usd_this_run: Math.round(spent * 100) / 100, dry_estimate: Math.round(todo.length * COST_EST * 100) / 100, manifest_spend: man.spend_usd }))
