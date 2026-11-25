// Audio QA (free, local): checks every manifest row against its file and limits, counts first-try mismatches
// that were regenerated, and writes the listening sheet (all name clips with their IPA, hardest first).
// The sheet is for a human; nothing here marks `listened` or `human`.
//   node scripts/qa-audio.ts [--sheet /tmp/agent-tasks/elements/listen.html]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { ROOT, sha256, args } from './lib/manifest.ts'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const A = args()
const sheet = A.val('--sheet') ?? '/tmp/agent-tasks/elements/listen.html'
const els: Any[] = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8'))
const man: Any = JSON.parse(readFileSync(join(ROOT, 'data/audio-manifest.json'), 'utf8'))
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const problems: string[] = []
const stats = { rows: 0, pass: 0, weak: 0, fail: 0, missing: 0, regenerated: 0, rung: { 1: 0, 2: 0, 3: 0 } as Record<number, number> }
for (const e of els) for (const a of ['us', 'uk']) for (const k of ['name', 'slow', 'sentence']) {
  const id = `${a}/${e.slug}.${k}`
  const r = man.assets[id]
  if (!r) { stats.missing++; problems.push(`${id}: no manifest row`); continue }
  stats.rows++
  stats[r.qa.machine as 'pass' | 'weak' | 'fail']++
  stats.rung[r.rung] = (stats.rung[r.rung] ?? 0) + 1
  if (r.attempt > 1) stats.regenerated++
  const f = join(ROOT, r.file)
  if (!existsSync(f)) { problems.push(`${id}: file missing`); continue }
  if (sha256(readFileSync(f)) !== r.sha256) problems.push(`${id}: sha mismatch`)
  const [lo, hi] = k === 'sentence' ? [1500, 7000] : k === 'slow' ? [450, 3000] : [300, 2200]
  if (r.duration_ms < lo || r.duration_ms > hi) problems.push(`${id}: duration ${r.duration_ms} ms outside ${lo}-${hi}`)
  if (Math.abs(r.lufs + 18) > 1.5) problems.push(`${id}: loudness ${r.lufs} LUFS`)
  if (r.peak_db > -0.9) problems.push(`${id}: peak ${r.peak_db} dBTP`)
  if (r.qa.machine === 'fail') problems.push(`${id}: transcript "${r.qa.transcript}"`)
}

// listening sheet: name + slow clips, both accents, hardest first
const rows = els.map(e => {
  const t = e.tricky?.level ?? 0
  const w = ['us', 'uk'].reduce((s, a) => s + (man.assets[`${a}/${e.slug}.name`]?.qa.machine !== 'pass' ? 2 : 0) + (e.review.ipa[a] !== 'two-source' ? 1 : 0), 0)
  return { e, score: w * 3 + t }
}).sort((x, y) => y.score - x.score || x.e.z - y.e.z)
const cell = (e: Any, a: string) => {
  const n = man.assets[`${a}/${e.slug}.name`], s = man.assets[`${a}/${e.slug}.slow`]
  const ipa = e.review.ipa[a] === 'two-source' && e.ipa[a] ? `/${esc(e.ipa[a])}/` : `<span class="unv">unverified${e.sources?.[`ipa_${a}`]?.candidates ? ': ' + esc(e.sources[`ipa_${a}`].candidates.join('; ')) : ''}</span>`
  const au = (r: Any) => (r ? `<audio controls preload="none" src="file://${join(ROOT, r.file)}"></audio>` : '<i>missing</i>')
  const tag = (r: Any) => (r ? `<span class="m ${r.qa.machine}">${r.qa.machine} · rung ${r.rung}${r.attempt > 1 ? ` · try ${r.attempt}` : ''}</span> <span class="tx">heard “${esc(r.qa.transcript)}”</span>` : '')
  return `<td><div class="ipa">${a.toUpperCase()} ${esc(a === 'us' ? e.name.us : e.name.uk)} ${ipa} <span class="rs">${esc(e.respell?.[a] ?? '')}</span></div><div>${au(n)} ${tag(n)}</div><div class="slow">slow ${au(s)}</div><label><input type="checkbox" data-id="${a}/${e.slug}"> sounds right</label></td>`
}
const html = `<!doctype html><meta charset="utf-8"><title>Say the Elements · listening sheet</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:24px;background:#0b1020;color:#e8eefc}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #263050;padding:8px;vertical-align:top}
.ipa{font:16px 'Noto Sans','Lucida Grande',sans-serif;margin-bottom:4px}.rs{color:#9fb0d6;font-size:13px}.unv{color:#ffb86b;font-size:12px}audio{height:30px;vertical-align:middle}.slow{opacity:.8}
.m{font-size:11px;padding:1px 6px;border-radius:8px}.pass{background:#164a3a}.weak{background:#5a4210}.fail{background:#6a1d1d}.tx{color:#9fb0d6;font-size:12px}h1{margin:0 0 4px}p{color:#9fb0d6}
th{text-align:left;color:#9fb0d6;font-weight:500}td.z{font-size:20px;font-weight:600;width:110px}</style>
<h1>Listening sheet: all ${els.length} names, US and UK</h1>
<p>Hardest first (machine-weak, unverified IPA, tricky). Tick what sounds right; the ticks stay in this browser only (export with the button) and are not written into the site data. Clips are local files under ${esc(join(ROOT, 'public/audio'))}.</p>
<p><button onclick="navigator.clipboard.writeText(JSON.stringify([...document.querySelectorAll('input:checked')].map(i=>i.dataset.id)))">copy ticked ids</button></p>
<table><tr><th>Element</th><th>US</th><th>UK</th></tr>
${rows.map(({ e }) => `<tr><td class="z">${e.z} ${esc(e.symbol)}<br><small>${esc(e.zh.name)} ${esc(e.zh.pinyin)}${e.tricky ? ` · tricky ${e.tricky.level}` : ''}</small></td>${cell(e, 'us')}${cell(e, 'uk')}</tr>`).join('\n')}
</table>
<script>const K='listen-ticks';const s=new Set(JSON.parse(localStorage[K]||'[]'));document.querySelectorAll('input[data-id]').forEach(i=>{i.checked=s.has(i.dataset.id);i.onchange=()=>{i.checked?s.add(i.dataset.id):s.delete(i.dataset.id);localStorage[K]=JSON.stringify([...s])}})</script>`
mkdirSync(dirname(sheet), { recursive: true })
writeFileSync(sheet, html)
mkdirSync(join(ROOT, '.agent/review'), { recursive: true })
writeFileSync(join(ROOT, '.agent/review/audio-qa.json'), JSON.stringify({ stats, problems }, null, 1))
console.log(JSON.stringify(stats))
console.log(`${problems.length} problems`); for (const p of problems.slice(0, 40)) console.log('  ' + p)
console.log(`sheet: ${sheet}`)
