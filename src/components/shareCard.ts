// "Lab report" share card: one 1080x1350 PNG drawn on a canvas, then the Web Share API or a download.
// Only correct respellings are printed: a wrong reading never leaves the site on a picture.
// The footer QR opens the same questions (a challenge link, `r=q`).
import qrcode from 'qrcode-generator'
import { CATS, nameFor, type Accent, type El, type Lang } from '../data'
import { t, type Key } from '../i18n'
import { challengeUrl, markMine, trackReply, type Method } from '../share'

type Card = { lang: Lang; accent: Accent; medal: El; medalId: string; line: string; score: number; total: number; longest: number; missed: El[]; setName: string; zs: number[] }

const W = 1080, H = 1350
const UI = `Inter, ui-sans-serif, system-ui, sans-serif`
const IPA = `IPA, 'Noto Sans', sans-serif`
const ZH = `ZhEl, 'PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Noto Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif`
const MIX = (hex: string, pct: number, base = '#0F1626') => {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const a = p(hex), b = p(base)
  return `rgb(${a.map((v, i) => Math.round(v * pct + b[i] * (1 - pct))).join(',')})`
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, h, r)
}
/** a QR on a white plate with a four-module quiet zone, so a long-press or a camera reads it off the dark card */
function qr(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const q = qrcode(0, 'M')
  q.addData(text, 'Byte')
  q.make()
  const n = q.getModuleCount()
  const cell = Math.floor(size / (n + 8))
  const off = Math.round((size - cell * n) / 2)
  rr(c, x, y, size, size, 14); c.fillStyle = '#FFFFFF'; c.fill()
  c.fillStyle = '#0A1020'
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect(x + off + k * cell, y + off + r * cell, cell, cell)
}
const tripped = (p: Card) => p.missed[0]?.z ?? 0

/** draws runs of [text, font, colour] on one line, centred at cx */
function runs(c: CanvasRenderingContext2D, parts: [string, string, string][], cx: number, y: number, gap = 18) {
  const ws = parts.map(([s, f]) => { c.font = f; return c.measureText(s).width })
  let x = cx - (ws.reduce((a, b) => a + b, 0) + gap * (parts.length - 1)) / 2
  parts.forEach(([s, f, col], i) => { c.font = f; c.fillStyle = col; c.textAlign = 'left'; c.fillText(s, x, y); x += ws[i] + gap })
}

