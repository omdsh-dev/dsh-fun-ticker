/**
 * The marquee strip: a 36px row between the message flow and the composer,
 * registered into `conversation.input.dock`. Content is duplicated once and
 * scrolled by requestAnimationFrame so hover-pause feels natural; the price
 * flashes 300ms on every update, a single stale source grays only its cell,
 * and a fully broken flow grays the strip and appends the "updated at" cell.
 */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TickerSettings } from '../contract.ts'
import { NS } from './locales.ts'
import type { TickerState } from './store.ts'
import type { TickerInjected } from './index.ts'
import { DetailPopover } from './DetailPopover.tsx'
import { changeColor, cx, formatChangePct, formatPrice, formatTime, quoteDirection } from './format.ts'
import styles from './TickerBar.module.css'

const SPEED_PX: Record<TickerSettings['speed'], number> = { slow: 24, medium: 48, fast: 96 }

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export type TickerBarProps =
  PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS> & TickerInjected

interface DetailAnchor {
  symbol: string
  left: number
  top: number
  bottom: number
}

export function TickerBar(props: TickerBarProps) {
  const { t, useTicker, saveSettings } = props
  const settings = useTicker(s => s.settings)
  const quotes = useTicker(s => s.quotes)
  const broken = useTicker(s => s.broken)
  const lastUpdate = useTicker(s => s.lastUpdate)
  const [hovered, setHovered] = useState(false)
  const [detail, setDetail] = useState<DetailAnchor | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const offsetRef = useRef(0)
  const hoveredRef = useRef(false)
  const reduced = prefersReducedMotion()
  const speedPx = SPEED_PX[settings.speed]

  useEffect(() => {
    hoveredRef.current = hovered
  }, [hovered])

  useEffect(() => {
    if (reduced) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const delta = Math.min((now - last) / 1000, 0.1)
      last = now
      if (hoveredRef.current) {
        raf = requestAnimationFrame(tick)
        return
      }
      const track = trackRef.current
      if (track !== null) {
        const half = track.scrollWidth / 2
        if (half > 0) {
          offsetRef.current -= speedPx * delta
          if (offsetRef.current <= -half) offsetRef.current += half
          track.style.transform = `translate3d(${offsetRef.current.toFixed(2)}px,0,0)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf) }
  }, [speedPx, reduced])

  const openDetail = (symbol: string) => (event: React.MouseEvent<HTMLElement>): void => {
    if (!settings.showDetailButton) return
    const rect = event.currentTarget.getBoundingClientRect()
    setDetail({ symbol, left: rect.left, top: rect.top, bottom: rect.bottom })
  }

  const items = settings.symbols.map(symbol => ({ symbol, quote: quotes[symbol] }))
  const metaCell = broken && lastUpdate !== null
    ? <div className={styles.meta}>{t('ticker.updatedAt', { time: formatTime(lastUpdate) })}</div>
    : null

  return (
    <div
      className={cx(styles.bar, broken && styles.broken)}
      onMouseEnter={() => { setHovered(true) }}
      onMouseLeave={() => { setHovered(false) }}
    >
      <div className={styles.viewport}>
        <div ref={trackRef} className={styles.track}>
          {[0, 1].map(copy => (
            <div key={copy} className={styles.group} aria-hidden={copy === 1}>
              {items.map(({ symbol, quote }) => (
                <TickerItem
                  key={symbol}
                  symbol={symbol}
                  quote={quote}
                  colorScheme={settings.colorScheme}
                  onClick={openDetail(symbol)}
                  notFoundLabel={t('ticker.notFound')}
                  invalidLabel={t('ticker.invalid')}
                  pendingLabel={t('ticker.pending')}
                />
              ))}
              {metaCell}
            </div>
          ))}
        </div>
      </div>
      {detail !== null && (
        <DetailPopover
          symbol={detail.symbol}
          anchor={detail}
          t={t}
          useTicker={useTicker}
          saveSettings={saveSettings}
          onClose={() => { setDetail(null) }}
        />
      )}
    </div>
  )
}

interface TickerItemProps {
  symbol: string
  quote: TickerState['quotes'][string] | undefined
  colorScheme: TickerSettings['colorScheme']
  onClick: (event: React.MouseEvent<HTMLElement>) => void
  notFoundLabel: string
  invalidLabel: string
  pendingLabel: string
}

function TickerItem(props: TickerItemProps) {
  const { symbol, quote, colorScheme, onClick, notFoundLabel, invalidLabel, pendingLabel } = props
  const [flash, setFlash] = useState(false)
  const prevPrice = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    const price = quote?.price ?? null
    if (prevPrice.current !== undefined && prevPrice.current !== null && price !== null && price !== prevPrice.current) {
      setFlash(true)
      const timer = window.setTimeout(() => { setFlash(false) }, 320)
      prevPrice.current = price
      return () => { window.clearTimeout(timer) }
    }
    prevPrice.current = price
    return undefined
  }, [quote?.price])
  const direction = quoteDirection(quote)
  const color = changeColor(colorScheme, direction)
  const isError = quote?.error !== undefined
  const label = quote?.error === 'not-found' ? notFoundLabel : quote?.error === 'invalid-symbol' ? invalidLabel : null
  return (
    <button
      type="button"
      className={cx(styles.item, quote?.stale === true && styles.stale)}
      onClick={onClick}
      title={symbol}
    >
      <span className={styles.code}>{symbol}</span>
      {quote === undefined && <span className={styles.pending}>{pendingLabel}</span>}
      {quote !== undefined && isError && <span className={styles.errorText}>{label}</span>}
      {quote !== undefined && !isError && (
        <>
          <span className={cx(styles.price, flash && styles.flash)} style={flash ? { color } : undefined}>
            {formatPrice(quote.price)}
          </span>
          {direction !== 0 && quote.changePct !== null && (
            <span
              className={styles.capsule}
              style={{ color, borderColor: `${color}66`, background: `${color}14` }}
            >
              <span
                className={cx(styles.triangle, direction < 0 && styles.triangleDown)}
                style={{ borderBottomColor: color }}
              />
              {formatChangePct(quote.changePct)}
            </span>
          )}
        </>
      )}
    </button>
  )
}
