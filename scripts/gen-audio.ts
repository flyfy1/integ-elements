// gen:audio — ElevenLabs clips through the Pi gateway, machine QA by transcription, ffmpeg post.
//   node scripts/gen-audio.ts                 dry run (default): prints calls and estimated cost
//   node scripts/gen-audio.ts --go            generate what is missing / changed
//   --only W,Og   --kinds name,slow,sentence   --pilot (test env, pilot word list)   --max-usd N
// Cache: raw answers in .agent/cache/audio/<key>.mp3; a manifest row per clip in
// data/audio-manifest.json. Same key + same file hash → skipped, so a re-run costs $0.
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { gw } from './lib/gateway.ts'
import { ROOT, sha256, writeAtomic, loadManifest, saveManifest, args, type Row } from './lib/manifest.ts'

type El = { z: number; symbol: string; slug: string; name: { iupac: string; us: string; uk: string }; ipa: { us: string | null; uk: string | null }; sentence: { us: string; uk: string } | null; review: { ipa: { us: string; uk: string } } }
const A = args()
const els: El[] = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8'))
const overrides: Record<string, { ph?: { us?: string; uk?: string }; alias?: { us?: string; uk?: string }; note?: string }> =
  existsSync(join(ROOT, 'data/tts-overrides.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/tts-overrides.json'), 'utf8')) : {}
const MAN = join(ROOT, A.pilot ? '.agent/pilot/audio-manifest.json' : 'data/audio-manifest.json')
const man = loadManifest(MAN)
const RAW = join(ROOT, '.agent/cache/audio')
const OUT = A.pilot ? join(ROOT, '.agent/pilot/audio') : join(ROOT, 'public/audio')
const TMP = join(tmpdir().startsWith('/var') ? '/tmp/agent-tasks/elements' : tmpdir(), `audio-${process.pid}`)
mkdirSync(RAW, { recursive: true }); mkdirSync(TMP, { recursive: true })
process.on('exit', () => rmSync(TMP, { recursive: true, force: true }))

const VOICE = { us: 'jessica', uk: 'lily' } as const
const PRICE_PER_CHAR = 0.08 / 1000
const TRANSCRIBE_PER_MIN = 0.0045
const kinds = (A.val('--kinds') ?? 'name,slow,sentence').split(',') as ('name' | 'slow' | 'sentence')[]
const maxUsd = A.maxUsd ?? 5
const PILOT = ['oganesson', 'darmstadtium', 'praseodymium', 'ytterbium', 'molybdenum', 'iron', 'caesium', 'aluminium', 'tungsten', 'xenon', 'argon', 'mercury', 'fluorine', 'germanium']

type Job = { el: El; accent: 'us' | 'uk'; kind: 'name' | 'slow' | 'sentence'; id: string }
const jobs: Job[] = []
for (const el of els) {
  if (A.only && !A.only.includes(el.symbol) && !A.only.includes(el.slug)) continue
  if (A.pilot && !PILOT.includes(el.slug)) continue
  for (const accent of ['us', 'uk'] as const) for (const kind of kinds) {
    if (kind === 'sentence' && !el.sentence) continue
    jobs.push({ el, accent, kind, id: `${accent}/${el.slug}.${kind}` })
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const nameOf = (el: El, a: 'us' | 'uk') => el.name[a]
/** The pronunciation the clip must carry: verified IPA of this accent, else the other verified accent. */
function phFor(el: El, a: 'us' | 'uk'): string | null {
  const o = overrides[el.slug]?.ph?.[a]
  if (o) return o
  if (el.review.ipa[a] === 'two-source' && el.ipa[a]) return el.ipa[a]
  return null
}

type Attempt = { rung: number; seed: number; body: Record<string, unknown> }
function ladder(j: Job): Attempt[] {
  const { el, accent, kind } = j
  const speed = kind === 'slow' ? 0.7 : 1.0
  const base = { model: 'elevenlabs/eleven_v4', voice: VOICE[accent], speed, language_code: 'en', response_format: 'mp3_44100_128', voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0 } }
  const name = nameOf(el, accent)
  const ph = phFor(el, accent)
  const tagged = ph ? `<phoneme alphabet="ipa" ph="${esc(ph)}">${name}</phoneme>` : null
  const out: Attempt[] = []
  const seeds = [7, 11, 23]
  const sentence = (n: string) => el.sentence![accent].replace(new RegExp(`\\b${name}\\b`, 'i'), n)
  if (tagged) for (const seed of seeds) out.push({ rung: 1, seed, body: { ...base, seed, input: kind === 'sentence' ? sentence(tagged) : `${tagged}.` } })
  for (const seed of seeds) out.push({ rung: 2, seed, body: { ...base, seed, input: kind === 'sentence' ? sentence(name) : `${name}.`, ...(kind === 'sentence' ? {} : { previous_text: 'The chemical element is called' }) } })
  const alias = overrides[el.slug]?.alias?.[accent]
  if (alias) for (const seed of seeds) out.push({ rung: 3, seed, body: { ...base, seed, input: kind === 'sentence' ? sentence(alias) : `${alias}.` } })
  return out
}

const norm = (s: string) => s.replace(/\bU\.S\./g, 'US').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
function wer(ref: string, hyp: string): number {
  const r = norm(ref).split(' '), h = norm(hyp).split(' ')
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)])
  for (let j = 1; j <= h.length; j++) d[0][j] = j
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return d[r.length][h.length] / r.length
}

