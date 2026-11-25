// icons — favicon PNGs and the 2 KB background noise tile (sharp, free; outputs committed).
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/manifest.ts'
const svg = readFileSync(join(ROOT, 'public/favicon.svg'))
for (const [f, s] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const)
  await sharp(svg, { density: 600 }).resize(s, s).flatten({ background: '#070B14' }).png().toFile(join(ROOT, 'public', f))
// deterministic noise (LCG) → 64×64 grey with low alpha
const N = 64, px = Buffer.alloc(N * N * 2)
let x = 12345
for (let i = 0; i < N * N; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; px[i * 2] = 255; px[i * 2 + 1] = (x >> 16) % 10 }
await sharp(px, { raw: { width: N, height: N, channels: 2 } }).png({ compressionLevel: 9, palette: false }).toFile(join(ROOT, 'public/noise.png'))
console.log('icons + noise done')
