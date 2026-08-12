/**
 * Live ticker state engine: one app-wide store instance the poller writes and
 * every surface (bar, popovers, settings section) reads through the bound
 * selector hook. Settings are durable in the Host settings document; the
 * store only mirrors them, so nothing here needs a persist key.
 */

import { defineStore, type EngineStoreHandle, type EngineStoreInstance } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_TICKER_SETTINGS, type TickerQuoteView, type TickerSettings, type TickerSparkPoint,
} from '../contract.ts'

/** Store state: durable settings mirror plus the poller-owned quote cache. */
export interface TickerState {
  settingsStatus: 'loading' | 'ready' | 'error'
  settings: TickerSettings
  /** Symbol → latest quote view from the proxy. */
  quotes: Record<string, TickerQuoteView>
  /** Symbol → rolling sparkline points. */
  series: Record<string, TickerSparkPoint[]>
  /** Epoch ms of the last successful poll; null before the first one. */
  lastUpdate: number | null
  /** The last poll failed outright — the strip grays and shows the staleness cell. */
  broken: boolean
}

/** Declared action shape giving the exported factories stable return types. */
export type TickerActions = {
  setSettingsStatus: (draft: TickerState, status: TickerState['settingsStatus']) => void
  syncSettings: (draft: TickerState, settings: TickerSettings) => void
  mergeQuotes: (draft: TickerState, quotes: Record<string, TickerQuoteView>) => void
  mergeSeries: (draft: TickerState, series: Record<string, TickerSparkPoint[]>) => void
  markFetch: (draft: TickerState, ok: boolean) => void
}

export type TickerStoreHandle = EngineStoreHandle<TickerState, TickerActions>
export type TickerStoreInstance = EngineStoreInstance<TickerState, TickerActions>

/**
 * Declare the ticker store. The handle is created in apply world; the single
 * `create()` instance is the shared observable handed to slot entries through
 * their inject faces (no store seat: the settings section is root-scope while
 * the bar is session-scope, and a shared seat cannot span both).
 */
export function createTickerStore(): TickerStoreHandle {
  return defineStore({
    init: (): TickerState => ({
      settingsStatus: 'loading',
      settings: DEFAULT_TICKER_SETTINGS,
      quotes: {},
      series: {},
      lastUpdate: null,
      broken: false,
    }),
    actions: {
      setSettingsStatus: (draft, status) => { draft.settingsStatus = status },
      syncSettings: (draft, settings) => { draft.settings = settings },
      mergeQuotes: (draft, quotes) => { draft.quotes = quotes },
      mergeSeries: (draft, series) => { draft.series = series },
      markFetch: (draft, ok) => {
        if (ok) {
          draft.broken = false
          draft.lastUpdate = Date.now()
        } else {
          draft.broken = true
        }
      },
    },
  })
}
