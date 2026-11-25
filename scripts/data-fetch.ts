// data:fetch — download every source into .agent/cache/sources/ (date-stamped meta.json).
// Free, idempotent: a file already in the cache is not fetched again (use --force to refresh).
// Sources: PubChem periodic table, kaikki.org (Wiktionary) per word, Oxford Learner's
// Dictionaries per word, CMUdict, Wikidata zh-hans labels, Unihan kMandarin, Wikipedia
// (en + zh) plain extracts, Bowserinator Periodic-Table-JSON (shell cross-check).
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname
const C = join(ROOT, '.agent/cache/sources')
const force = process.argv.includes('--force')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
// Wikimedia asks automated clients for a descriptive User-Agent (and throttles browser ones)
const BOT_UA = 'integ-elements-data-builder/1.0 (static educational site; contact via github.com/flyfy1)'
const metaPath = join(C, 'meta.json')
mkdirSync(C, { recursive: true })
const meta: Record<string, { url: string; retrieved: string; status: number }> = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {}
const today = new Date().toISOString().slice(0, 10)

async function get(rel: string, url: string, opts: RequestInit = {}, refetch = false): Promise<string | null> {
  const p = join(C, rel)
  if (!force && !refetch && existsSync(p)) {
    if (!meta[rel]) meta[rel] = { url, retrieved: statSync(p).mtime.toISOString().slice(0, 10), status: 200 }
    return readFileSync(p, 'utf8')
  }
  mkdirSync(join(p, '..'), { recursive: true })
  const wiki = /wiki(pedia|data)\.org/.test(url)
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': wiki ? BOT_UA : UA, ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(30_000) })
      const t = await r.text()
      if (r.status === 404) { meta[rel] = { url: r.url || url, retrieved: today, status: 404 }; writeFileSync(p, ''); return '' }
      if (!r.ok) {
        const ra = Number(r.headers.get('retry-after') || 0)
        await new Promise(s => setTimeout(s, Math.max(ra * 1000, 2000 * (i + 1))))
        continue
      }
      meta[rel] = { url: r.url || url, retrieved: today, status: r.status }
      writeFileSync(p, t)
      if (wiki) await new Promise(s => setTimeout(s, 700))
      return t
    } catch { await new Promise(s => setTimeout(s, 2000 * (i + 1))) }
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 1))
  console.log('FAIL', rel)
  return null
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]) }))
}

