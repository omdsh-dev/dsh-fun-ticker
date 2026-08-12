/**
 * Pure shared contract for the ticker plugin: settings shape, defaults, and
 * the symbol grammar. No runtime dependencies — the Host registers the
 * schemastery schema over these types, and the browser bundle value-imports
 * this module for client-side symbol validation and defaults without dragging
 * schemastery along.
 * @module @deepseek-ai/dsh-fun-ticker/contract
 */

/** Settings namespace owned by the ticker plugin. */
export const TICKER_NAMESPACE = 'dsh-ticker'

/** Where a symbol's upstream quote comes from. */
export type TickerCategory = 'crypto' | 'fx' | 'ashare' | 'index' | 'hk' | 'us'

/** Rise/fall capsule palette: A-share convention (red up) or international (green up). */
export type TickerColorScheme = 'cn' | 'intl'

/** Marquee scroll speed tiers. */
export type TickerSpeed = 'slow' | 'medium' | 'fast'

/** Polling cadence in seconds. */
export type TickerRefreshSeconds = 10 | 30 | 60

/** Durable ticker section shared by the Host schema and the browser scope. */
export interface TickerSettings {
  /** Symbols in display order; each parses through {@link categorizeSymbol}. */
  symbols: string[]
  /** Rise/fall capsule palette. */
  colorScheme: TickerColorScheme
  /** Marquee scroll speed tier. */
  speed: TickerSpeed
  /** Host-side cache and client polling cadence in seconds. */
  refreshInterval: TickerRefreshSeconds
  /** Rolling sparkline window kept host-side (10–120). */
  sparklinePoints: number
  /** Whether clicking an item opens the detail popover. */
  showDetailButton: boolean
}

/** Preset symbols shown on first run. */
export const DEFAULT_SYMBOLS: readonly string[] = ['BTCUSDT', 'ETHUSDT', 'SH000001', 'USD/CNY']

/** Resolved defaults when the user-settings document has no override. */
export const DEFAULT_TICKER_SETTINGS: TickerSettings = {
  symbols: [...DEFAULT_SYMBOLS],
  colorScheme: 'cn',
  speed: 'medium',
  refreshInterval: 30,
  sparklinePoints: 60,
  showDetailButton: true,
}

/**
 * Classify one symbol string into its upstream category, or null when it
 * matches no supported grammar. Order matters: the six-digit A-share code and
 * the hk/gb prefixes must win over the permissive crypto pattern.
 * @param symbol - raw symbol entered by the user.
 * @returns the category, or null for an invalid symbol.
 */
export function categorizeSymbol(symbol: string): TickerCategory | null {
  const value = symbol.trim().toUpperCase()
  if (/^\d{6}$/.test(value)) return 'ashare'
  if (/^(?:SH|SZ)\d{6}$/.test(value)) return 'index'
  if (/^HK\d{4,5}$/.test(value)) return 'hk'
  if (/^GB_[A-Z][A-Z0-9.]*$/.test(value)) return 'us'
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(value)) return 'fx'
  if (/^[A-Z0-9]{4,12}$/.test(value)) return 'crypto'
  return null
}

/**
 * Map a supported symbol to its eastmoney `secid` (A-share codes and the
 * built-in indices only).
 * @param symbol - A-share code (`600519`) or index symbol (`SH000001`).
 * @returns the secid, or null for other categories.
 */
export function eastmoneySecid(symbol: string): string | null {
  const value = symbol.trim().toUpperCase()
  if (/^\d{6}$/.test(value)) {
    return `${value.startsWith('6') || value.startsWith('9') ? '1' : '0'}.${value}`
  }
  if (value === 'SH000001') return '1.000001'
  if (value === 'SZ399001') return '0.399001'
  if (value === 'SZ399006') return '0.399006'
  return null
}

/** One normalized quote crossing the proxy boundary. */
export interface TickerQuoteView {
  symbol: string
  name: string
  /** Latest price, or null when the source reported none (suspended/missing). */
  price: number | null
  /** Percent change over the previous close, or null when unavailable. */
  changePct: number | null
  /** Absolute change over the previous close, or null when unavailable. */
  changeAbs: number | null
  /** Epoch ms of the host-side fetch. */
  ts: number | null
  /** Fetch succeeded once but the latest refresh failed — keep showing, grayed. */
  stale: boolean
  /** Stable machine error for failed lookups (`not-found` / `upstream`). */
  error?: string
}

/** One rolling sparkline sample. */
export interface TickerSparkPoint {
  price: number
  ts: number
}

/** One suggestion entry from the add-input autocomplete. */
export interface TickerSuggestion {
  symbol: string
  name: string
  category: TickerCategory
}
