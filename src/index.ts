/**
 * Host entry for the ticker plugin: registers the durable `dsh-ticker`
 * settings namespace and the same-origin quote proxy route. The browser
 * bundle polls `/plugins/dsh-ticker/api/*` — the settings RPC is loopback
 * gated behind the api-proxy exposure list, so the plugin serves its own
 * section through the route and stays self-contained.
 * @module @deepseek-ai/dsh-fun-ticker
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { TICKER_NAMESPACE } from './contract.ts'
import { createTickerRoute } from './proxy.ts'
import { TickerSettingsSchema } from './settings.ts'

export { TickerSettingsSchema } from './settings.ts'
export {
  categorizeSymbol, DEFAULT_SYMBOLS, DEFAULT_TICKER_SETTINGS, eastmoneySecid,
  TICKER_NAMESPACE,
} from './contract.ts'
export type {
  TickerCategory, TickerColorScheme, TickerRefreshSeconds, TickerSettings, TickerSpeed,
  TickerSparkPoint, TickerQuoteView, TickerSuggestion,
} from './contract.ts'

/** Branded settings namespace owned by this plugin. */
export const TICKER_SETTINGS_NAMESPACE = settingsNamespace(TICKER_NAMESPACE)

/**
 * Register the settings section and the proxy route when their Host services
 * are composed. The route shares the settings owner scope, so symbol edits
 * from the browser take effect on the next poll without a restart.
 * @param ctx - Host context that acquires settings and HTTP services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'httpServer'], (host) => {
    const scope = host.settings.register(TICKER_SETTINGS_NAMESPACE, TickerSettingsSchema)
    host.httpServer.register(createTickerRoute(scope))
  })
}
