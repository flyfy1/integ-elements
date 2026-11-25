// Image QA (free, local): OCR every picture for stray text, then build contact sheets (chunks of 30, labelled with
// number, name and prompt subject) for a human or vision pass. Writes qa.machine (ocr) into data/image-manifest.json;
// verdicts from looking at the sheets go in .agent/review/image-verdicts.json ({slug: "ok" | "regen: reason"}).
//   node scripts/qa-images.ts [--out /tmp/agent-tasks/elements/contact] [--only a,b]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { ROOT, args, loadManifest, saveManifest } from './lib/manifest.ts'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const A = args()
const OUT = A.val('--out') ?? '/tmp/agent-tasks/elements/contact'
mkdirSync(OUT, { recursive: true })
const els: Any[] = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8'))
const MAN = join(ROOT, 'data/image-manifest.json')
const man = loadManifest(MAN) as Any
const verdictsFile = join(ROOT, '.agent/review/image-verdicts.json')
const verdicts: Record<string, string> = existsSync(verdictsFile) ? JSON.parse(readFileSync(verdictsFile, 'utf8')) : {}

const worker = await createWorker('eng', 1, { cachePath: join(ROOT, '.agent/cache/tesseract'), logger: () => {} })
let flagged = 0
for (const e of els) {
  const r = man.assets[e.slug]
  if (!r || (A.only && !A.only.includes(e.slug) && !A.only.includes(e.symbol))) continue
  const src = join(ROOT, 'public/img', `${e.slug}.960.webp`)
  if (!existsSync(src)) continue
  const png = await sharp(src).greyscale().normalise().png().toBuffer()
  const { data } = (await worker.recognize(png, {}, { blocks: true, text: true })) as unknown as { data: Any }
  // real text: words of ≥ 3 letters recognised with decent confidence
  const words = (data.blocks?.flatMap((b: Any) => b.paragraphs.flatMap((p: Any) => p.lines.flatMap((l: Any) => l.words))) ?? [] as Any[])
    .filter((w: Any) => w.confidence > 70 && /^[A-Za-z]{3,}$/.test(w.text))
    .map((w: Any) => w.text)
  r.qa = { ...(r.qa ?? {}), machine: words.length ? `ocr: ${words.join(' ')}` : 'ocr-clean', human: r.qa?.human ?? null }
  if (words.length) { flagged++; console.log(`OCR ${e.slug}: ${words.join(' ')}`) }
}
await worker.terminate()
saveManifest(MAN, man as never)

// contact sheets: 6 × 5 tiles of 300 px + label strip
const done = els.filter(e => existsSync(join(ROOT, 'public/img', `${e.slug}.480.webp`)))
const T = 300, L = 46, C = 6
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
for (let k = 0; k * 30 < done.length; k++) {
  const chunk = done.slice(k * 30, k * 30 + 30)
  const rows = Math.ceil(chunk.length / C)
  const comps: { input: Buffer; left: number; top: number }[] = []
  for (const [i, e] of chunk.entries()) {
    const x = (i % C) * T, y = Math.floor(i / C) * (T + L)
    comps.push({ input: await sharp(join(ROOT, 'public/img', `${e.slug}.480.webp`)).resize(T, T).toBuffer(), left: x, top: y })
    const r = man.assets[e.slug] ?? {}
    const ocr = String(r.qa?.machine ?? '').startsWith('ocr:') ? ' ⚠OCR' : ''
    const sub = String(r.prompt_subject ?? '').slice(0, 44)
    comps.push({ input: Buffer.from(`<svg width="${T}" height="${L}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="18" font-family="Helvetica" font-size="15" fill="#fff" font-weight="bold">${e.z} ${esc(e.name.iupac)} · ${r.style ?? ''}${ocr}</text><text x="6" y="37" font-family="Helvetica" font-size="12" fill="#bbb">${esc(sub)}</text></svg>`), left: x, top: y + T })
  }
  const f = join(OUT, `contact-${String(k + 1).padStart(2, '0')}.png`)
  await sharp({ create: { width: C * T, height: rows * (T + L), channels: 3, background: '#000' } }).composite(comps).png().toFile(f)
  console.log(f)
}
mkdirSync(join(ROOT, '.agent/review'), { recursive: true })
writeFileSync(join(ROOT, '.agent/review/contact-sheet.html'), `<!doctype html><meta charset="utf-8"><title>image contact sheet</title><style>body{background:#000;color:#ddd;font:13px system-ui}div{display:inline-block;width:240px;margin:4px;vertical-align:top}img{width:240px;height:240px}</style>
${done.map(e => `<div><img src="../../public/img/${e.slug}.480.webp"><br>${e.z} ${esc(e.name.iupac)} · ${esc(String(man.assets[e.slug]?.qa?.machine ?? ''))} ${esc(verdicts[e.slug] ?? '')}<br><small>${esc(String(man.assets[e.slug]?.prompt_subject ?? ''))}</small></div>`).join('\n')}`)
console.log(`${done.length} images; ${flagged} OCR-flagged`)
