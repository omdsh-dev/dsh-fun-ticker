/**
 * The manage popover behind the header「📈 行情」button: checked list with
 * drag reorder and remove, an add input with host-side categorized
 * suggestions, and the palette/speed controls. Symbol edits persist through
 * the proxy route on every change.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  categorizeSymbol, type TickerColorScheme, type TickerSettings, type TickerSpeed,
  type TickerSuggestion,
} from '../contract.ts'
import { fetchSuggestions } from './api.ts'
import { NS, type TickerKey } from './locales.ts'
import type { TickerInjected } from './index.ts'
import { cx } from './format.ts'
import styles from './Popover.module.css'

export interface ManagePopoverProps extends TickerInjected {
  anchor: { left: number; top: number; height: number }
  t: TranslateNS<typeof NS>
  onClose: () => void
}

const CATEGORY_LABELS: Record<TickerSuggestion['category'], TickerKey> = {
  crypto: 'category.crypto',
  fx: 'category.fx',
  ashare: 'category.ashare',
  index: 'category.index',
  hk: 'category.hk',
  us: 'category.us',
}

const SPEED_KEYS: readonly TickerSpeed[] = ['slow', 'medium', 'fast']
const SPEED_LABELS: Record<TickerSpeed, TickerKey> = {
  slow: 'manage.speed.slow',
  medium: 'manage.speed.medium',
  fast: 'manage.speed.fast',
}

export function ManagePopover(props: ManagePopoverProps) {
  const { anchor, t, useTicker, saveSettings, onClose } = props
  const settings = useTicker(s => s.settings)
  const quotes = useTicker(s => s.quotes)
  const [list, setList] = useState<string[]>(settings.symbols)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<TickerSuggestion[]>([])
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** While a save is crossing the wire the list must not re-sync from stale settings. */
  const savingRef = useRef(false)

  // Follow durable symbol changes unless a drag or a save is mid-flight.
  useEffect(() => {
    if (dragIndex === null && !savingRef.current) setList(settings.symbols)
  }, [settings.symbols, dragIndex])

  // Debounced host-side autocomplete.
  useEffect(() => {
    const value = query.trim()
    if (value === '') {
      setSuggestions([])
      setInvalid(false)
      return
    }
    const timer = window.setTimeout(() => {
      void fetchSuggestions(value)
        .then(result => { if (result.ok) setSuggestions(result.suggestions) })
        .catch(() => { setSuggestions([]) })
    }, 200)
    return () => { window.clearTimeout(timer) }
  }, [query])

  const persist = (next: string[], patch?: Partial<TickerSettings>): void => {
    savingRef.current = true
    void saveSettings({ ...settings, symbols: next, ...patch }).finally(() => {
      savingRef.current = false
    })
  }

  /** Latest list for the drag-end handler (React event closures lag state updates). */
  const listRef = useRef(list)
  useEffect(() => { listRef.current = list }, [list])

  const addSymbol = (raw: string): void => {
    const symbol = raw.trim().toUpperCase()
    if (symbol === '' || list.includes(symbol)) return
    if (categorizeSymbol(symbol) === null) {
      setInvalid(true)
      return
    }
    const next = [...list, symbol]
    setList(next)
    persist(next)
    setQuery('')
    setSuggestions([])
    setInvalid(false)
  }

  const removeSymbol = (symbol: string): void => {
    const next = list.filter(s => s !== symbol)
    setList(next)
    persist(next)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    const first = suggestions[0]
    if (first !== undefined) addSymbol(first.symbol)
    else addSymbol(query)
  }

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= listRef.current.length) return
    const next = [...listRef.current]
    const moved = next.splice(from, 1)[0]
    if (moved === undefined) return
    next.splice(to, 0, moved)
    listRef.current = next
    setList(next)
    setDragIndex(to)
  }

  const grouped = suggestions.reduce((acc, entry) => {
    const bucket = acc.get(entry.category)
    if (bucket === undefined) acc.set(entry.category, [entry])
    else bucket.push(entry)
    return acc
  }, new Map<TickerSuggestion['category'], TickerSuggestion[]>())

  const speedIndex = Math.max(0, SPEED_KEYS.indexOf(settings.speed))
  const speedPatch = (speed: TickerSpeed): void => { void saveSettings({ ...settings, speed }) }
  const schemePatch = (colorScheme: TickerColorScheme): void => { void saveSettings({ ...settings, colorScheme }) }

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={styles.panel}
        style={{ left: Math.max(8, anchor.left - 240), top: anchor.top + anchor.height + 8 }}
      >
        <div className={styles.titleRow}>
          <span className={styles.title}>{t('manage.title')}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className={styles.field}>
          <div className={styles.label}>{t('manage.selected')}</div>
          {list.length === 0 && <div className={styles.muted}>{t('manage.empty')}</div>}
          <ul className={styles.list}>
            {list.map((symbol, index) => (
              <li
                key={symbol}
                className={cx(styles.row, dragIndex === index && styles.dragging)}
                draggable
                onDragStart={event => {
                  setDragIndex(index)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={event => {
                  event.preventDefault()
                  move(dragIndex ?? index, index)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  persist(listRef.current)
                }}
                onDrop={event => { event.preventDefault() }}
              >
                <span className={styles.dragHandle} aria-hidden="true">⋮⋮</span>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked
                    onChange={() => { removeSymbol(symbol) }}
                  />
                  <span className={styles.symbolCode}>{symbol}</span>
                  <span className={styles.symbolName}>{quotes[symbol]?.name}</span>
                </label>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => { removeSymbol(symbol) }}
                  title={t('manage.remove')}
                >✕</button>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.field}>
          <div className={styles.label}>{t('manage.add.placeholder')}</div>
          <input
            ref={inputRef}
            className={styles.addInput}
            value={query}
            placeholder={t('manage.add.placeholder')}
            onChange={event => { setQuery(event.target.value) }}
            onKeyDown={onKeyDown}
          />
          {invalid && <div className={styles.hint}>{t('manage.add.invalid')}</div>}
          {!invalid && query.trim() !== '' && (
            <div className={styles.hint}>{t('manage.add.hint')}</div>
          )}
          {grouped.size > 0 && (
            <div className={styles.suggestList}>
              {[...grouped.entries()].map(([category, entries]) => (
                <div key={category} className={styles.suggestGroup}>
                  <div className={styles.suggestHeader}>{t(CATEGORY_LABELS[category])}</div>
                  {entries.slice(0, 8).map(entry => (
                    <button
                      key={entry.symbol}
                      type="button"
                      className={styles.suggestItem}
                      onClick={() => { addSymbol(entry.symbol) }}
                    >
                      <span className={styles.symbolCode}>{entry.symbol}</span>
                      <span className={styles.symbolName}>{entry.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className={styles.field}>
          <div className={styles.label}>{t('manage.colorScheme')}</div>
          <div className={styles.segment}>
            {(['cn', 'intl'] as const).map(scheme => (
              <button
                key={scheme}
                type="button"
                className={cx(styles.segmentButton, settings.colorScheme === scheme && styles.active)}
                onClick={() => { schemePatch(scheme) }}
              >
                {t(scheme === 'cn' ? 'manage.colorScheme.cn' : 'manage.colorScheme.intl')}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.label}>{t('manage.speed')}</div>
          <input
            type="range"
            className={styles.speedRange}
            min={0}
            max={2}
            step={1}
            value={speedIndex}
            onChange={event => {
              const speed = SPEED_KEYS[Number(event.target.value)]
              if (speed !== undefined) speedPatch(speed)
            }}
          />
          <div className={styles.speedLabels}>
            {SPEED_KEYS.map(speed => <span key={speed} className={styles.muted}>{t(SPEED_LABELS[speed])}</span>)}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