// 1. PubChem
const pc = JSON.parse((await get('pubchem.json', 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON'))!)
const cols: string[] = pc.Table.Columns.Column
const rows = pc.Table.Row.map((r: { Cell: string[] }) => Object.fromEntries(cols.map((c, i) => [c, r.Cell[i]])))
console.log('pubchem rows', rows.length)

// Words to look up: PubChem names (US spelling) + the UK/IUPAC variants.
const words = new Set<string>(rows.map((r: { Name: string }) => r.Name.toLowerCase()))
for (const w of ['aluminium', 'caesium', 'sulphur']) words.add(w)

// 2. kaikki (Wiktionary extract), one JSONL per word
await pool([...words], 4, async w => {
  const u = `https://kaikki.org/dictionary/English/meaning/${w[0]}/${w.slice(0, 2)}/${encodeURIComponent(w)}.jsonl`
  const t = await get(`kaikki/${w}.jsonl`, u)
  if (t === null) console.log('kaikki FAIL', w)
})

// 3. Oxford Learner's Dictionaries. Homographs live at word_1, word_2 ...; fetch the bare
// page plus _1.._3 so the builder can pick the chemical-element sense.
await pool([...words], 3, async w => {
  for (const suf of ['', '_1', '_2', '_3']) {
    const t = await get(`oald/${w}${suf}.html`, `https://www.oxfordlearnersdictionaries.com/definition/english/${w}${suf}`)
    if (t === null) console.log('oald FAIL', w + suf)
  }
})

// 3b. Longman Dictionary of Contemporary English (BrE + AmE)
await pool([...words], 3, async w => {
  const t = await get(`ldoce/${w}.html`, `https://www.ldoceonline.com/dictionary/${w}`)
  if (t === null) console.log('ldoce FAIL', w)
})

// 4. CMUdict
await get('cmudict.dict', 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict')

// 5. Wikidata: zh-hans / zh-cn labels by atomic number
const sparql = `SELECT ?z ?item ?hans ?cn ?zh ?en WHERE { ?item wdt:P31 wd:Q11344; wdt:P1086 ?z. FILTER(?z <= 118)
 OPTIONAL { ?item rdfs:label ?hans FILTER(LANG(?hans)="zh-hans") }
 OPTIONAL { ?item rdfs:label ?cn FILTER(LANG(?cn)="zh-cn") }
 OPTIONAL { ?item rdfs:label ?zh FILTER(LANG(?zh)="zh") }
 OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en)="en") } }`
await get('wikidata-zh2.json', 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql), { headers: { Accept: 'application/sparql-results+json' } })

// 6. Unihan (kMandarin follows 现代汉语词典 / Xiandai Hanyu Cidian for its first reading)
if (!meta['Unihan_Readings.txt'] && existsSync(join(C, 'Unihan_Readings.txt'))) meta['Unihan_Readings.txt'] = { url: 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip', retrieved: statSync(join(C, 'Unihan_Readings.txt')).mtime.toISOString().slice(0, 10), status: 200 }
if (force || !existsSync(join(C, 'Unihan_Readings.txt'))) {
  const zip = join(C, 'Unihan.zip')
  execFileSync('curl', ['-sL', '-o', zip, 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip'])
  execFileSync('unzip', ['-o', '-q', zip, 'Unihan_Readings.txt', '-d', C])
  meta['Unihan_Readings.txt'] = { url: 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip', retrieved: today, status: 200 }
}

// 7. Wikipedia raw wikitext (action=raw is CDN-cached; the action API throttles hard).
// Gives {{IPAc-en}} (pronunciation, third IPA source) and the article prose for facts/etymology.
const enTitle = (n: string) => ({ Mercury: 'Mercury (element)' } as Record<string, string>)[n] ?? n
await pool(rows, 2, async (r: { Name: string; AtomicNumber: string }) => {
  let t = await get(`wikipedia/en-raw/${r.AtomicNumber}.wiki`, `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(enTitle(r.Name).replace(/ /g, '_'))}&action=raw`)
  const redir = t?.match(/^#REDIRECT\s*\[\[([^\]]+)\]\]/i)?.[1]
  if (redir) t = await get(`wikipedia/en-raw/${r.AtomicNumber}.wiki`, `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(redir.replace(/ /g, '_'))}&action=raw`, {}, true)
})

// 7a. Template:Infobox <element> holds |pronounce= {{IPAc-en|...}}
await pool(rows, 2, async (r: { Name: string; AtomicNumber: string }) => {
  const w = readFileSync(join(C, `wikipedia/en-raw/${r.AtomicNumber}.wiki`), 'utf8')
  const ib = w.match(/\{\{(Infobox [a-z]+)\}\}/i)?.[1]
  if (ib) await get(`wikipedia/infobox/${r.AtomicNumber}.wiki`, `https://en.wikipedia.org/w/index.php?title=Template:${encodeURIComponent(ib.replace(/ /g, '_'))}&action=raw`)
  else console.log('no infobox template', r.Name)
})

// 7b. zh Wikipedia raw wikitext for 113–118 (2017 naming by 全国科学技术名词审定委员会)
const wd = JSON.parse(readFileSync(join(C, 'wikidata-zh2.json'), 'utf8'))
const zhLabel: Record<string, string> = {}
for (const b of wd.results.bindings) { const v = b.hans?.value ?? b.cn?.value ?? b.zh?.value; if (v && !zhLabel[b.z.value]) zhLabel[b.z.value] = v }

// 7d. kaikki Chinese character entries (Mainland-China / Taiwan pinyin), following soft redirects
await pool(Object.entries(zhLabel), 3, async ([, ch]) => {
  const u = (c: string) => `https://kaikki.org/dictionary/Chinese/meaning/${encodeURIComponent([...c][0])}/${encodeURIComponent([...c].slice(0, 2).join(''))}/${encodeURIComponent(c)}.jsonl`
  const t = await get(`kaikki-zh/${ch}.jsonl`, u(ch))
  const red = t?.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.pos === 'soft-redirect')?.redirects?.[0]
  if (red) await get(`kaikki-zh/${red}.jsonl`, u(red))
})
for (const z of ['113', '114', '115', '116', '117', '118'])
  await get(`wikipedia/zh-raw/${z}.wiki`, `https://zh.wikipedia.org/w/index.php?title=${encodeURIComponent(zhLabel[z])}&action=raw`)

// 7c. IUPAC periodic table page (element names, IUPAC spellings)
await get('iupac.html', 'https://iupac.org/what-we-do/periodic-table-of-elements/')

// 8. Bowserinator Periodic-Table-JSON (CC BY-SA), cross-check only
await get('bowserinator.json', 'https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json')

writeFileSync(metaPath, JSON.stringify(meta, null, 1))
console.log('done; cached files:', Object.keys(meta).length)
