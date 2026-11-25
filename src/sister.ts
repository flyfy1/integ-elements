// Other Integ Life sites. Shared by the app (Sister.tsx) and scripts/prerender.ts (static <footer>, llms.txt, JSON-LD).
// `id` is the closed enum sent as the GA `sister_click {site}` parameter.
export type SisterId = 'home' | 'games' | 'visual' | 'knock' | 'purr' | 'smash'
export type Sister = { id: SisterId; url: string; en: string; zh: string; about: string }
export const SISTER_TITLE = { en: 'More from Integ Life', zh: 'Integ Life 的其他作品' } as const
export const SISTERS: readonly Sister[] = [
  { id: 'home', url: 'https://integ.life/', en: 'Integ Life', zh: 'Integ Life 主页', about: 'Integ Life home: one identity, many tools' },
  { id: 'games', url: 'https://games.integ.life/', en: 'Games & tiny toys', zh: '小游戏和解压玩具', about: 'Integ Games: small browser games and tiny stress-relief toys' },
  { id: 'visual', url: 'https://visual.integ.life/', en: 'Visual essays', zh: '知识索引 · 图解', about: '知识索引: visual essays that explain ideas with interactive pictures' },
  { id: 'knock', url: 'https://knock.integ.life/', en: 'Knock on Wood', zh: '敲木鱼', about: 'Tap a wooden fish. Merit +1' },
  { id: 'purr', url: 'https://purr.integ.life/', en: 'Lap Cat', zh: '撸猫', about: 'Pet a soft, purring cat on your screen' },
  { id: 'smash', url: 'https://smash.integ.life/', en: 'Glass Smash', zh: '砸玻璃', about: 'Smash a pane of glass with the word you hate written on it' },
]
