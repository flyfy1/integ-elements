// IPA helpers: source parsers, the comparison key (normaliser) and the learner-style display form.
// Display convention = Oxford/Cambridge learner dictionaries: /r/ not /ɹ/, /ər/, /e/ not /ɛ/,
// length marks on tense vowels, primary ˈ and secondary ˌ.

export const VOWELS = ['aɪ', 'aʊ', 'eɪ', 'oʊ', 'əʊ', 'ɔɪ', 'ɪə', 'eə', 'ʊə', 'iː', 'uː', 'ɑː', 'ɔː', 'ɜː', 'i', 'ɪ', 'e', 'æ', 'ʌ', 'ɒ', 'ʊ', 'u', 'ə', 'ɑ', 'ɔ', 'ɜ', 'o', 'a']
const CONS = ['tʃ', 'dʒ', 'p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'ŋ', 'l', 'r', 'j', 'w', 'x', 'ʔ']
const TOKENS = [...VOWELS, ...CONS, 'ˈ', 'ˌ'].sort((a, b) => b.length - a.length)

/** Learner-style surface form (no slashes, dots, ties). Accent decides r-colour and length marks. */
export function toLearner(raw: string, accent: 'us' | 'uk', from: 'oald' | 'ldoce' | 'wiktionary' | 'cmu' | 'wikipedia'): string {
  let s = raw.trim().replace(/^[/[]|[/\]]$/g, '').replace(/[.͡‿]/g, '')
  s = s.replace(/\(r\)$/, '')           // OALD's linking r at the end of a BrE form
  s = s.replace(/ɹ/g, 'r').replace(/ɡ/g, 'g').replace(/ɛ/g, 'e').replace(/ɫ/g, 'l').replace(/ɝ/g, 'ɜːr').replace(/ɚ/g, 'ər').replace(/ɐ/g, 'ʌ')
  s = s.replace(/[̩̍]/g, '')  // syllabic marks
  s = s.replace(/ɜr/g, 'ɜːr').replace(/ɜːː/g, 'ɜː')
  { const t = tokenize(s); if (t) { for (let i = 0; i < t.length - 1; i++) if (t[i] === 'ə' && t[i + 1] === 'r' && isStressedAt(t, i)) t[i] = 'ɜː'; s = t.join('') } }
  if (accent === 'us') s = s.replace(/əʊ/g, 'oʊ').replace(/ɒ/g, 'ɑː').replace(/ɑːː/g, 'ɑː') // GA has neither (OALD NAmE lines sometimes copy BrE)
  if (from !== 'oald' && from !== 'ldoce' as string && accent === 'us') {
    // General-American sources write tense vowels without length; OALD's NAmE writes them long.
    s = lengthen(s)
  }
  return s
}

function lengthen(s: string): string {
  const t = tokenize(s)
  if (!t) return s
  const out: string[] = []
  for (let i = 0; i < t.length; i++) {
    let x = t[i]
    const next = t.slice(i + 1).find(y => y !== 'ˈ' && y !== 'ˌ')
    const stressed = isStressedAt(t, i)
    if (x === 'i' && (stressed && next !== undefined && !VOWELS.includes(next))) x = 'iː'
    else if (x === 'u' && (stressed || (next && !VOWELS.includes(next)))) x = 'uː'
    else if (x === 'ɑ') x = 'ɑː'
    else if (x === 'ɔ' && next !== 'ɪ') x = 'ɔː'
    out.push(x)
  }
  return out.join('')
}

export function tokenize(s: string): string[] | null {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const t = TOKENS.find(k => s.startsWith(k, i))
    if (!t) return null
    out.push(t); i += t.length
  }
  return out
}

function isStressedAt(t: string[], i: number): boolean {
  // the first vowel after a stress mark (with no vowel in between) is stressed
  for (let j = i - 1; j >= 0; j--) {
    if (t[j] === 'ˈ' || t[j] === 'ˌ') return true
    if (VOWELS.includes(t[j])) return false
  }
  return false
}

