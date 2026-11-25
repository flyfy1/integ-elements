// Gateway client for the local generation scripts. Never imported by src/ (the site is static).
// The Pi gateway listens on loopback; run `ssh -N -L 8111:127.0.0.1:8111 pi` first.
// Settings come from ~/.config/integ-elements/gateway.env (untracked, outside the repo).
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

const envFile = `${homedir()}/.config/integ-elements/gateway.env`
const env: Record<string, string> = {}
if (existsSync(envFile))
  for (const l of readFileSync(envFile, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
export const BASE = env.GATEWAY_URL || 'http://127.0.0.1:8111'
const PROJECT = env.GATEWAY_PROJECT || 'elements'

export type GwResult = { status: number; body: Buffer; requestId: string; contentType: string; text: () => string }

export async function gw(path: string, opts: { json?: unknown; form?: FormData; env: 'production' | 'test'; task: string; timeoutMs?: number }): Promise<GwResult> {
  const headers: Record<string, string> = {
    'X-Integ-Project': PROJECT,
    'X-Integ-Environment': opts.env,
    'X-Integ-Task-Type': opts.task,
  }
  let body: BodyInit | undefined
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json) }
  if (opts.form) body = opts.form
  const r = await fetch(BASE + path, { method: 'POST', headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000) })
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, body: buf, requestId: r.headers.get('x-gateway-request-id') || '', contentType: r.headers.get('content-type') || '', text: () => buf.toString('utf8') }
}

/** Real cost of logged requests (gateway log is the ground truth for spend). */
export async function requestCosts(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const r = await fetch(`${BASE}/gateway/requests?project=${PROJECT}&limit=5000`)
  if (!r.ok) return out
  const d = await r.json() as unknown
  const rows = (Array.isArray(d) ? d : ((d as Record<string, unknown>).requests ?? (d as Record<string, unknown>).items ?? [])) as Record<string, unknown>[]
  for (const x of rows) {
    const id = String(x.request_id ?? x.id ?? '')
    const c = Number(x.cost_total ?? x.cost_usd ?? 0)
    if (id) out.set(id, c)
  }
  return out
}

export async function projectSpend(): Promise<number> {
  let s = 0
  for (const c of (await requestCosts()).values()) s += c
  return s
}
