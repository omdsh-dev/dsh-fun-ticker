/** Same-origin HTTP face of the ticker proxy route. */

import type {
  TickerQuoteView, TickerSettings, TickerSparkPoint, TickerSuggestion,
} from '../contract.ts'

const BASE = '/plugins/dsh-ticker/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, init)
  if (!response.ok) throw new Error(`ticker api ${String(response.status)}`)
  return await response.json() as T
}

export interface QuotesResponse {
  ok: boolean
  quotes: Record<string, TickerQuoteView>
  series: Record<string, TickerSparkPoint[]>
}

export interface SettingsResponse {
  ok: boolean
  section: TickerSettings
}

export interface SuggestResponse {
  ok: boolean
  suggestions: TickerSuggestion[]
}

/** Poll quotes (and their rolling series) for the given symbol list. */
export function fetchQuotes(symbols: readonly string[]): Promise<QuotesResponse> {
  return request(`/quotes?symbols=${encodeURIComponent(symbols.join(','))}`)
}

/** Read the durable settings section. */
export function fetchSettings(): Promise<SettingsResponse> {
  return request('/settings')
}

/** Persist the durable settings section. */
export function saveSettings(section: TickerSettings): Promise<SettingsResponse> {
  return request('/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(section),
  })
}

/** Autocomplete over the host catalogs. */
export function fetchSuggestions(query: string): Promise<SuggestResponse> {
  return request(`/suggest?q=${encodeURIComponent(query)}`)
}