/** Comparison key: notation differences removed, accent differences kept. */
export function compareKey(raw: string, accent: 'us' | 'uk'): string | null {
  let s = raw.trim().replace(/^[/[]|[/\]]$/g, '').replace(/[.͡‿ˌ]/g, '').replace(/[̩̍]/g, '')
  if (accent === 'us') s = s.replace(/əʊ/g, 'oʊ').replace(/ɒ/g, 'ɑ')
  s = s.replace(/\(r\)/g, '').replace(/ɹ/g, 'r').replace(/ɡ/g, 'g').replace(/ɛ/g, 'e').replace(/ɫ/g, 'l').replace(/ɝ/g, 'ɜr').replace(/ɚ/g, 'ər').replace(/ɐ/g, 'ʌ').replace(/ː/g, '').replace(/ᵻ|ɨ|ɵ/g, 'ɪ')
  const t0 = tokenize(s.replace(/ː/g, ''))
  if (!t0) return null
  // lone a (modern RP TRAP notation) = æ; monosyllables carry the stress implicitly
  const t = t0.map(x => (x === 'a' ? 'æ' : x))
  if (!t.includes('ˈ') && t.filter(x => VOWELS.includes(x)).length === 1) t.unshift('ˈ')
  if (accent === 'us') for (let i = 0; i < t.length - 1; i++) {
    const next = t.slice(i + 1).find(y => y !== 'ˈ')
    if (next === 'r' && (t[i] === 'ɪə' || t[i] === 'eə' || t[i] === 'ʊə')) t[i] = t[i][0]
  }
  // stressed ɚ is the NURSE vowel (ɜr), not a schwa
  for (let i = 0; i < t.length - 1; i++) if (t[i] === 'ə' && t[i + 1] === 'r' && isStressedAt(t, i)) t[i] = 'ɜ'
  // UK key: drop non-prevocalic r so rhotic and non-rhotic spellings of the same RP form meet
  const toks: string[] = []
  for (let i = 0; i < t.length; i++) {
    const x = t[i]
    if (x === 'r' && accent === 'uk') {
      const next = t.slice(i + 1).find(y => y !== 'ˈ')
      const prev = toks[toks.length - 1]
      if (prev && VOWELS.includes(prev) && !(next && VOWELS.includes(next))) continue
    }
    toks.push(x)
  }
  // weak vowels in unstressed syllables are a notation choice between dictionaries (ɪ/ə/ʊ/u)
  const out: string[] = []
  for (let i = 0; i < toks.length; i++) {
    let x = toks[i]
    const stressed = isStressedAt(toks, i)
    const next = toks.slice(i + 1).find(y => y !== 'ˈ')
    if (!stressed && ['ɪ', 'ə', 'ʊ', 'u', 'ɜ', 'e'].includes(x)) x = 'ə'
    if (!stressed && ['i', 'ɪ'].includes(toks[i]) && (next === undefined || VOWELS.includes(next))) x = 'i'
    if (!stressed && x === 'ɪə') x = 'iə'
    out.push(x)
  }
  // syllabic l/n/m: unstressed ə between a consonant and a final l/n/m is a notation choice
  for (let i = out.length - 2; i > 0; i--) {
    if (out[i] === 'ə' && i === out.length - 2 && ['l', 'n', 'm'].includes(out[i + 1]) && !VOWELS.includes(out[i - 1]) && out[i - 1] !== 'ˈ') out.splice(i, 1)
  }
  // stress mark sits directly before the stressed nucleus, so onset-placement differences vanish
  const fin: string[] = []
  let pending = false
  for (const x of out) {
    if (x === 'ˈ') { pending = true; continue }
    if (pending && VOWELS.includes(x)) { fin.push('ˈ'); pending = false }
    fin.push(x)
  }
  return fin.join('')
}

/** Primary-stressed nucleus index (0-based among nuclei), or -1. */
export function stressedNucleus(ipa: string): number {
  const t = tokenize(ipa.replace(/ː/g, 'ː'))
  if (!t) return -1
  let n = -1, mark = false
  for (const x of t) {
    if (x === 'ˈ') mark = true
    else if (VOWELS.includes(x)) { n++; if (mark) return n }
  }
  return -1
}

