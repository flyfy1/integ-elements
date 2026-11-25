// data:draft — LLM-drafted text fields through headless `claude -p` (subscription, no API credit).
// Input per element: the cached Wikipedia article converted to plain text. Every fact and
// etymology line must carry a quote that is a literal substring of that text; drafts whose quotes
// do not match are rejected and redrafted. A second pass (--check) asks a fresh model whether the
// quote supports the claim. Output: data/drafts.json (merged by data:build).
//   node scripts/data-draft.ts [--only Fe,W] [--check] [--force]
//   node scripts/data-draft.ts --field hook   one-line punchline per element, compressed from the stored
//     etymology.en / fact.en only (the writer sees nothing else); deterministic guards + a --check pass
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { ROOT, writeAtomic, sha256, args } from './lib/manifest.ts'

const A = args()
const C = join(ROOT, '.agent/cache/sources')
const els = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8')) as { z: number; symbol: string; slug: string; name: { iupac: string; us: string; uk: string }; category: string; zh: { name: string }; standard_state: string; review: { ipa: { us: string; uk: string } }; ipa: { us: string | null; uk: string | null } }[]
const DRAFTS = join(ROOT, 'data/drafts.json')
const drafts: Record<string, Record<string, unknown>> = existsSync(DRAFTS) ? JSON.parse(readFileSync(DRAFTS, 'utf8')) : {}
const CACHE = join(ROOT, '.agent/cache/llm'); mkdirSync(CACHE, { recursive: true })

/** Raw wikitext → readable plain text (refs, templates, files, tables removed; links kept as labels). */
export function wikiText(w: string): string {
  let s = w.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '')
  // nested templates: strip innermost repeatedly, keeping a few inline ones' visible text
  for (let i = 0; i < 12; i++) {
    const before = s
    s = s.replace(/\{\{(?:lang|langx|transl|nowrap|small|lang-[a-z]+)\|(?:[^{}|]*\|)?([^{}|]*)\}\}/gi, '$1')
    s = s.replace(/\{\{(?:convert|cvt)\|([\d.,–-]+)\|([^{}|]+)[^{}]*\}\}/gi, '$1 $2')
    s = s.replace(/\{\{[^{}]*\}\}/g, '')
    if (s === before) break
  }
  s = s.replace(/\{\|[\s\S]*?\|\}/g, '')                               // tables
  s = s.replace(/\[\[(?:File|Image|Category):[^[\]]*(?:\[\[[^\]]*\]\][^[\]]*)*\]\]/gi, '')
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')               // links
  s = s.replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1').replace(/'''?/g, '').replace(/<[^>]+>/g, '')
  s = s.replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&minus;/g, '−').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function sourceText(z: number): string {
  const t = wikiText(readFileSync(join(C, `wikipedia/en-raw/${z}.wiki`), 'utf8'))
  const p = join(C, `wikipedia/en-text/${z}.txt`)
  mkdirSync(join(C, 'wikipedia/en-text'), { recursive: true })
  if (!existsSync(p) || readFileSync(p, 'utf8') !== t) writeFileSync(p, t)
  return t
}

/** The parts of the article worth giving the model: lead, etymology/history/naming, uses. */
function excerpt(t: string): string {
  const secs = t.split(/\n(?===+[^=])/)
  const lead = secs[0].slice(0, 3500)
  const pick = secs.slice(1).filter(s => /^==+\s*(Etymology|History|Name|Naming|Discovery|Applications|Uses|Occurrence|Characteristics|Properties)/i.test(s)).map(s => s.slice(0, 2200))
  return [lead, ...pick].join('\n\n').slice(0, 11000)
}

