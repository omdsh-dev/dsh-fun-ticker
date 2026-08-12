/** Durable schema for the ticker settings namespace. */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_SYMBOLS, DEFAULT_TICKER_SETTINGS, type TickerSettings,
} from './contract.ts'

export { DEFAULT_SYMBOLS, DEFAULT_TICKER_SETTINGS } from './contract.ts'
export type { TickerSettings } from './contract.ts'

/** Durable ticker schema; also the wire envelope the proxy route validates against. */
export const TickerSettingsSchema: z<TickerSettings> = z.object({
  symbols: z.array(z.string()).default([...DEFAULT_SYMBOLS]),
  colorScheme: z.union([z.const('cn'), z.const('intl')]).default(DEFAULT_TICKER_SETTINGS.colorScheme),
  speed: z.union([z.const('slow'), z.const('medium'), z.const('fast')]).default(DEFAULT_TICKER_SETTINGS.speed),
  refreshInterval: z.union([z.const(10), z.const(30), z.const(60)]).default(DEFAULT_TICKER_SETTINGS.refreshInterval),
  sparklinePoints: z.natural().min(10).max(120).default(DEFAULT_TICKER_SETTINGS.sparklinePoints),
  showDetailButton: z.boolean().default(DEFAULT_TICKER_SETTINGS.showDetailButton),
})
