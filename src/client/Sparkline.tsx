/** Inline SVG sparkline drawn from the rolling point cache. */

import { useMemo } from 'react'
import type { TickerColorScheme, TickerSparkPoint } from '../contract.ts'
import { changeColor } from './format.ts'

export interface SparklineProps {
  points: readonly TickerSparkPoint[]
  colorScheme: TickerColorScheme
  width?: number
  height?: number
}

/** Line + area path from a price series; a single point renders as a dot. */
export function Sparkline({ points, colorScheme, width = 260, height = 56 }: SparklineProps) {
  const shape = useMemo(() => {
    if (points.length < 2) return null
    const first = points[0]
    const lastPoint = points[points.length - 1]
    if (first === undefined || lastPoint === undefined) return null
    const values = points.map(p => p.price)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const pad = 4
    const coords = points.map((point, index) => {
      const x = pad + index / (points.length - 1) * (width - pad * 2)
      const y = pad + (1 - (point.price - min) / span) * (height - pad * 2)
      return [x, y] as const
    })
    const direction: -1 | 0 | 1 = lastPoint.price >= first.price ? 1 : -1
    const stroke = changeColor(colorScheme, direction)
    const line = coords
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ')
    const last = coords[coords.length - 1]
    const firstCoord = coords[0]
    if (last === undefined || firstCoord === undefined) return null
    const area = `${line} L${last[0].toFixed(2)},${height} L${firstCoord[0].toFixed(2)},${height} Z`
    return { line, area, stroke, lastX: last[0], lastY: last[1] }
  }, [points, colorScheme, width, height])
  const single = points.length === 1 ? points[0] : null
  const stroke = shape?.stroke ?? 'currentColor'
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id="fun-ticker-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {shape !== null && <path d={shape.area} fill="url(#fun-ticker-spark-fill)" />}
      {shape !== null && (
        <path d={shape.line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {single !== null && <circle cx={width / 2} cy={height / 2} r="2.5" fill={stroke} />}
      {shape !== null && <circle cx={shape.lastX} cy={shape.lastY} r="2.5" fill={stroke} />}
    </svg>
  )
}