function claude(prompt: string, model: string): Promise<string> {
  const key = sha256(model + '\n' + prompt)
  const cp = join(CACHE, `${key}.txt`)
  if (!A.force && existsSync(cp)) return Promise.resolve(readFileSync(cp, 'utf8'))
  return new Promise((res, rej) => {
    const p = spawn('claude', ['-p', '--model', model, '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d))
    p.on('close', code => { if (code === 0) { writeFileSync(cp, out); res(out) } else rej(new Error(`claude exit ${code}: ${err.slice(0, 300)}`)) })
    p.stdin.end(prompt)
  })
}

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim()
function quoteOk(q: string | undefined, text: string) { return !!q && q.length >= 20 && norm(text).includes(norm(q)) }

const SPEC = `You write content for "Say the Elements", a site that teaches Chinese learners how to pronounce the 118 chemical element names in English.
For EACH element below, return one JSON object. Rules:
- fact.en: one surprising, concrete, true line, at most 110 characters, plain English (B1). It MUST be supported by fact_quote.
- fact_quote: an EXACT, VERBATIM substring (20–300 chars) copied character-for-character from that element's SOURCE text below. Do not paraphrase, do not join two places, do not fix typos.
- fact.zh: the same fact in natural Simplified Chinese, at most 40 Chinese characters.
- etymology.en: one line: source language + root + meaning (e.g. "From Swedish tung sten, 'heavy stone'"), at most 110 characters, supported by etymology_quote.
- etymology_quote: an EXACT verbatim substring of the SOURCE text that states the origin of the NAME. If the source does not say where the name comes from, set etymology and etymology_quote to null.
- etymology.zh: the same in Simplified Chinese, at most 40 characters.
- sentence.us / sentence.uk: one original example sentence, A2–B1 level, at most 12 words, naming the element exactly once with the given US / UK spelling, otherwise identical. Everyday or school context. sentence.zh: its Chinese translation.
- tricky: null unless Chinese speakers commonly mispronounce this name. Trap types: silent/reduced letters, stress on the wrong syllable, -con/-on read as a full vowel, ph/th clusters, x = /z/, y as a vowel, ch = /k/, g = /dʒ/, look-alike names (magnesium/manganese), ae, ng before s, a name that differs from the symbol habit (sodium/Na, potassium/K). Otherwise {"level":1|2|3 (3 = hardest), "traps":[{"wrong":"respelling of the typical wrong pronunciation, like MAL-ib-DEE-num", "why_en":"one sentence", "why_zh":"一句中文"}]}. Expect roughly one element in three to have a trap; do not invent traps.
- image_subject: one short noun phrase for a studio photograph of the element's real-world form or best-known use, physically accurate for the element (e.g. "a coil of bright copper wire", "a glowing red-orange neon tube bent into a simple loop", "a raw gold nugget", "a single silver foil balloon"). Never people, likenesses, flags, maps, logos, lab scenes, hazard symbols or anything with writing. For a gas, show the gas in a glowing discharge tube or a typical use that does not show writing.
- image_style: "specimen" for stable elements with a visible form or use; "sealed" for radioactive or dangerously reactive elements that exist in real amounts (sample in a sealed glass ampoule); "trace" for synthetic elements never seen in bulk (roughly 99–118, plus astatine and francium). For "trace", image_subject should describe only the colour feel of the particle track, e.g. "a single glowing particle track".
Return ONLY a JSON array of objects with keys: z, fact {en, zh}, fact_quote, etymology {en, zh} | null, etymology_quote | null, sentence {us, uk, zh}, tricky, image_subject, image_style. No markdown fences.`

async function draftBatch(batch: typeof els, extra = '') {
  const parts = batch.map(e => `### z=${e.z} ${e.name.iupac} (${e.symbol}); US spelling "${e.name.us}", UK spelling "${e.name.uk}"; category ${e.category}; standard state ${e.standard_state}; Chinese ${e.zh.name}
SOURCE (Wikipedia, plain text):
<<<
${excerpt(sourceText(e.z))}
>>>`)
  const prompt = `${SPEC}${extra}\n\n${parts.join('\n\n')}`
  const out = await claude(prompt, 'opus')
  const json = out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)
  return JSON.parse(json) as Record<string, unknown>[]
}

function validate(e: (typeof els)[0], d: Record<string, unknown>): string[] {
  const t = sourceText(e.z)
  const errs: string[] = []
  const f = d.fact as { en: string; zh: string } | undefined
  if (!f?.en || f.en.length > 110) errs.push('fact.en length')
  if (!f?.zh || [...f.zh].length > 40) errs.push('fact.zh length')
  if (!quoteOk(d.fact_quote as string, t)) errs.push('fact_quote not verbatim')
  if (d.etymology && !quoteOk(d.etymology_quote as string, t)) errs.push('etymology_quote not verbatim')
  const s = d.sentence as { us: string; uk: string; zh: string } | undefined
  for (const a of ['us', 'uk'] as const) {
    if (!s?.[a]) { errs.push('sentence missing'); continue }
    const n = (s[a].match(new RegExp(`\\b${e.name[a]}\\b`, 'gi')) || []).length
    if (n !== 1) errs.push(`sentence.${a} names ${e.name[a]} ${n}×`)
    if (s[a].split(/\s+/).length > 12) errs.push(`sentence.${a} > 12 words`)
  }
  if (!['specimen', 'sealed', 'trace'].includes(d.image_style as string)) errs.push('image_style')
  if (!d.image_subject) errs.push('image_subject')
  return errs
}

async function checkPass(e: (typeof els)[0], d: Record<string, unknown>) {
  const claims = [['fact', (d.fact as { en: string }).en, d.fact_quote]]
  if (d.etymology) claims.push(['etymology', (d.etymology as { en: string }).en, d.etymology_quote])
  const prompt = `For each claim, answer whether the quoted source text alone fully supports it. Be strict: numbers, names, superlatives and dates must match the quote. Reply ONLY with JSON: {"fact": "supported"|"not supported", "etymology": "supported"|"not supported"|null, "why": "short reason if not supported"}.
Element: ${e.name.iupac}
${claims.map(([k, c, q]) => `${k} CLAIM: ${c}\n${k} QUOTE: ${q}`).join('\n')}`
  const out = await claude(prompt, 'sonnet')
  // first balanced {...} (the model sometimes adds a second object or prose after it)
  const i = out.indexOf('{')
  let depth = 0, j = i, inStr = false
  for (; j < out.length; j++) {
    const ch = out[j]
    if (inStr) { if (ch === '\\') j++; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) break
  }
  return JSON.parse(out.slice(i, j + 1)) as { fact: string; etymology: string | null; why?: string }
}

// ---- --field hook: a short true line compressed from one stored line ----
type Hook = { en: string; zh: string; from: 'etymology' | 'fact' }
const HEDGE_EN = /\b(possibly|perhaps|probably|thought to|believed to|is thought|are thought|may|might|likely|uncertain|unclear|disputed|said to)\b/i
const HEDGE_ZH = /可能|据说|一般认为|被认为|认为|或许|也许|大概|一说|或因|相传|据称/
export const zhLen = (s: string) => [...s.replace(/[。，、：；“”‘’（）()「」·\s.,:;'"!?！？-]/g, '')].length
/** deterministic guards; returns problems (empty = ok) */
export function hookProblems(h: Hook, src: { etymology: string | null; fact: string | null }): string[] {
  const line = h.from === 'etymology' ? src.etymology : h.from === 'fact' ? src.fact : null
  const errs: string[] = []
  if (!line) return ['no stored line for from']
  if (h.en.length > 44) errs.push(`en ${h.en.length} > 44`)
  if (zhLen(h.zh) > 16) errs.push(`zh ${zhLen(h.zh)} > 16`)
  if (/[!！]|\p{Extended_Pictographic}/u.test(h.en + h.zh)) errs.push('exclamation or emoji')
  if (/pronounc|\bsay\b|\bsaid\b(?! to)|\bsound|rhyme|spell/i.test(h.en) || /读音|发音|念作|读作|拼写/.test(h.zh)) errs.push('mentions a reading')
  for (const d of h.en.match(/\d[\d.,]*/g) ?? []) if (!line.includes(d.replace(/[.,]$/, ''))) errs.push(`number ${d} not in line`)
  for (const d of h.zh.match(/\d[\d.,]*/g) ?? []) if (!line.includes(d.replace(/[.,]$/, ''))) errs.push(`zh number ${d} not in line`)
  const words = h.en.split(/[\s:;,.()'"‘’“”—–-]+/).filter(Boolean)
  for (const w of words.slice(1)) if (/^[A-Z]/.test(w) && !line.toLowerCase().includes(w.toLowerCase())) errs.push(`word ${w} not in line`)
  if (HEDGE_EN.test(line) && !HEDGE_EN.test(h.en)) errs.push('hedge dropped (en)')
  if (HEDGE_EN.test(line) && !HEDGE_ZH.test(h.zh)) errs.push('hedge dropped (zh)')
  return errs
}
const HOOK_SPEC = `You write "hooks" for "Say the Elements", a site that teaches the English names of the chemical elements to Chinese learners. A hook is ONE short true line that makes the name stick. It appears on screen when someone taps an element.
For each element you get its stored ETYMOLOGY line and its stored FACT line (each already checked against Wikipedia), and their Chinese versions. Pick the one that makes the better hook and compress it to a punchline. Rules:
- Use ONLY what that one stored line says. Do not add any fact, number, date, language, place, person or meaning that the line does not contain. Do not combine the two lines.
- Hedges survive: if the line says "possibly", "thought to", "perhaps", "probably", keep that hedge in the English hook and an equivalent (可能/据说/或许) in the Chinese one.
- English: at most 44 characters, one clause, deadpan; the fact is the joke. No exclamation marks, no emoji, no puns, nothing about how the name is pronounced or spelled. Do not start with the element's name (it is already on screen).
- Chinese: at most 16 Chinese characters (punctuation not counted), written natively from the same stored line (not a translation of your English hook), same deadpan voice.
- "from": "etymology" or "fact", whichever line you compressed.
- No filler. If neither line has anything worth a hook (e.g. it is only "named after a person/place" with nothing surprising, or it is dry), return hook null. Quality over coverage, but most elements have something.
Good examples (voice only):
- line "From German Nickel, a mischievous sprite in miners' folklore" → {"en":"Named after a mischievous mine sprite.","zh":"名字来自矿井里的捣蛋小妖。","from":"etymology"}
- line "Possibly from German kobelt, the name miners gave a nuisance type of ore" → {"en":"Possibly named for an ore miners hated.","zh":"可能得名于一种矿工嫌弃的矿石。","from":"etymology"}
- line "Pencil 'leads' in wooden pencils have never been made from lead." → {"en":"Pencil lead was never lead.","zh":"铅笔里从来没有铅。","from":"fact"}
Return ONLY a JSON array: [{"z": number, "hook": {"en","zh","from"} | null}]. No markdown fences.`

async function hookMode() {
  type E = (typeof els)[0] & { fact: { en: string; zh: string } | null; etymology: { en: string; zh: string } | null }
  const list = (els as E[]).filter(e => (A.only ? A.only.includes(e.symbol) : true) && (e.fact || e.etymology) && (A.force || !drafts[e.z]?.hook_review))
  const src = (e: E) => ({ etymology: e.etymology?.en ?? null, fact: e.fact?.en ?? null })
  const block = (e: E) => `### z=${e.z} ${e.name.us} (${e.symbol})\nETYMOLOGY: ${e.etymology?.en ?? '(none)'}${e.etymology ? ` / ${e.etymology.zh}` : ''}\nFACT: ${e.fact?.en ?? '(none)'}${e.fact ? ` / ${e.fact.zh}` : ''}`
  const batches: E[][] = []
  for (let i = 0; i < list.length; i += 15) batches.push(list.slice(i, i + 15))
  let bi = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (bi < batches.length) {
      let pending = batches[bi++]
      const why: Record<number, string> = {}
      for (let round = 0; round < 3 && pending.length; round++) {
        const extra = round ? `\n\nSome earlier hooks were rejected; reasons are given per element. Fix them or return null.\n${pending.map(e => `z=${e.z}: ${why[e.z]}`).join('\n')}\n(round ${round + 1})` : ''
        let res: { z: number; hook: Hook | null }[]
        try { const out = await claude(`${HOOK_SPEC}${extra}\n\n${pending.map(block).join('\n\n')}`, 'opus'); res = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)) } catch (err) { console.log('hook batch error', String(err).slice(0, 160)); continue }
        const next: E[] = []
        for (const e of pending) {
          const r = res.find(x => Number(x.z) === e.z)
          if (!r) { why[e.z] = 'missing'; next.push(e); continue }
          if (!r.hook) { drafts[e.z] = { ...drafts[e.z], hook: null, hook_review: { verdict: 'writer-null' } }; continue }
          const probs = hookProblems(r.hook, src(e))
          if (probs.length) { why[e.z] = probs.join('; '); console.log(`  ${e.symbol} r${round}: ${probs.join('; ')} :: ${r.hook.en} / ${r.hook.zh}`); next.push(e); continue }
          // strict support check: a fresh model sees only the stored line and the hook
          const line = r.hook.from === 'etymology' ? e.etymology! : e.fact!
          const chk = await claude(`Strict fact check. STORED LINE (the only source): "${line.en}" (Chinese version: "${line.zh}").
HOOK EN: "${r.hook.en}"
HOOK ZH: "${r.hook.zh}"
Is every claim in each hook fully supported by the stored line alone, with no added fact, number, language, person, place, meaning or certainty (a hedge in the line must survive)? The hook is always shown right next to the element's name and symbol, so it may leave the element unnamed ("Melts in your hand." is about this element); do not flag that. Do flag a hook that is misleading or false when read beside the element's name.
Reply ONLY with JSON: {"en": "supported"|"not supported", "zh": "supported"|"not supported", "why": "short reason if not"}`, 'sonnet').catch(() => '')
          let v: { en?: string; zh?: string; why?: string } = {}
          try { v = JSON.parse(chk.slice(chk.indexOf('{'), chk.lastIndexOf('}') + 1)) } catch { /* unparsable → reject */ }
          if (v.en === 'supported' && v.zh === 'supported') drafts[e.z] = { ...drafts[e.z], hook: r.hook, hook_review: { verdict: 'supported', round } }
          else { why[e.z] = `checker: ${v.why ?? 'no verdict'}`; console.log(`  ${e.symbol} r${round} checker: ${v.why} :: ${r.hook.en} / ${r.hook.zh}`); next.push(e) }
        }
        pending = next
        writeAtomic(DRAFTS, JSON.stringify(drafts, null, 1) + '\n')
      }
      for (const e of pending) drafts[e.z] = { ...drafts[e.z], hook: null, hook_review: { verdict: 'dropped', why: why[e.z] } }
      writeAtomic(DRAFTS, JSON.stringify(drafts, null, 1) + '\n')
    }
  }))
  const hs = Object.values(drafts).filter(d => d.hook)
  console.log('hooks:', hs.length, 'null:', Object.values(drafts).filter(d => d.hook_review && !d.hook).length)
}
if (A.val('--field') === 'hook') { await hookMode(); process.exit(0) }

// ---- main ----
const todo = els.filter(e => (A.only ? A.only.includes(e.symbol) : true) && (A.force || A.has('--check') || !drafts[e.z]))
if (!A.has('--check')) {
  const batches: (typeof els)[] = []
  for (let i = 0; i < todo.length; i += 5) batches.push(todo.slice(i, i + 5))
  let bi = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (bi < batches.length) {
      const b = batches[bi++]
      let pending = b
      for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
        try {
          const extra = attempt ? `\n\nIMPORTANT: a previous answer was rejected because quotes were not verbatim or length rules were broken. Copy quotes character-for-character from SOURCE.` : ''
          const res = await draftBatch(pending, extra + (attempt ? ` (attempt ${attempt + 1})` : ''))
          const next: typeof els = []
          for (const e of pending) {
            const d = res.find(r => Number(r.z) === e.z)
            const errs = d ? validate(e, d) : ['missing']
            if (!errs.length) { drafts[e.z] = { ...d, review: { quotes: 'verbatim' } }; writeAtomic(DRAFTS, JSON.stringify(drafts, null, 1) + '\n') }
            else { console.log(`  ${e.symbol} rejected: ${errs.join(', ')}`); next.push(e) }
          }
          pending = next
        } catch (err) { console.log(`batch error ${pending.map(e => e.symbol)}: ${String(err).slice(0, 200)}`) }
      }
      console.log(`batch ${b.map(e => e.symbol).join(',')} done; ${pending.length ? 'FAILED ' + pending.map(e => e.symbol) : 'ok'}`)
    }
  }))
}
// support check (fresh model sees only claim + quote); unsupported → redraft with the reason, ≤ 2 rounds, then drop
const toCheck = els.filter(e => drafts[e.z] && (A.only ? A.only.includes(e.symbol) : true) && (!A.has('--missing') || !drafts[e.z].support))
let ci = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (ci < toCheck.length) {
    const e = toCheck[ci++]
    for (let round = 0; round < 3; round++) {
      const d = drafts[e.z]
      let r: Awaited<ReturnType<typeof checkPass>>
      try { r = await checkPass(e, d) } catch (err) { console.log('check error', e.symbol, String(err).slice(0, 120)); break }
      d.support = r
      const bad = r.fact !== 'supported' || (!!d.etymology && r.etymology !== 'supported')
      if (!bad) break
      console.log(`  ${e.symbol} round ${round}: fact ${r.fact}, etym ${r.etymology}: ${r.why}`)
      if (round === 2) {
        if (r.fact !== 'supported') { d.fact = null; d.fact_quote = null; d.dropped_fact = r.why }
        if (d.etymology && r.etymology !== 'supported') { d.etymology = null; d.etymology_quote = null; d.dropped_etymology = r.why }
        break
      }
      try {
        const res = await draftBatch([e], `\n\nA previous draft for this element was rejected by a strict fact-checker: "${r.why}". Write claims that say no more than the quote states, using its own numbers and words. (round ${round + 1})`)
        const nd = res.find(x => Number(x.z) === e.z)
        if (nd && !validate(e, nd).length) drafts[e.z] = { ...nd, review: { quotes: 'verbatim' } }
      } catch (err) { console.log('redraft error', e.symbol, String(err).slice(0, 120)) }
    }
    writeAtomic(DRAFTS, JSON.stringify(drafts, null, 1) + '\n')
  }
}))
writeAtomic(DRAFTS, JSON.stringify(drafts, null, 1) + '\n')
console.log('drafts:', Object.keys(drafts).length, 'facts dropped:', Object.values(drafts).filter(d => d.fact === null).length, 'etymologies dropped:', Object.values(drafts).filter(d => d.dropped_etymology).length)
