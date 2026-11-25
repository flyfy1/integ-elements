// Asset manifests (data/audio-manifest.json, data/image-manifest.json). Written atomically
// after every paid call so a crash loses at most the call in flight.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'

export const ROOT = new URL('../..', import.meta.url).pathname

export const sha256 = (x: string | Buffer) => createHash('sha256').update(x).digest('hex')

export function writeAtomic(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

export type Row = {
  key: string; file: string; sha256: string; bytes: number
  duration_ms?: number; rung?: number; seed?: number; attempt?: number
  qa: { machine: string | null; human: string | null; transcript?: string; notes?: string }
  gateway_request_id: string; cost_usd: number; created: string
  [k: string]: unknown
}

export type Manifest = {
  assets: Record<string, Row>            // asset id (e.g. "uk/tungsten.name") -> current row
  calls: { id: string; key: string; asset: string; cost_usd: number; status: number; at: string; kind: string }[]  // every paid call, kept forever
  spend_usd: number
}

export function loadManifest(path: string): Manifest {
  if (!existsSync(path)) return { assets: {}, calls: [], spend_usd: 0 }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function saveManifest(path: string, m: Manifest) {
  m.spend_usd = Math.round(m.calls.reduce((s, c) => s + c.cost_usd, 0) * 10000) / 10000
  const sorted: Manifest = { spend_usd: m.spend_usd, assets: Object.fromEntries(Object.entries(m.assets).sort(([a], [b]) => a.localeCompare(b))), calls: m.calls }
  writeAtomic(path, JSON.stringify(sorted, null, 1) + '\n')
}

export function args() {
  const a = process.argv.slice(2)
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined }
  return {
    go: a.includes('--go'), force: a.includes('--force'),
    only: val('--only')?.split(',').map(s => s.trim()).filter(Boolean),
    maxUsd: val('--max-usd') ? Number(val('--max-usd')) : undefined,
    pilot: a.includes('--pilot'), has: (k: string) => a.includes(k), val,
  }
}
