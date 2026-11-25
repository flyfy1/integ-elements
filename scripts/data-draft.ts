// data:draft — LLM-drafted text fields through headless `claude -p` (subscription, no API credit).
// Input per element: the cached Wikipedia article converted to plain text. Every fact and
// etymology line must carry a quote that is a literal substring of that text; drafts whose quotes
// do not match are rejected and redrafted. A second pass (--check) asks a fresh model whether the
// quote supports the claim. Output: data/drafts.json (merged by data:build).
//   node scripts/data-draft.ts [--only Fe,W] [--check] [--force]
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
