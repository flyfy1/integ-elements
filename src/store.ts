// Progress in localStorage key `elements.v1` (never sent anywhere).
import type { Accent, Lang } from './data'

export type Progress = {
  accent?: Accent; lang?: Lang; reduce?: boolean
  heard: Record<number, number>; starred: number[]
  quiz: Record<number, { right: number; wrong: number }>; best: Record<string, number>
  bestStreak?: number
}
const KEY = 'elements.v1'
export function load(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { heard: {}, starred: [], quiz: {}, best: {}, ...p }
  } catch { return { heard: {}, starred: [], quiz: {}, best: {} } }
}
export function save(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode */ }
}
