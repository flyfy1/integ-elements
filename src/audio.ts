// Web Audio playback: one AudioContext, decoded buffers in an LRU of 150, prefetch on intent
// (hover / touchstart / focus), idle prefetch of the 118 normal clips of the chosen accent.
import type { Accent } from './data'
import { ELS } from './data'

export type Kind = 'name' | 'slow' | 'sentence'
const url = (slug: string, a: Accent, k: Kind) => `/audio/${a}/${slug}${k === 'name' ? '' : '.' + k}.mp3`

let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let current: AudioBufferSourceNode | null = null
const buffers = new Map<string, AudioBuffer>()
const pending = new Map<string, Promise<AudioBuffer | null>>()
const LRU = 150

export const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')
export const timings: { ms: number; cached: boolean }[] = []

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC({ latencyHint: 'interactive' })
    analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.connect(ctx.destination)
  }
  return ctx
}

/** Call from pointerdown/keydown: creates and resumes the context inside the user gesture. */
export function unlock() {
  const c = ensureCtx()
  if (c.state === 'suspended') void c.resume()
}

export function load(slug: string, a: Accent, k: Kind): Promise<AudioBuffer | null> {
  const key = url(slug, a, k)
  const b = buffers.get(key)
  if (b) { buffers.delete(key); buffers.set(key, b); return Promise.resolve(b) }
  let p = pending.get(key)
  if (!p) {
    p = fetch(key)
      .then(r => (r.ok && (r.headers.get('content-type') || '').includes('audio') ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(ab => ensureCtx().decodeAudioData(ab))
      .then(buf => {
        buffers.set(key, buf)
        if (buffers.size > LRU) buffers.delete(buffers.keys().next().value!)
        return buf
      })
      .catch(() => null)
      .finally(() => pending.delete(key))
    pending.set(key, p)
  }
  return p
}
export const isCached = (slug: string, a: Accent, k: Kind) => buffers.has(url(slug, a, k))

type PlayOpts = { t0?: number; onEnd?: () => void }
/** Plays a clip; resolves with tap→start ms once the source starts. One sound at a time. */
export async function play(slug: string, a: Accent, k: Kind, o: PlayOpts = {}): Promise<number | null> {
  const c = ensureCtx()
  if (c.state === 'suspended') await c.resume()
  const cached = isCached(slug, a, k)
  const buf = await load(slug, a, k)
  if (!buf) return null
  stop()
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(analyser!)
  src.onended = () => { if (current === src) current = null; o.onEnd?.() }
  src.start()
  current = src
  const ms = o.t0 != null ? performance.now() - o.t0 : null
  if (ms != null) {
    timings.push({ ms, cached })
    if (debug) console.log(`[audio] ${slug} ${a} ${k}: tap→start ${ms.toFixed(1)} ms (${cached ? 'cached' : 'fetched'}), outputLatency ${((c.outputLatency || 0) * 1000).toFixed(1)} ms`)
  }
  return ms
}
export function stop() {
  if (current) { try { current.onended = null; current.stop() } catch { /* already stopped */ } current = null }
}
export const playing = () => !!current

/** 0..1 levels for the 5-bar meter. */
const bins = new Uint8Array(128)
export function levels(out: number[]) {
  if (!analyser || !current) { out.fill(0); return out }
  analyser.getByteFrequencyData(bins)
  const edges = [2, 5, 10, 18, 30, 48]
  for (let i = 0; i < 5; i++) {
    let m = 0
    for (let j = edges[i]; j < edges[i + 1]; j++) m = Math.max(m, bins[j])
    out[i] = m / 255
  }
  return out
}

let idleStarted: Accent | null = null
/** After the first interaction: prefetch every normal clip of the accent, 4 at a time. */
export function prefetchAll(a: Accent) {
  if (idleStarted === a) return
  const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection
  if (conn?.saveData) return
  idleStarted = a
  const list = ELS.filter(e => e.a[a === 'us' ? 0 : 1] & 1).map(e => e.slug)
  let i = 0
  const ric: (cb: () => void) => void = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? (cb => setTimeout(cb, 200))
  const worker = async () => { while (i < list.length && idleStarted === a) await load(list[i++], a, 'name') }
  ric(() => { for (let k = 0; k < 4; k++) void worker() })
}

// ---- recording (listen & repeat): in memory only, dropped on close ----
export type Take = { buf: AudioBuffer; blobUrl: string }
export async function record(maxMs = 4000, onStart?: () => void): Promise<Take | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = ev => chunks.push(ev.data)
  const done = new Promise<void>(res => (rec.onstop = () => res()))
  rec.start()
  onStart?.()
  currentRec = rec
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), maxMs)
  await done
  clearTimeout(timer)
  currentRec = null
  stream.getTracks().forEach(t => t.stop())
  const blob = new Blob(chunks, { type: rec.mimeType })
  try {
    const buf = await ensureCtx().decodeAudioData(await blob.arrayBuffer())
    return { buf, blobUrl: URL.createObjectURL(blob) }
  } catch { return null }
}
let currentRec: MediaRecorder | null = null
export function stopRecording() { if (currentRec && currentRec.state !== 'inactive') currentRec.stop() }
export async function playBuffer(buf: AudioBuffer) {
  const c = ensureCtx()
  if (c.state === 'suspended') await c.resume()
  stop()
  const src = c.createBufferSource()
  src.buffer = buf
  src.connect(analyser!)
  src.start()
  current = src
  return new Promise<void>(res => (src.onended = () => { if (current === src) current = null; res() }))
}
export function playAndWait(slug: string, a: Accent, k: Kind) {
  return new Promise<void>(res => { void play(slug, a, k, { onEnd: res }).then(ms => { if (ms === null && !playing()) res() }) })
}
