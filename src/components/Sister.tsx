import { useEffect, useRef } from 'react'
import { SISTERS, SISTER_TITLE } from '../sister'
import type { Lang } from '../data'
import { track } from '../analytics'

// "More from Integ Life": plain outbound links (no nofollow). `menu` = compact pop-up for the desktop controls row.
export function Sister({ lang, variant }: { lang: Lang; variant: 'menu' | 'row' }) {
  const title = SISTER_TITLE[lang]
  const box = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (variant !== 'menu') return
    const f = (ev: Event) => { const d = box.current; if (d?.open && !(ev.target instanceof Node && d.contains(ev.target))) d.open = false }
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && box.current) box.current.open = false }
    document.addEventListener('pointerdown', f); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('pointerdown', f); document.removeEventListener('keydown', k) }
  }, [variant])
  const links = SISTERS.map(s => (
    <a key={s.id} href={s.url} title={s.about} onClick={() => track('sister_click', { site: s.id })}>{s[lang]}</a>
  ))
  if (variant === 'menu') return (
    <details className="sister-menu" ref={box}>
      <summary>{title}</summary>
      <nav aria-label={title}>{links}</nav>
    </details>
  )
  return <nav className="sister-row" aria-label={title}><span className="sister-t">{title}</span>{links}</nav>
}
