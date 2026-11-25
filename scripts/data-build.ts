// data:build — merge the cached sources into data/elements.json (core fields; no network, free).
// The LLM-drafted text fields (fact, etymology, sentence, traps, image_subject) are merged from
// data/drafts.json, which scripts/data-draft.ts writes via headless `claude -p`.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { toLearner, compareKey, syllabify, respell, arpaToIpa, parseIPAc, diaphonemic, tokenize, expandOptional } from './lib/ipa.ts'
import { writeAtomic, ROOT } from './lib/manifest.ts'

const C = join(ROOT, '.agent/cache/sources')
const meta: Record<string, { url: string; retrieved: string }> = JSON.parse(readFileSync(join(C, 'meta.json'), 'utf8'))
const src = (rel: string, quote?: string) => ({ url: meta[rel]?.url ?? rel, retrieved: meta[rel]?.retrieved ?? '', ...(quote ? { quote } : {}) })
const read = (rel: string) => { const p = join(C, rel); return existsSync(p) ? readFileSync(p, 'utf8') : '' }

// ---------- PubChem ----------
const pc = JSON.parse(read('pubchem.json'))
const cols: string[] = pc.Table.Columns.Column
const rows: Record<string, string>[] = pc.Table.Row.map((r: { Cell: string[] }) => Object.fromEntries(cols.map((c, i) => [c, r.Cell[i]])))
const byZ = new Map(rows.map(r => [Number(r.AtomicNumber), r]))
const bow = JSON.parse(read('bowserinator.json')).elements as { number: number; shells: number[]; period: number; group: number; xpos: number; ypos: number }[]

const CORE: Record<string, string> = { He: '1s2', Ne: '[He]2s2 2p6', Ar: '[Ne]3s2 3p6', Kr: '[Ar]4s2 3d10 4p6', Xe: '[Kr]5s2 4d10 5p6', Rn: '[Xe]6s2 4f14 5d10 6p6' }
function shellsOf(cfg: string): number[] {
  const expand = (c: string): string => c.replace(/\[([A-Z][a-z]?)\]/, (_, s) => expand(CORE[s] ?? rows.find(r => r.Symbol === s)!.ElectronConfiguration) + ' ')
  const sh: number[] = []
  for (const m of expand(cfg).matchAll(/(\d)([spdfg])(\d+)/g)) { const n = Number(m[1]); sh[n - 1] = (sh[n - 1] ?? 0) + Number(m[3]) }
  return Array.from(sh, x => x ?? 0)
}

// Grid position by the periodic law (period lengths 2, 8, 8, 18, 18, 32, 32); f-block in rows 8–9.
function grid(z: number): { period: number; group: number | null; col: number; row: number } {
  const starts = [1, 3, 11, 19, 37, 55, 87, 119]
  const period = starts.findIndex((s, i) => z >= s && z < starts[i + 1]) + 1
  const k = z - starts[period - 1] // 0-based index within period
  if (period === 1) return { period, group: z === 1 ? 1 : 18, col: z === 1 ? 1 : 18, row: 1 }
  if (period <= 3) { const g = k < 2 ? k + 1 : k + 11; return { period, group: g, col: g, row: period } }
  if (period <= 5) { const g = k + 1; return { period, group: g, col: g, row: period } }
  // periods 6, 7: k 0–1 s-block, 2–16 f-row (La..Lu / Ac..Lr), 17–31 groups 4–18
  if (k < 2) return { period, group: k + 1, col: k + 1, row: period }
  if (k <= 16) return { period, group: null, col: k + 1, row: period + 2 } // lanthanide row 8 / actinide row 9, cols 3–17
  const g = k - 13
  return { period, group: g, col: g, row: period }
}

const CATS: Record<string, string> = {
  'Alkali metal': 'alkali', 'Alkaline earth metal': 'alkaline-earth', 'Transition metal': 'transition', 'Post-transition metal': 'post-transition',
  Metalloid: 'metalloid', Nonmetal: 'nonmetal', Halogen: 'halogen', 'Noble gas': 'noble-gas', Lanthanide: 'lanthanide', Actinide: 'actinide',
}

