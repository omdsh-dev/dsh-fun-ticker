/** Item-click detail popover: latest quote, change, rolling sparkline, remove. */

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { TickerInjected } from './index.ts'
import { Sparkline } from './Sparkline.tsx'
import {
  changeColor, formatChangeAbs, formatChangePct, formatPrice, quoteDirection,
} from './format.ts'
import styles from './Popover.module.css'

export interface DetailPopoverProps extends TickerInjected {
  symbol: string
  anchor: { left: number; top: number; bottom: number }
  t: TranslateNS<typeof NS>
  onClose: () => void
}

export function DetailPopover(props: DetailPopoverProps) {
  const { symbol, anchor, t, useTicker, saveSettings, onClose } = props
  const settings = useTicker(s => s.settings)
  const quote = useTicker(s => s.quotes[symbol])
  const points = useTicker(s => s.series[symbol] ?? [])
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel === null) return
    const height = panel.getBoundingClientRect().height
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 328))
    const top = anchor.top >= height + 16 ? anchor.top - height - 8 : anchor.bottom + 8
    setPos({ left, top })
  }, [anchor])
  const direction = quoteDirection(quote)
  const color = changeColor(settings.colorScheme, direction)
  const remove = (): void => {
    void saveSettings({ ...settings, symbols: settings.symbols.filter(s => s !== symbol) })
    onClose()
  }
  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.panel}
        style={pos === null ? { visibility: 'hidden' } : { left: pos.left, top: pos.top }}
      >
        <div className={styles.titleRow}>
          <span className={styles.title}>{quote?.name ?? symbol}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className={styles.priceRow}>
          <span className={styles.bigPrice} style={{ color }}>{formatPrice(quote?.price ?? null)}</span>
          {quote !== undefined && direction !== 0 && quote.changePct !== null && (
            <span className={styles.changeLine} style={{ color }}>
              {formatChangeAbs(quote.changeAbs)} · {formatChangePct(quote.changePct)}
            </span>
          )}
        </div>
        <div className={styles.sparkline}>
          {points.length > 0
            ? <Sparkline points={points} colorScheme={settings.colorScheme} />
            : <span className={styles.muted}>{t('detail.noData')}</span>}
        </div>
        <div className={styles.footerRow}>
          <span className={styles.muted}>{symbol}</span>
          <button type="button" className={styles.danger} onClick={remove}>{t('detail.remove')}</button>
        </div>
      </div>
    </>,
    document.body,
  )
}