let runSpend = 0
const costRecords: { id: string; cost: number }[] = []
async function call(path: string, o: Parameters<typeof gw>[1], est: number, kind: string, key: string, asset: string) {
  if (runSpend + est > maxUsd) throw new Error(`--max-usd ${maxUsd} reached (run spend $${runSpend.toFixed(3)})`)
  for (let i = 0; i < 5; i++) {
    const r = await gw(path, o)
    if (r.status === 429) { await new Promise(s => setTimeout(s, 2000 * (i + 1))); continue }
    runSpend += est
    man.calls.push({ id: r.requestId, key, asset, cost_usd: est, status: r.status, at: new Date().toISOString(), kind })
    costRecords.push({ id: r.requestId, cost: est })
    return r
  }
  throw new Error('429 five times')
}

async function transcribe(buf: Buffer, prompt: string | null, asset: string, durS: number) {
  const fd = new FormData()
  fd.append('model', 'default-transcribe'); fd.append('language', 'en')
  if (prompt) fd.append('prompt', prompt)
  fd.append('file', new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }), 'clip.mp3')
  const est = Math.max(2, durS) / 60 * TRANSCRIBE_PER_MIN
  const r = await call('/v1/audio/transcriptions', { form: fd, env: A.pilot ? 'test' : 'production', task: 'elements.qa' }, est, 'transcribe', '', asset)
  if (r.status !== 200) return ''
  try { return String(JSON.parse(r.text()).text ?? '') } catch { return '' }
}

function ff(args: string[]): string {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
}
function loudness(file: string): { I: number; TP: number } {
  let err = ''
  try { execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) { err = String((e as { stderr: Buffer }).stderr) }
  if (!err) err = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128=peak=true:framelog=quiet -f null - 2>&1`], { encoding: 'utf8' })
  const I = Number(err.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? -70)
  const TP = Number(err.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? 0)
  return { I, TP }
}
function duration(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim())
}
/** trim lead ≤ 20 ms / tail 120 ms, 5 ms fades, gain to −18 LUFS + peak limiter, mp3 mono 64 k */
function post(rawFile: string, outFile: string) {
  const t1 = join(TMP, 'trim.wav')
  ff(['-i', rawFile, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse', '-ac', '1', '-ar', '44100', t1])
  const d = duration(t1)
  const t2 = join(TMP, 'fade.wav')
  ff(['-i', t1, '-af', `afade=t=in:d=0.005,afade=t=out:st=${Math.max(0, d - 0.005).toFixed(3)}:d=0.005`, t2])
  const { I, TP } = loudness(t2)
  void TP
  // one gain to −18 LUFS; a gentle peak limiter (−2 dBFS sample peak) keeps short, peaky names from being quieter than the rest
  const gain = Math.min(14, -18 - I)
  mkdirSync(join(outFile, '..'), { recursive: true })
  const tmpOut = `${outFile}.tmp.mp3`
  ff(['-i', t2, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.794:attack=3:release=60:level=false:asc=1`, '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-ar', '44100', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '1', tmpOut])
  execFileSync('mv', [tmpOut, outFile])
  const after = loudness(outFile)
  return { duration_ms: Math.round(duration(outFile) * 1000), lufs: Math.round(after.I * 10) / 10, peak_db: Math.round(after.TP * 10) / 10, gain_db: Math.round(gain * 10) / 10 }
}

