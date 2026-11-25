// split-data — runs first in `npm run build` (free, no network).
//   src/generated/core.json     table-core: what the first paint needs (in the JS bundle)
//   public/data/detail.json     facts, etymology, sentences, traps, picture previews (loaded on idle)
//   public/elements.json        the full sourced data for machines, with credits
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, writeAtomic } from './lib/manifest.ts'

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const els: Any[] = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8'))
const img: Any = existsSync(join(ROOT, 'data/image-manifest.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/image-manifest.json'), 'utf8')) : { assets: {} }
const aud: Any = existsSync(join(ROOT, 'data/audio-manifest.json')) ? JSON.parse(readFileSync(join(ROOT, 'data/audio-manifest.json'), 'utf8')) : { assets: {} }
const CATS = ['alkali', 'alkaline-earth', 'transition', 'post-transition', 'metalloid', 'nonmetal', 'halogen', 'noble-gas', 'lanthanide', 'actinide']

const verified = (e: Any, a: 'us' | 'uk') => e.review.ipa[a] === 'two-source' && e.ipa[a] ? e.ipa[a] : null
const core = els.map(e => {
  const has = (a: string, k: string) => !!aud.assets[`${a}/${e.slug}.${k}`] && aud.assets[`${a}/${e.slug}.${k}`].qa?.machine !== 'fail'
  return {
    z: e.z, s: e.symbol, slug: e.slug, n: e.name.iupac, us: e.name.us, uk: e.name.uk,
    ipa: [verified(e, 'us'), verified(e, 'uk')],
    rs: [verified(e, 'us') ? e.respell.us : '', verified(e, 'uk') ? e.respell.uk : ''],
    zh: e.zh.name, py: e.zh.pinyin, c: CATS.indexOf(e.category), col: e.col, row: e.row, sh: e.shells,
    mp: e.mp_k, bp: e.bp_k, t: e.tricky?.level ?? 0,
    a: ['us', 'uk'].map(a => (has(a, 'name') ? 1 : 0) + (has(a, 'slow') ? 2 : 0) + (has(a, 'sentence') ? 4 : 0)),
    img: img.assets[e.slug] ? 1 : 0,
  }
})
mkdirSync(join(ROOT, 'src/generated'), { recursive: true })
writeAtomic(join(ROOT, 'src/generated/core.json'), JSON.stringify(core))

const detail: Record<number, Any> = {}
for (const e of els) {
  const im = img.assets[e.slug]
  detail[e.z] = {
    fact: e.fact, ety: e.etymology, sen: e.sentence, sa: (['us', 'uk'] as const).map(a => aud.assets[`${a}/${e.slug}.sentence`]?.qa?.machine !== 'fail'), traps: e.tricky?.traps ?? [],
    prev: im?.preview ?? null, pal: im?.palette ?? null,
    year: e.year, state: e.standard_state, group: e.group, period: e.period,
  }
}
mkdirSync(join(ROOT, 'public/data'), { recursive: true })
writeAtomic(join(ROOT, 'public/data/detail.json'), JSON.stringify(detail))

const credits = {
  site: 'Say the Elements · https://elements.integ.life',
  licence_note: 'Pronunciations are cross-checked between dictionaries; only forms confirmed by two independent sources are shown as verified. Wiktionary content is CC BY-SA 4.0; Wikipedia text used for facts is CC BY-SA 4.0.',
  sources: {
    'PubChem Periodic Table (NIH, public domain)': 'https://pubchem.ncbi.nlm.nih.gov/periodic-table/',
    "Oxford Learner's Dictionaries": 'https://www.oxfordlearnersdictionaries.com/',
    'Longman Dictionary of Contemporary English': 'https://www.ldoceonline.com/',
    'Wiktionary via kaikki.org (CC BY-SA)': 'https://kaikki.org/',
    'CMU Pronouncing Dictionary': 'https://github.com/cmusphinx/cmudict',
    'Wikidata (CC0)': 'https://www.wikidata.org/',
    'Unicode Unihan database (kXHC1983, kTGHZ2013, kMandarin)': 'https://www.unicode.org/charts/unihan.html',
    '全国科学技术名词审定委员会 (113–118 names, 2017)': 'http://www.cnterm.cn/news/zhxw/202410/t20241010_762166.html',
    'Wikipedia (CC BY-SA)': 'https://en.wikipedia.org/',
  },
}
const pub = els.map(e => ({ ...e, ipa: { us: verified(e, 'us'), uk: verified(e, 'uk') }, ipa_unverified_candidates: { us: verified(e, 'us') ? undefined : e.sources[`ipa_us`]?.candidates, uk: verified(e, 'uk') ? undefined : e.sources[`ipa_uk`]?.candidates } }))
writeAtomic(join(ROOT, 'public/elements.json'), JSON.stringify({ credits, generated: new Date().toISOString().slice(0, 10), elements: pub }))
console.log('core', JSON.stringify(core).length, 'bytes; detail', JSON.stringify(detail).length, 'bytes')