export async function draw(p: Card): Promise<HTMLCanvasElement> {
  const ipa = p.medal.ipa[p.accent === 'us' ? 0 : 1] ?? p.medal.ipa[0] ?? ''
  const rs = p.missed.slice(0, 5).map(e => e.rs[p.accent === 'us' ? 0 : 1]).join(' ')
  await Promise.all([
    document.fonts.load(`700 40px Inter`), document.fonts.load(`400 40px Inter`),
    document.fonts.load(`400 40px IPA`, `/${ipa}/ ${rs}`), document.fonts.load(`500 40px ZhEl`, p.medal.zh + p.missed.map(e => e.zh).join('')),
  ]).catch(() => {})
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d')!
  c.fillStyle = '#070B14'; c.fillRect(0, 0, W, H)
  for (const [x, y, r, col] of [[0, 0, 900, '#101A33'], [W, H, 900, '#0E1A30']] as const) {
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, '#070B1400')
    c.fillStyle = g; c.fillRect(0, 0, W, H)
  }
  c.textBaseline = 'alphabetic'
  // header
  const label = t(p.lang, 'labReport').toUpperCase()
  c.font = `700 28px ${UI}, ${ZH}`; c.fillStyle = '#93A0BD'; c.textAlign = 'center'
  ;(c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '3.6px'
  c.fillText(label, W / 2, 64 + 28)
  ;(c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  const date = new Date().toISOString().slice(0, 10)
  const setLabel = p.setName === 'missed' ? t(p.lang, 'missed') : t(p.lang, p.setName as Key)
  c.font = `400 24px ${UI}, ${ZH}`; c.fillStyle = '#6F7C99'
  c.fillText(`${setLabel} · ${date}`, W / 2, 64 + 28 + 40)

  // medal tile, 320 x 358
  const hex = CATS[p.medal.c].hex
  const tw = 320, th = 358, tx = (W - tw) / 2, ty = 176
  c.save()
  c.shadowColor = hex + '55'; c.shadowBlur = 80
  const g = c.createLinearGradient(tx, ty, tx + tw * 0.5, ty + th)
  g.addColorStop(0, MIX(hex, 0.24)); g.addColorStop(1, MIX(hex, 0.11))
  rr(c, tx, ty, tw, th, 36); c.fillStyle = g; c.fill()
  c.restore()
  rr(c, tx + 1.5, ty + 1.5, tw - 3, th - 3, 35); c.lineWidth = 3; c.strokeStyle = MIX(hex, 0.6); c.stroke()
  c.font = `500 40px ${UI}`; c.fillStyle = MIX(hex, 0.35, '#B9C3DC'); c.textAlign = 'left'
  c.fillText(String(p.medal.z), tx + 28, ty + 62)
  c.font = `650 150px ${UI}`; c.fillStyle = MIX(hex, 0.8, '#FFFFFF'); c.textAlign = 'center'
  c.save(); c.shadowColor = hex + '66'; c.shadowBlur = 40; c.fillText(p.medal.s, W / 2, ty + 222); c.restore()
  c.font = `500 34px ${UI}`; c.fillStyle = '#C2CBE0'
  c.fillText(nameFor(p.medal, p.accent), W / 2, ty + 304)

  // score
  let y = ty + th + 150
  runs(c, [[String(p.score), `700 160px ${UI}`, '#EAF0FF'], [`/${p.total}`, `500 72px ${UI}`, '#93A0BD']], W / 2, y, 6)
  y += 82
  runs(c, [[nameFor(p.medal, p.accent), `700 40px ${UI}`, '#EAF0FF'], [`/${ipa}/`, `400 40px ${IPA}`, '#7CF5D4'], [p.medal.zh, `500 40px ${ZH}`, '#C2CBE0']], W / 2, y)
  y += 66
  c.font = `400 36px ${UI}, ${ZH}`; c.fillStyle = '#CDD6EC'; c.textAlign = 'center'
  c.fillText(p.line, W / 2, y)
  if (p.longest >= 3) {
    y += 58
    c.font = `700 30px ${UI}, ${ZH}`; c.fillStyle = '#FFD43B'
    c.fillText(t(p.lang, 'longestChain', { n: p.longest }), W / 2, y)
  }
  // still to master: correct respellings only
  const miss = p.missed.slice(0, 5)
  if (miss.length) {
    y += 76
    c.font = `600 22px ${UI}, ${ZH}`; c.fillStyle = '#93A0BD'
    c.fillText(t(p.lang, 'stillToMaster').toUpperCase(), W / 2, y)
    y += 24
    const chips = miss.map(e => {
      const r = e.rs[p.accent === 'us' ? 0 : 1]
      c.font = `600 28px ${UI}`; const a = c.measureText(nameFor(e, p.accent)).width
      c.font = `400 26px ${IPA}`; const b = r ? c.measureText(r).width + 14 : 0
      return { e, r, a, b, w: 56 + a + b + 28 }
    })
    // wrap into rows of at most W - 128
    const rows: (typeof chips)[] = [[]]
    for (const ch of chips) { const row = rows[rows.length - 1]; const rw = row.reduce((s, x) => s + x.w + 14, 0); if (rw + ch.w > W - 128 && row.length) rows.push([ch]); else row.push(ch) }
    for (const row of rows.slice(0, 2)) {
      let x = (W - (row.reduce((s, x) => s + x.w, 0) + 14 * (row.length - 1))) / 2
      for (const ch of row) {
        const col = CATS[ch.e.c].hex
        rr(c, x, y, ch.w, 52, 26); c.fillStyle = MIX(col, 0.14, '#0F1626'); c.fill(); c.lineWidth = 1.5; c.strokeStyle = MIX(col, 0.4, '#070B14'); c.stroke()
        c.font = `650 24px ${UI}`; c.fillStyle = MIX(col, 0.8, '#FFFFFF'); c.textAlign = 'center'; c.fillText(ch.e.s, x + 34, y + 35)
        c.textAlign = 'left'; c.font = `600 28px ${UI}`; c.fillStyle = '#EAF0FF'; c.fillText(nameFor(ch.e, p.accent), x + 60, y + 36)
        if (ch.r) { c.font = `400 26px ${IPA}`; c.fillStyle = '#9FB0D6'; c.fillText(ch.r, x + 60 + ch.a + 14, y + 36) }
        x += ch.w + 14
      }
      y += 64
    }
  }
  // footer: the QR, and beside it what it does and where
  const qs = 184, fy = H - qs - 44
  const call = t(p.lang, 'scanSame')
  c.font = `700 32px ${UI}, ${ZH}`
  const tw2 = Math.max(c.measureText(call).width, 400)
  const fx = (W - (qs + 32 + tw2)) / 2
  qr(c, challengeUrl(p.lang, p.zs, p.score, tripped(p), 'q'), fx, fy, qs)
  c.textAlign = 'left'
  const lx = fx + qs + 32
  c.fillStyle = '#EAF0FF'; c.fillText(call, lx, fy + 62)
  c.font = `600 26px ${UI}, ${ZH}`; c.fillStyle = '#93A0BD'; c.fillText('Say the Elements · 元素怎么读', lx, fy + 112)
  c.font = `400 26px ${UI}`; c.fillStyle = '#7CF5D4'; c.fillText('elements.integ.life/quiz', lx, fy + 152)
  return cv
}

/** the card as a JPEG data URL for the in-app-browser path (an <img> to long-press; WeChat saves a data URL, not a blob URL) */
export async function cardImage(p: Card): Promise<string> {
  markMine(p.zs, p.score)
  return (await draw(p)).toDataURL('image/jpeg', 0.9)
}

/** share the card with its challenge link; returns how it left the site, or null when the user cancelled */
export async function shareCard(p: Card): Promise<'share' | 'download' | null> {
  const cv = await draw(p)
  const blob = await new Promise<Blob | null>(res => cv.toBlob(res, 'image/png'))
  if (!blob) return null
  const file = new File([blob], `say-the-elements-${p.medalId.toLowerCase()}-${p.score}of${p.total}.png`, { type: 'image/png' })
  const hardest = [...p.missed].sort((a, b) => b.t - a.t || b.n.length - a.n.length)[0]
  const link = (how: Method) => challengeUrl(p.lang, p.zs, p.score, tripped(p), how)
  const text = t(p.lang, 'shareText', { medal: p.lang === 'zh' ? p.medal.zh : nameFor(p.medal, p.accent), n: p.score, total: p.total, name: hardest ? nameFor(hardest, p.accent) : 'Praseodymium' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  markMine(p.zs, p.score)
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text: `${text} ${link('f')}` }); trackReply('share'); return 'share' } catch (e) { if ((e as Error).name === 'AbortError') return null }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = file.name
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  try { await navigator.clipboard?.writeText(`${text} ${link('c')}`) } catch { /* clipboard blocked */ }
  trackReply('download')
  return 'download'
}