/** sound-alike similarity of an unprompted transcript to the name (1 = same after light spelling normalisation) */
function sim(text: string, name: string): number {
  const f = (x: string) => norm(x).replace(/\s/g, '').replace(/^x/, 'z').replace(/ph/g, 'f').replace(/y/g, 'i').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/(.)\1/g, '$1')
  const a = f(text), b = f(name)
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1)
}
const WEAK_SIM = Number(A.val('--weak-sim') ?? 0.7)

/** 'pass' exact; 'weak' for a sentence whose only miss is a sound-alike spelling of the name (Itrium, cesium); null otherwise */
function judge(j: Job, text: string): 'pass' | 'weak' | null {
  const names = [j.el.name.us, j.el.name.uk, j.el.name.iupac].map(norm)
  const t = norm(text)
  if (j.kind !== 'sentence') return names.includes(t) ? 'pass' : names.some(n => sim(t, n) >= 0.8) ? 'weak' : null
  const canon = (x: string) => norm(x).split(' ').map(w => (names.includes(w) ? '<el>' : w)).join(' ')
  if (wer(canon(j.el.sentence![j.accent]), canon(text)) <= 0.1 && canon(text).split(' ').includes('<el>')) return 'pass'
  const fuzzy = norm(text).split(' ').map(w => (names.some(n => sim(w, n) >= 0.7) ? '<el>' : w)).join(' ')
  if (wer(canon(j.el.sentence![j.accent]), fuzzy) <= 0.1 && fuzzy.split(' ').includes('<el>')) return 'weak'
  return null
}

const fileOf = (j: Job) => join(OUT, j.accent, `${j.el.slug}${j.kind === 'name' ? '' : '.' + j.kind}.mp3`)

async function run(j: Job): Promise<string> {
  const ladderSteps = ladder(j)
  const cur = man.assets[j.id]
  const target = fileOf(j)
  // skip when the current row came from this ladder (same key family) and the file is intact
  if (!A.force && cur && existsSync(target) && sha256(readFileSync(target)) === cur.sha256 && ladderSteps.some(s => keyOf(s) === cur.key) && cur.qa.machine !== 'fail' && !(cur.qa.machine === 'weak' && cur.rung === 1 && sim(cur.qa.transcript ?? '', j.el.name[j.accent]) < WEAK_SIM && !(cur.qa.notes ?? '').includes('weak-sim-checked'))) return 'cached'
  const est = (s: Attempt) => String(s.body.input).length * PRICE_PER_CHAR
  if (!A.go) { console.log(`[dry] ${j.id} rung${ladderSteps[0]?.rung} ${String(ladderSteps[0]?.body.input).length} chars ≈ $${est(ladderSteps[0]).toFixed(4)}`); return 'dry' }
  let lastWeak: { s: Attempt; raw: string; text: string } | null = null
  let lastAny: { s: Attempt; raw: string; text: string } | null = null
  const tried: string[] = []
  for (const s of ladderSteps) {
    const key = keyOf(s)
    const raw = join(RAW, `${key}.mp3`)
    let reqId = ''
    if (!existsSync(raw)) {
      const r = await call('/v1/audio/speech', { json: s.body, env: A.pilot ? 'test' : 'production', task: A.pilot ? 'elements.pilot' : 'elements.tts' }, est(s), 'speech', key, j.id)
      if (r.status !== 200 || !r.contentType.includes('audio')) { console.log(`  ${j.id} speech ${r.status} ${r.text().slice(0, 120)}`); continue }
      writeAtomic(raw, r.body); reqId = r.requestId
      writeAtomic(`${raw}.json`, JSON.stringify({ request_id: reqId, body: s.body }))
    } else if (existsSync(`${raw}.json`)) reqId = JSON.parse(readFileSync(`${raw}.json`, 'utf8')).request_id
    const p = post(raw, join(TMP, 'cand.mp3'))
    const buf = readFileSync(join(TMP, 'cand.mp3'))
    const text = await transcribe(buf, null, j.id, p.duration_ms / 1000)
    tried.push(`r${s.rung}s${s.seed}:"${text}"`)
    let machine: string | null = judge(j, text)
    if (machine === 'weak' && s.rung === 1) return finish(j, s, raw, reqId, machine, text, tried)
    if (!machine && j.kind !== 'sentence') {
      // a rare name the transcriber cannot spell unprompted: re-check once with the name as prompt
      const t2 = await transcribe(buf, `${j.el.name[j.accent]}.`, j.id, p.duration_ms / 1000)
      tried.push(`  prompted:"${t2}"`)
      if (judge(j, t2)) machine = 'weak'
    }
    lastAny = { s, raw, text }
    if (machine === 'pass') return finish(j, s, raw, reqId, machine, text, tried)
    // rung-1 weak: the IPA tag is honoured and the transcriber just spells a rare name oddly; accept when it sounds alike,
    // otherwise keep climbing (a clean plain-name pass beats a far-off tagged one)
    if (machine === 'weak' && s.rung === 1 && sim(text, j.el.name[j.accent]) >= WEAK_SIM) return finish(j, s, raw, reqId, machine, text, tried)
    if (machine === 'weak' && !lastWeak) lastWeak = { s, raw, text }
  }
  if (lastWeak) { tried.push('weak-sim-checked'); return finish(j, lastWeak.s, lastWeak.raw, '', 'weak', lastWeak.text, tried) }
  if (lastAny) return finish(j, lastAny.s, lastAny.raw, '', 'fail', lastAny.text, tried)
  return 'error'
}

