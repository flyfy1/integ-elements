// fonts — self-hosted subsets from Google Fonts' text= API (free; outputs committed in public/fonts).
//  inter.woff2     Inter variable 400–700, Latin UI characters
//  ipa.woff2       Noto Sans, exactly the characters used in the IPA data (+ / and stress marks)
//  zh-el.woff2     Noto Sans SC 500, exactly the 118 element characters (113–118 sit in rare blocks)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/manifest.ts'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const els = JSON.parse(readFileSync(join(ROOT, 'data/elements.json'), 'utf8')) as { ipa: { us: string | null; uk: string | null }; respell: { us: string; uk: string }; zh: { name: string } }[]
const uniq = (s: string) => [...new Set([...s])].sort().join('')
const ipaChars = uniq(els.map(e => `${e.ipa.us ?? ''}${e.ipa.uk ?? ''}${e.respell.us}${e.respell.uk}`).join('') + '/ˈˌː·-–—')
const latin = uniq(' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~°·–—‘’“”…×−→←↑↓✓✕•')
const zh = uniq(els.map(e => e.zh.name).join(''))

async function grab(family: string, axis: string, text: string, out: string) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:${axis}&text=${encodeURIComponent(text)}&display=swap`, { headers: { 'User-Agent': UA } })).text()
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1])
  if (urls.length !== 1) throw new Error(`${family}: expected one file, got ${urls.length}\n${css}`)
  const buf = Buffer.from(await (await fetch(urls[0], { headers: { 'User-Agent': UA } })).arrayBuffer())
  mkdirSync(join(ROOT, 'public/fonts'), { recursive: true })
  writeFileSync(join(ROOT, 'public/fonts', out), buf)
  const range = css.match(/unicode-range:\s*([^;]+);/)?.[1] ?? ''
  console.log(out, buf.length, 'bytes', range.length > 120 ? range.slice(0, 120) + '…' : range)
}
await grab('Inter', 'wght@400..700', latin, 'inter.woff2')
await grab('Noto+Sans', 'wght@400;600'.split(';')[0], ipaChars, 'ipa.woff2')
await grab('Noto+Sans+SC', 'wght@500', zh, 'zh-el.woff2')
console.log('ipa chars:', ipaChars)
