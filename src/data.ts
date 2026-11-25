import coreJson from './generated/core.json'

export type Accent = 'us' | 'uk'
export type Lang = 'en' | 'zh'
export type El = {
  z: number; s: string; slug: string; n: string; us: string; uk: string
  ipa: [string | null, string | null]; rs: [string, string]
  zh: string; py: string; c: number; col: number; row: number; sh: number[]
  mp: number | null; bp: number | null; t: number; a: [number, number]; img: number
}
export type Detail = {
  fact: { en: string; zh: string } | null; ety: { en: string; zh: string } | null
  sen: { us: string; uk: string; zh: string } | null
  /** sentence clip passed audio QA, [us, uk] */
  sa?: [boolean, boolean]
  traps: { wrong: string; why_en: string; why_zh: string }[]
  /** one-line punchline compressed from fact or ety */
  hook?: { en: string; zh: string; from: 'etymology' | 'fact' } | null
  prev: string | null; pal: string[] | null; year: string; state: string; group: number | null; period: number
}

export const ELS = coreJson as unknown as El[]
export const BY_Z = new Map(ELS.map(e => [e.z, e]))
export const BY_SLUG = new Map(ELS.map(e => [e.slug, e]))
for (const [alias, slug] of [['aluminum', 'aluminium'], ['cesium', 'caesium'], ['sulphur', 'sulfur']] as const) BY_SLUG.set(alias, BY_SLUG.get(slug)!)

export const CATS = [
  { id: 'alkali', hex: '#FF6B6B', en: 'Alkali metal', zh: '碱金属' },
  { id: 'alkaline-earth', hex: '#FF9F43', en: 'Alkaline earth metal', zh: '碱土金属' },
  { id: 'transition', hex: '#FFD43B', en: 'Transition metal', zh: '过渡金属' },
  { id: 'post-transition', hex: '#A3B8CC', en: 'Post-transition metal', zh: '后过渡金属' },
  { id: 'metalloid', hex: '#2DD4BF', en: 'Metalloid', zh: '类金属' },
  { id: 'nonmetal', hex: '#7EE787', en: 'Nonmetal', zh: '非金属' },
  { id: 'halogen', hex: '#38BDF8', en: 'Halogen', zh: '卤素' },
  { id: 'noble-gas', hex: '#A78BFA', en: 'Noble gas', zh: '稀有气体' },
  { id: 'lanthanide', hex: '#F472B6', en: 'Lanthanide', zh: '镧系元素' },
  { id: 'actinide', hex: '#D946EF', en: 'Actinide', zh: '锕系元素' },
] as const

export type State = 'solid' | 'liquid' | 'gas' | 'unknown'
export const STATES: { id: State; hex: string; en: string; zh: string }[] = [
  { id: 'solid', hex: '#CBD5E1', en: 'Solid', zh: '固态' },
  { id: 'liquid', hex: '#38BDF8', en: 'Liquid', zh: '液态' },
  { id: 'gas', hex: '#FDE68A', en: 'Gas', zh: '气态' },
  { id: 'unknown', hex: '#64748B', en: 'Unknown', zh: '未知' },
]
/** State at temperature (kelvin). Unknown when the needed melting/boiling point is not known. */
export function stateAt(e: El, k: number): State {
  if (e.mp == null) return 'unknown'
  if (k < e.mp) return 'solid'
  if (e.bp == null) return 'unknown'
  return k < e.bp ? 'liquid' : 'gas'
}

export const nameFor = (e: El, a: Accent) => (a === 'us' ? e.us : e.uk)
export const bothNames = (e: El) => (e.us !== e.uk ? `${e.uk} / ${e.us}` : e.n)

let detailP: Promise<Record<number, Detail>> | null = null
export function loadDetail() {
  return (detailP ??= fetch('/data/detail.json').then(r => r.json()))
}

/** Pinyin without tones, for search ("tie", "wu"). */
export function plainPinyin(p: string) {
  return p.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ü/g, 'v').toLowerCase()
}

export function search(q: string): El[] {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const out: [number, El][] = []
  for (const e of ELS) {
    let score = 0
    const names = [e.us.toLowerCase(), e.uk.toLowerCase()]
    if (e.s.toLowerCase() === s) score = 100
    else if (String(e.z) === s) score = 95
    else if (e.zh === q.trim()) score = 90
    else if (names.some(n => n === s)) score = 88
    else if (names.some(n => n.startsWith(s))) score = 70 - Math.min(20, names[0].length - s.length)
    else if (/^[a-z]+$/.test(s) && plainPinyin(e.py).replace(/v/g, 'u') === s.replace(/v/g, 'u')) score = 60
    else if (s.length >= 3 && names.some(n => n.includes(s))) score = 40
    if (score) out.push([score, e])
  }
  return out.sort((a, b) => b[0] - a[0] || a[1].z - b[1].z).slice(0, 8).map(x => x[1])
}
