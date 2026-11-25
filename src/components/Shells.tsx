// Electron-shell model: nucleus + up to 7 rings, electrons as dots. Ring k turns once per
// (6 + 2k) s, alternate rings reversed (CSS, paused when the tab is hidden or effects reduced).
// Changing element re-keys the SVG: rings draw in 300 ms, innermost first.
import { memo } from 'react'
import { CATS, type El } from '../data'

export const Shells = memo(function Shells({ el, size, symbolSize, live = true }: { el: El; size: number; symbolSize?: number; live?: boolean }) {
  const hex = CATS[el.c].hex
  const n = el.sh.length
  const R = size / 2
  const r0 = R * 0.24
  const outer = R * 0.92, inner = r0 + R * 0.1
  const rings = el.sh.map((count, k) => ({ r: n === 1 ? R * 0.62 : inner + ((outer - inner) * k) / (n - 1), count, k }))
  const dot = Math.max(1.6, Math.min(3.2, size / 70))
  return (
    <svg key={el.z} className={`shells${live ? ' live' : ''}`} width={size} height={size} viewBox={`${-R} ${-R} ${size} ${size}`} aria-hidden="true" style={{ ['--c' as string]: hex }}>
      <defs>
        <radialGradient id={`nuc-${el.z}-${size}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.35" stopColor={hex} stopOpacity="0.95" />
          <stop offset="1" stopColor={hex} stopOpacity="0.25" />
        </radialGradient>
      </defs>
      {rings.map(({ r, count, k }) => (
        <g key={k} className="ring" style={{ ['--i' as string]: k, animationDuration: `${6 + 2 * k}s`, animationDirection: k % 2 ? 'reverse' : 'normal' }}>
          <circle r={r} fill="none" stroke={hex} strokeOpacity={0.28} strokeWidth={1} className="orbit" pathLength={100} />
          {Array.from({ length: count }, (_, i) => {
            const a = (i / count) * Math.PI * 2 + k * 0.4
            return <circle key={i} cx={Math.cos(a) * r} cy={Math.sin(a) * r} r={dot} fill={hex} className="e" />
          })}
        </g>
      ))}
      <circle r={r0} fill={`url(#nuc-${el.z}-${size})`} className="nucleus" />
      {symbolSize ? <text y={symbolSize * 0.36} textAnchor="middle" fontSize={symbolSize} className="nsym">{el.s}</text> : null}
    </svg>
  )
})