/** "/ˈhaɪdrədʒ(ə)n/" → both readings; at most 3 optional groups. */
export function expandOptional(raw: string): string[] {
  const m = raw.match(/\(([^()]+)\)/)
  if (!m || /\(r\)$/.test(raw.replace(/\/$/, ''))) return [raw]
  const a = raw.replace(m[0], m[1]), b = raw.replace(m[0], '')
  return [...expandOptional(a), ...expandOptional(b)].slice(0, 8)
}

// ---- syllables (derived, maximal onset) and respelling -------------------------------------
const ONSETS = new Set(['', 'p', 'b', 't', 'd', 'k', 'g', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ', 'h', 'm', 'n', 'l', 'r', 'j', 'w', 'tʃ', 'dʒ',
  'pl', 'pr', 'bl', 'br', 'tr', 'dr', 'kl', 'kr', 'gl', 'gr', 'fl', 'fr', 'θr', 'ʃr', 'sp', 'st', 'sk', 'sm', 'sn', 'sl', 'sw', 'tw', 'dw', 'kw', 'gw',
  'pj', 'bj', 'tj', 'dj', 'kj', 'gj', 'mj', 'nj', 'fj', 'vj', 'hj', 'lj', 'sj', 'θw', 'spl', 'spr', 'str', 'skr', 'skw', 'spj', 'stj', 'skj'])

export function syllabify(ipa: string): string[] | null {
  const t = tokenize(ipa)
  if (!t) return null
  const nuc = t.map((x, i) => (VOWELS.includes(x) ? i : -1)).filter(i => i >= 0)
  // merge vowel-r sequences where r is non-prevocalic (US ɜːr, ər, ɑːr...) into the nucleus' coda: handled by cluster logic
  if (!nuc.length) return [ipa]
  const cuts: number[] = []
  for (let k = 0; k < nuc.length - 1; k++) {
    const a = nuc[k] + 1, b = nuc[k + 1] // cluster = t[a..b-1]
    const cl = t.slice(a, b)
    const sm = cl.findIndex(x => x === 'ˈ' || x === 'ˌ')
    if (sm >= 0) { cuts.push(a + sm); continue }
    let cut = b
    for (let s = a; s <= b; s++) { if (ONSETS.has(t.slice(s, b).join(''))) { cut = s; break } }
    cuts.push(cut)
  }
  const out: string[] = []
  let p = 0
  for (const c of cuts) { out.push(t.slice(p, c).join('')); p = c }
  out.push(t.slice(p).join(''))
  return out
}

const RESPELL: [string, string][] = [
  ['tʃ', 'ch'], ['dʒ', 'j'], ['ʃ', 'sh'], ['ʒ', 'zh'], ['θ', 'th'], ['ð', 'dh'], ['ŋ', 'ng'], ['j', 'y'],
  ['aɪ', 'eye'], ['aʊ', 'ow'], ['eɪ', 'ay'], ['oʊ', 'oh'], ['əʊ', 'oh'], ['ɔɪ', 'oy'], ['ɪə', 'eer'], ['eə', 'air'], ['ʊə', 'oor'],
  ['iː', 'ee'], ['uː', 'oo'], ['ɑː', 'ah'], ['ɔː', 'aw'], ['ɜː', 'ur'], ['i', 'ee'], ['ɪ', 'i'], ['e', 'e'], ['æ', 'a'], ['ʌ', 'u'], ['ɒ', 'o'],
  ['ʊ', 'uu'], ['u', 'oo'], ['ə', 'ə'], ['ɑ', 'ah'], ['ɔ', 'aw'], ['ɜ', 'ur'], ['x', 'kh'], ['ʔ', ''],
]
export function respell(syllables: string[], stress: number): string {
  return syllables.map((syl, i) => {
    const t = tokenize(syl.replace(/[ˈˌ]/g, '')) || []
    let s = ''
    for (let k = 0; k < t.length; k++) {
      const x = t[k]
      if (x === 'aɪ' && k > 0) { s += 'y'; continue }
      if (x === 'r' && /ur$|ər$|ah$|aw$/.test(s + 'r')) { if (/(ur|ər)$/.test(s)) continue }
      const m = RESPELL.find(([k2]) => k2 === x)
      s += m ? m[1] : x
    }
    s = s.replace(/urr/g, 'ur')
    return i === stress ? s.toUpperCase().replace(/Ə/g, 'ə') : s
  }).join('-')
}