// ---------- names ----------
// IUPAC spellings differ from PubChem's US spellings for three elements (IUPAC periodic table page)
const IUPAC_FIX: Record<string, string> = { aluminum: 'aluminium', cesium: 'caesium' }
const UK_FIX: Record<string, string> = { aluminum: 'aluminium', cesium: 'caesium', sulfur: 'sulphur' }
const iupacPage = read('iupac.html')

// ---------- kaikki ----------
type Sound = { ipa?: string; tags?: string[] }
type KEntry = { lang?: string; pos?: string; senses?: { glosses?: string[]; tags?: string[] }[]; sounds?: Sound[]; translations?: { lang?: string; code?: string; word?: string; roman?: string; sense?: string }[]; etymology_text?: string }
function kaikki(word: string, depth = 0): { entry: KEntry | null; rel: string; all: KEntry[] } {
  const rel = `kaikki/${word}.jsonl`
  const all = read(rel).split('\n').filter(Boolean).map(l => JSON.parse(l) as KEntry).filter(e => e.lang === 'English')
  const nouns = all.filter(e => e.pos === 'noun' || e.pos === 'name')
  const isEl = (e: KEntry) => (e.senses || []).some(s => (s.glosses || []).some(g => /chemical element|metal(lic)? element|atomic number|element \(symbol/i.test(g)))
  let entry = nouns.find(e => isEl(e) && (e.sounds || []).some(s => s.ipa)) ?? null
  // US spellings (aluminum) are glossed "standard spelling of aluminium": take that noun's sounds
  if (!entry) entry = nouns.find(e => (e.sounds || []).some(s => s.ipa) && (e.senses || []).some(s => (s.glosses || []).some(g => /spelling of (aluminium|caesium|sulfur|sulphur)/i.test(g)))) ?? null
  if (!entry && depth === 0) {
    const alt = nouns.flatMap(e => e.senses || []).flatMap(s => s.glosses || []).map(g => g.match(/^Alternative (?:form|spelling) of ([a-z]+)/i)?.[1]).find(Boolean)
    if (alt) return kaikki(alt.toLowerCase(), 1)
  }
  return { entry, rel, all }
}
const UK_TAGS = ['Received-Pronunciation', 'UK', 'British', 'England', 'Southern-England']
const US_TAGS = ['General-American', 'US']
function kaikkiForms(e: KEntry | null, accent: 'us' | 'uk'): string[] {
  if (!e) return []
  const out: string[] = []
  for (const s of e.sounds || []) {
    if (!s.ipa) continue
    const tags = s.tags || []
    const want = accent === 'uk' ? UK_TAGS : US_TAGS
    if (tags.length === 0 || tags.some(t => want.includes(t))) out.push(s.ipa)
  }
  return out
}

// ---------- OALD ----------
function oald(word: string): { br: string; am: string; rel: string } | null {
  for (const suf of ['', '_1', '_2', '_3']) {
    const rel = `oald/${word}${suf}.html`
    const h = read(rel)
    if (!h) continue
    const hw = h.match(/<h1 class="headword"[^>]*>([^<]*)/)?.[1]?.trim().toLowerCase()
    if (hw !== word) continue
    const def = h.match(/<span class="def"[^>]*>([\s\S]*?)<\/span>/)?.[1]?.replace(/<[^>]+>/g, '') ?? ''
    if (!/chemical element/i.test(def)) continue
    const br = h.match(/phons_br"[\s\S]*?class="phon">([^<]*)/)?.[1]
    const am = h.match(/phons_n_am"[\s\S]*?class="phon">([^<]*)/)?.[1]
    if (br && am) return { br, am, rel }
  }
  return null
}

// ---------- Longman (LDOCE) ----------
function ldoce(word: string): { br: string | null; am: string | null; rel: string } | null {
  const rel = `ldoce/${word}.html`
  const h = read(rel)
  if (!h) return null
  for (const p of h.split('class="ldoceEntry Entry"').slice(1)) {
    const hw = p.match(/class="HWD">([^<]*)/)?.[1]?.trim().toLowerCase()
    if (hw !== word) continue
    const def = (p.match(/class="DEF">([\s\S]*?)<\/span>\s*(?:<|$)/)?.[1] ?? '').replace(/<[^>]+>/g, '')
    if (!/element|metal|gas\b|symbol/i.test(def)) continue
    const pc = p.match(/<span class="PronCodes">([\s\S]*?)<\/span>\s*(?:<\/span>)?\s*(?=<span class="(?!PRON|AMEVARPRON|neutral|span))/)
    if (!pc) continue
    const txt = pc[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/^\s*\/\s*|\s*\/\s*$/g, '')
    const [brAll, amAll] = txt.split('$').map(x => x.trim())
    const br = brAll?.split(',')[0].trim() || null
    const am0 = amAll?.split(',')[0].trim() || null
    return { br, am: am0 && !am0.includes('-') ? am0 : (amAll ? null : br), rel }
  }
  return null
}

// ---------- CMUdict ----------
const cmu = new Map<string, string[][]>()
for (const l of read('cmudict.dict').split('\n')) {
  const m = l.match(/^([a-z'.-]+)(?:\(\d+\))? (.+?)(?: #.*)?$/)
  if (!m) continue
  if (!cmu.has(m[1])) cmu.set(m[1], [])
  cmu.get(m[1])!.push(m[2].split(' '))
}

// ---------- Wikipedia {{IPAc-en}} ----------
function wikiIPA(z: number): { label: string; ipa: string }[] {
  const ib = read(`wikipedia/infobox/${z}.wiki`)
  const w = (ib.match(/\|\s*pronounce\s*=([^\n]*)/)?.[1] ?? '') + (ib.match(/\|\s*pronounce(?:\s*\d|_?ref|2)\s*=([^\n]*)/)?.[1] ?? '')
  if (!w) return []
  const tpls = [...w.matchAll(/\{\{IPAc-en\|[^}]*\}\}/g)].map(m => m[0]).slice(0, 3)
  return tpls.flatMap(parseIPAc)
}

// ---------- Chinese ----------
const wd = JSON.parse(read('wikidata-zh2.json'))
const zhWikidata = new Map<number, string>()
for (const b of wd.results.bindings) { const v = b.hans?.value ?? b.cn?.value ?? b.zh?.value; if (v && !zhWikidata.has(Number(b.z.value))) zhWikidata.set(Number(b.z.value), v) }
/** Mainland pinyin from kaikki's Chinese entry (follows the simplified → traditional soft redirect). */
function kaikkiZhPinyin(ch: string): { py: string | null; rel: string } {
  let rel = `kaikki-zh/${ch}.jsonl`
  let es = read(rel).split('\n').filter(Boolean).map(l => JSON.parse(l))
  const red = es.find(e => e.pos === 'soft-redirect')?.redirects?.[0]
  if (red) { rel = `kaikki-zh/${red}.jsonl`; es = read(rel).split('\n').filter(Boolean).map(l => JSON.parse(l)) }
  const sounds = es.flatMap(e => e.sounds || []) as { zh_pron?: string; tags?: string[] }[]
  const py = sounds.find(s => s.tags?.includes('Mainland-China') && s.tags?.includes('Pinyin'))?.zh_pron
    ?? sounds.find(s => s.tags?.includes('Mandarin') && s.tags?.includes('Pinyin') && !s.tags?.includes('Taiwan'))?.zh_pron ?? null
  return { py: py ? py.replace(/\s*\(.*\)$/, '').trim() : null, rel }
}
// Unihan: kXHC1983 = 现代汉语词典 (1983) reading, kTGHZ2013 = 通用规范汉字字典 (2013), kMandarin = customary reading
const unihan = new Map<string, string>(), xhc = new Map<string, string>(), tghz = new Map<string, string>()
for (const l of read('Unihan_Readings.txt').split('\n')) {
  const m = l.match(/^U\+([0-9A-F]+)\t(kMandarin|kXHC1983|kTGHZ2013)\t(.+)$/)
  if (!m) continue
  const ch = String.fromCodePoint(parseInt(m[1], 16))
  if (m[2] === 'kMandarin') unihan.set(ch, m[3].split(' ')[0])
  else (m[2] === 'kXHC1983' ? xhc : tghz).set(ch, m[3].split(' ').map(x => x.split(':')[1]).join(' '))
}

const ANN = JSON.parse(readFileSync(join(ROOT, 'data/zh-2017-announcement.json'), 'utf8')) as { url: string; figure: string; retrieved: string; rows: Record<string, { en: string; zh: string; symbol: string; pinyin: string }> }
let pinyinOf = (_: string) => ''

// ---------- drafts (LLM text, supported by stored quotes) ----------
const drafts: Record<string, Record<string, unknown>> = existsSync(join(ROOT, 'data/drafts.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/drafts.json'), 'utf8')) : {}

type Cand = { source: 'oald' | 'ldoce' | 'wikipedia' | 'wiktionary' | 'cmu'; raw: string; learner: string; key: string | null; rel: string; label?: string }
const PRIORITY = ['oald', 'ldoce', 'wikipedia', 'wiktionary', 'cmu']

const out: unknown[] = []
const report: string[] = []
for (let z = 1; z <= 118; z++) {
  const r = byZ.get(z)!
  const usWord = r.Name.toLowerCase()
  const iupacWord = IUPAC_FIX[usWord] ?? usWord
  const ukWord = UK_FIX[usWord] ?? usWord
  const g = grid(z)
  const b = bow.find(x => x.number === z)!
  const shells = shellsOf(r.ElectronConfiguration)
  const shellCheck = JSON.stringify(shells) === JSON.stringify(b.shells)
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

  const ipa: Record<string, string | null> = {}
  const ipaReview: Record<string, unknown> = {}
  const sources: Record<string, unknown> = {}
  for (const accent of ['us', 'uk'] as const) {
    const word = accent === 'us' ? usWord : ukWord
    const cands: Cand[] = []
    const o = oald(word) ?? (word !== iupacWord ? oald(iupacWord) : null)
    // OALD's NAmE line for a UK spelling (aluminium) is not the US word; only use OALD US for the US word
    if (o && (accent === 'uk' || o.rel.startsWith(`oald/${usWord}`))) {
      const raw = accent === 'uk' ? o.br : o.am
      cands.push({ source: 'oald', raw, learner: toLearner(raw, accent, 'oald'), key: compareKey(raw, accent), rel: o.rel })
    }
    const l = ldoce(word)
    if (l) { const raw = accent === 'uk' ? l.br : l.am; if (raw) cands.push({ source: 'ldoce', raw, learner: toLearner(raw, accent, 'ldoce'), key: compareKey(raw, accent), rel: l.rel }) }
    const k = kaikki(word)
    for (const raw0 of kaikkiForms(k.entry, accent)) for (const raw of expandOptional(raw0)) cands.push({ source: 'wiktionary', raw, learner: toLearner(raw, accent, 'wiktionary'), key: compareKey(raw, accent), rel: k.rel })
    if (accent === 'us') for (const ph of cmu.get(word) ?? []) {
      const raw = arpaToIpa(ph)
      cands.push({ source: 'cmu', raw: ph.join(' '), learner: toLearner(raw, 'us', 'cmu'), key: compareKey(raw, 'us'), rel: 'cmudict.dict' })
    }
    // Wikipedia describes the article title's spelling; skip it for a word that is not the title
    if (word === iupacWord || accent === 'us') for (const v of wikiIPA(z)) {
      if (v.label && !new RegExp(accent === 'uk' ? 'UK|Brit|GB' : 'US|Am', 'i').test(v.label)) continue
      if ((accent === 'us' && word !== usWord) || (word !== usWord && word !== iupacWord)) continue
      const raw = diaphonemic(v.ipa, accent)
      cands.push({ source: 'wikipedia', raw: v.ipa, learner: toLearner(raw, accent, 'wikipedia'), key: compareKey(raw, accent), rel: `wikipedia/infobox/${z}.wiki`, label: v.label })
    }
    // agreement between two different source types
    let chosen: Cand | null = null, partner: Cand | null = null
    for (const p of PRIORITY) {
      for (const c of cands.filter(c => c.source === p && c.key)) {
        const m = cands.find(d => d.source !== c.source && d.key === c.key)
        if (m) { chosen = c; partner = m; break }
      }
      if (chosen) break
    }
    const first = [...cands].sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source))[0]
    ipa[accent] = chosen ? chosen.learner : null
    ipaReview[accent] = chosen ? 'two-source' : (first ? 'single-source' : 'missing')
    sources[`ipa_${accent}`] = chosen
      ? { ...src(chosen.rel, chosen.raw), confirmed_by: { ...src(partner!.rel, partner!.raw), source: partner!.source }, source: chosen.source,
          others: cands.filter(c => c !== chosen && c !== partner).map(c => `${c.source}: ${c.raw}`) }
      : { url: first ? src(first.rel).url : '', retrieved: first ? src(first.rel).retrieved : '', candidates: cands.map(c => `${c.source}: ${c.raw}`), unverified: true, best_candidate: first?.learner ?? null }
    report.push(`${z}\t${accent}\t${chosen ? chosen.source + '+' + partner!.source : 'UNVERIFIED'}\t${ipa[accent] ?? ''}\t${cands.map(c => `${c.source}:${c.raw}=${c.key}`).join(' | ')}`)
  }

  // syllables / respelling (derived from the verified IPA)
  const syl: Record<string, string[]> = {}, stress: Record<string, number> = {}, resp: Record<string, string> = {}
  for (const a of ['us', 'uk'] as const) {
    const v = ipa[a]
    if (!v) continue
    const s = syllabify(v) ?? [v]
    syl[a] = s
    stress[a] = Math.max(0, s.findIndex(x => x.includes('ˈ')))
    resp[a] = respell(s, stress[a])
  }

  // Chinese name + pinyin
  const zhW = zhWikidata.get(z) ?? ''
  const kz = kaikki(iupacWord).entry ?? kaikki(usWord).entry
  const allK = [...kaikki(iupacWord).all, ...kaikki(usWord).all]
  const tr = allK.flatMap(e => e.translations || []).filter(t => t.code === 'cmn' || t.lang === 'Chinese Mandarin')
  const trEl = zhW ? tr.find(t => (t.word || '').split(/[\s/]+/).includes(zhW)) ?? null : null
  void kz
  const pyWikt = trEl?.roman ?? null
  const pyUnihan = [...zhW].length === 1 ? (unihan.get(zhW) ?? null) : null
  const zhExtract = read(`wikipedia/zh-raw/${z}.wiki`)
  const kzhRel = `kaikki-zh/${zhW}.jsonl`
  const kzhGloss = read(kzhRel).split('\n').filter(Boolean).map(l => JSON.parse(l)).flatMap(e => [...(e.redirects || []), ...(e.senses || []).flatMap((s: { glosses?: string[] }) => s.glosses || [])])
  const kzhTrad = kzhGloss.find(g => [...g].length === 1)
  const kzhEl = [...kzhGloss, ...(kzhTrad ? read(`kaikki-zh/${kzhTrad}.jsonl`).split('\n').filter(Boolean).map(l => JSON.parse(l)).flatMap(e => (e.senses || []).flatMap((s: { glosses?: string[] }) => s.glosses || [])) : [])]
    .find(g => new RegExp(`\\b(${usWord}|${iupacWord})\\b`, 'i').test(g))
  const ann = ANN.rows[String(z)]
  const zhSecond = trEl ? 'wiktionary' : kzhEl ? 'kaikki-zh' : (zhExtract.includes(zhW) ? 'zh-wikipedia' : null)
  const kzh = kaikkiZhPinyin(zhW)
  const same = (a: string | null, b: string | null) => !!a && !!b && a.normalize('NFC') === b.normalize('NFC')
  const pyXhc = xhc.get(zhW) ?? null, pyTghz = tghz.get(zhW) ?? null
  // 通用规范汉字字典 (2013, current national standard) first, then Unihan's customary reading
  const pinyin = pyTghz?.split(' ')[0] ?? pyUnihan ?? kzh.py ?? pyWikt
  const agree = [pyTghz?.split(' ')[0] ?? null, pyUnihan, kzh.py, pyWikt].filter(x => same(x, pinyin)).length + ((pyXhc ?? '').split(' ').some(x => same(x, pinyin)) ? 1 : 0)
  pinyinOf = () => pinyin ?? ''
  if (ann && (ann.zh !== zhW || ann.pinyin !== pinyinOf(zhW))) throw new Error(`2017 announcement disagrees for ${z}: ${ann.zh} ${ann.pinyin} vs ${zhW}`)
  const pinyinReview = agree >= 2 ? 'two-source' : pinyin ? 'single-source' : 'missing'

  const d = drafts[String(z)] ?? {}
  const mp = r.MeltingPoint ? Number(r.MeltingPoint) : null
  const bp = r.BoilingPoint ? Number(r.BoilingPoint) : null
  const el = {
    z, symbol: r.Symbol, slug: iupacWord,
    name: { iupac: cap(iupacWord), us: cap(usWord), uk: cap(ukWord) },
    ipa, syllables: { us: syl.us ?? [], uk: syl.uk ?? [], stress: { us: stress.us ?? 0, uk: stress.uk ?? 0 } },
    respell: { us: resp.us ?? '', uk: resp.uk ?? '' },
    zh: { name: zhW, pinyin },
    category: CATS[r.GroupBlock] ?? 'unknown',
    group: g.group, period: g.period, col: g.col, row: g.row,
    shells, mp_k: mp, bp_k: bp,
    standard_state: r.StandardState,
    year: r.YearDiscovered,
    fact: d.fact ?? null, etymology: d.etymology ?? null, sentence: d.sentence ?? null,
    // a trap implies a known-correct pronunciation: none for elements with no verified accent
    tricky: (ipaReview.us === 'two-source' || ipaReview.uk === 'two-source') ? (d.tricky ?? null) : null, image_subject: d.image_subject ?? null,
    image_style: d.image_style ?? null,
    hook: d.hook ?? null,
    sources: {
      z: src('pubchem.json'), symbol: src('pubchem.json'), name: iupacPage ? src('iupac.html') : src('pubchem.json'),
      category: src('pubchem.json', r.GroupBlock), mp_bp: src('pubchem.json', `MeltingPoint ${r.MeltingPoint || '—'} K, BoilingPoint ${r.BoilingPoint || '—'} K`),
      shells: { ...src('pubchem.json', r.ElectronConfiguration), derived: true, cross_check: { ...src('bowserinator.json'), agrees: shellCheck } },
      grid: { derived: 'periodic law (period lengths), checked against Bowserinator period/group', agrees: b.period === g.period && (g.group === null || b.group === g.group) },
      ...sources,
      syllables: { derived: 'maximal-onset syllabification of the verified IPA; stress from the source stress mark' },
      respell: { derived: 'from syllables by a fixed IPA→letters table (scripts/lib/ipa.ts)' },
      zh_name: { ...src('wikidata-zh2.json', zhW), confirmed_by: zhSecond === 'wiktionary' ? { ...src(kaikki(iupacWord).rel, trEl?.word) } : zhSecond === 'kaikki-zh' ? src(kzhRel, kzhEl) : zhSecond === 'zh-wikipedia' ? src(`wikipedia/zh-raw/${z}.wiki`) : null,
        ...(ann ? { announcement_2017: { url: ANN.url, figure: ANN.figure, retrieved: ANN.retrieved, quote: `${z} ${ann.en} ${ann.zh} ${ann.symbol} ${ann.pinyin}` } } : {}) },
      zh_pinyin: { ...src('Unihan_Readings.txt', `kXHC1983 ${pyXhc ?? '—'} · kTGHZ2013 ${pyTghz ?? '—'} · kMandarin ${pyUnihan ?? '—'}`), confirmed_by: same(pinyin, kzh.py) ? src(kzh.rel, `Mandarin Pinyin ${kzh.py}`) : null, others: { kaikki_zh: kzh.py, wiktionary_translation: pyWikt }, review: pinyinReview },
      ...(d.sources as object ?? {}),
    },
    review: { ipa: { us: ipaReview.us, uk: ipaReview.uk }, zh: zhSecond ? 'two-source' : 'single-source', pinyin: pinyinReview, listened: false },
  }
  out.push(el)
}

writeAtomic(join(ROOT, 'data/elements.json'), JSON.stringify(out, null, 1) + '\n')
writeAtomic(join(ROOT, '.agent/review/ipa-report.tsv'), report.join('\n') + '\n')
const unv = (out as { review: { ipa: { us: string; uk: string } } }[]).reduce((n, e) => n + (e.review.ipa.us !== 'two-source' ? 1 : 0) + (e.review.ipa.uk !== 'two-source' ? 1 : 0), 0)
console.log(`elements: ${out.length}; unverified accent rows: ${unv}`)
void tokenize; void readdirSync
