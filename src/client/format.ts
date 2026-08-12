/** Shared number/color formatting for the ticker surfaces. */

import type { TickerColorScheme, TickerQuoteView } from '../contract.ts'

/** Join conditional class names. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ')
}

/** Price digits by magnitude: big numbers keep 2 decimals, tiny ones keep 4. */
export function formatPrice(price: number | null): string {
  if (price === null) return '--'
  if (price >= 1) return price.toFixed(2)
  if (price >= 0.01) return price.toFixed(4)
  return price.toPrecision(4)
}

/** Signed percent, 2 decimals. */
export function formatChangePct(pct: number | null): string {
  if (pct === null) return '--'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}

/** Signed absolute change, 2 decimals. */
export function formatChangeAbs(abs: number | null): string {
  if (abs === null) return '--'
  return `${abs > 0 ? '+' : ''}${abs.toFixed(2)}`
}

/** Trend direction: 1 up, -1 down, 0 flat/unknown. */
export function quoteDirection(quote: TickerQuoteView | undefined): -1 | 0 | 1 {
  const pct = quote?.changePct
  if (pct === null || pct === undefined || pct === 0) return 0
  return pct > 0 ? 1 : -1
}

const RISE = '#e5484d'
const FALL = '#2ea14c'

/**
 * Capsule color for a direction under a palette: A-share convention paints
 * rises red, the international one paints them green.
 */
export function changeColor(scheme: TickerColorScheme, direction: -1 | 0 | 1): string {
  if (direction === 0) return 'currentColor'
  const up = scheme === 'cn' ? RISE : FALL
  const down = scheme === 'cn' ? FALL : RISE
  return direction > 0 ? up : down
}

/** HH:MM for the staleness cell. */
export function formatTime(ts: number): string {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