function keyOf(s: Attempt) { return sha256(JSON.stringify(s.body)) }

function finish(j: Job, s: Attempt, raw: string, reqId: string, machine: string, text: string, tried: string[]) {
  const target = fileOf(j)
  const p = post(raw, target)
  const buf = readFileSync(target)
  if (!reqId && existsSync(`${raw}.json`)) reqId = JSON.parse(readFileSync(`${raw}.json`, 'utf8')).request_id
  const row: Row = {
    key: keyOf(s), file: target.replace(ROOT, ''), sha256: sha256(buf), bytes: buf.length, ...p, rung: s.rung, seed: s.seed, attempt: tried.filter(t => t.startsWith('r')).length,
    input: s.body.input, voice: s.body.voice, speed: s.body.speed,
    qa: { machine, human: null, transcript: text, notes: tried.join(' ') },
    gateway_request_id: reqId, cost_usd: Math.round(String(s.body.input).length * PRICE_PER_CHAR * 1e5) / 1e5, created: new Date().toISOString(),
  }
  man.assets[j.id] = row
  saveManifest(MAN, man)
  console.log(`${machine.padEnd(4)} ${j.id} rung${s.rung} seed${s.seed} ${p.duration_ms}ms "${text}"${tried.length > 1 ? '  [' + tried.join(' ') + ']' : ''}`)
  return machine
}

// ---- --repost: re-run local post-processing on the chosen raw of every manifest row ($0) ----
if (A.has('--repost')) {
  let n = 0
  for (const j of jobs) {
    const cur = man.assets[j.id]
    if (!cur) continue
    const raw = join(RAW, `${cur.key}.mp3`)
    if (!existsSync(raw)) { console.log(`  no raw for ${j.id}`); continue }
    const p = post(raw, fileOf(j))
    const buf = readFileSync(fileOf(j))
    Object.assign(cur, p, { sha256: sha256(buf), bytes: buf.length })
    n++
  }
  saveManifest(MAN, man)
  console.log(`reposted ${n}`)
  process.exit(0)
}

// ---- main: concurrency 3 ----
const res: Record<string, number> = {}
let i = 0
let stop = false
await Promise.all(Array.from({ length: 3 }, async () => {
  while (i < jobs.length && !stop) {
    const j = jobs[i++]
    try { const r = await run(j); res[r] = (res[r] ?? 0) + 1 } catch (e) { console.log('STOP', String(e)); stop = true }
  }
}))
saveManifest(MAN, man)
const estTotal = jobs.reduce((s, j) => s + String(ladder(j)[0]?.body.input ?? '').length * PRICE_PER_CHAR, 0)
console.log(JSON.stringify({ jobs: jobs.length, results: res, run_spend_est: Math.round(runSpend * 1e4) / 1e4, first_pass_estimate: Math.round(estTotal * 1e3) / 1e3, manifest_spend: man.spend_usd }))
void writeFileSync