// ---- source parsers -------------------------------------------------------------------------
const ARPA: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AH: 'ə', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ', EH: 'e', ER: 'ər', EY: 'eɪ', IH: 'ɪ', IY: 'i', OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'g', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'r', S: 's', SH: 'ʃ',
  T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}
/** CMUdict ARPAbet → IPA with the primary stress mark placed by maximal onset. */
export function arpaToIpa(phones: string[]): string {
  const segs = phones.map(p => {
    const m = p.match(/^([A-Z]+)([012])?$/)!
    let ipa = ARPA[m[1]]
    if (m[1] === 'AH' && m[2] === '1') ipa = 'ʌ'
    if (m[1] === 'ER' && m[2] === '1') ipa = 'ɜr'
    return { ipa, stress: m[2] }
  })
  const plain = segs.map(s => s.ipa).join('')
  const syl = syllabify(plain) || [plain]
  // find which nucleus has stress 1
  let n = -1, target = -1
  for (const s of segs) if (s.stress !== undefined) { n++; if (s.stress === '1') { target = n; break } }
  let vi = -1
  return syl.map(sy => {
    const nucs = (tokenize(sy) || []).filter(x => VOWELS.includes(x)).length
    const hit = vi + 1 === target && nucs > 0
    vi += nucs
    return (hit ? 'ˈ' : '') + sy
  }).join('')
}

/** {{IPAc-en|...}} → [label, diaphonemic IPA] variants. */
export function parseIPAc(tpl: string): { label: string; ipa: string }[] {
  const inner = tpl.replace(/^\{\{IPAc-en\|?/, '').replace(/\}\}$/, '')
  const parts = inner.split('|').map(s => s.trim()).filter(p => !/=/.test(p))
  const variants: { label: string; ipa: string }[] = []
  let label = '', cur = ''
  for (const p of parts) {
    if (p === ',' || p === ';' || p === 'or' || p === ',_' || p === '') { if (cur) variants.push({ label, ipa: cur }); cur = ''; label = ''; continue }
    if (/^(UK|US|also|local|Brit|GB|USA|Am|NAm)$/i.test(p) && !cur) { label = p; continue }
    if (/^[a-z]{2,}$/i.test(p) && !/[ɑɒæəɛɪʊʌɔɜθðʃʒŋ]/.test(p) && p.length > 3) { if (!cur) label = p; continue }
    cur += p.replace(/_/g, '')
  }
  if (cur) variants.push({ label, ipa: cur })
  return variants
}

/** Wikipedia's diaphonemic key → one accent. */
export function diaphonemic(ipa: string, accent: 'us' | 'uk'): string {
  let s = ipa.replace(/ɛ/g, 'e')
  if (accent === 'uk') {
    s = s.replace(/oʊ/g, 'əʊ').replace(/ɛər|eər/g, 'eə').replace(/ɪər/g, 'ɪə').replace(/ʊər/g, 'ʊə')
    // non-prevocalic r disappears
    const t = tokenize(s)
    if (t) {
      const out: string[] = []
      for (let i = 0; i < t.length; i++) {
        const next = t.slice(i + 1).find(y => y !== 'ˈ' && y !== 'ˌ')
        if (t[i] === 'r' && out.length && VOWELS.includes(out[out.length - 1]) && !(next && VOWELS.includes(next))) continue
        out.push(t[i])
      }
      s = out.join('')
    }
  } else {
    s = s.replace(/ɒ/g, 'ɑː').replace(/ɛər|eər/g, 'er').replace(/ɪər/g, 'ɪr').replace(/ʊər/g, 'ʊr').replace(/ɜːr/g, 'ɜːr')
  }
  return s
}
