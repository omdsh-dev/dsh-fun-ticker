/**
 * Browser half of the ticker plugin: one app-wide store instance fed by a
 * poller over the same-origin proxy route, registered into the composer dock
 * (marquee strip), the session header (manage button), and the settings
 * panel (durable preferences section).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { TickerSettings } from '../contract.ts'
import { fetchQuotes, fetchSettings, saveSettings as apiSaveSettings } from './api.ts'
import { HeaderButton } from './HeaderButton.tsx'
import { en, NS, zh, type TickerKey } from './locales.ts'
import { SettingsSection } from './SettingsSection.tsx'
import { createTickerStore, type TickerState, type TickerStoreInstance } from './store.ts'
import { TickerBar } from './TickerBar.tsx'

export { TickerBar } from './TickerBar.tsx'
export { HeaderButton } from './HeaderButton.tsx'
export { ManagePopover } from './ManagePopover.tsx'
export { DetailPopover } from './DetailPopover.tsx'
export { SettingsSection } from './SettingsSection.tsx'
export { Sparkline } from './Sparkline.tsx'
export { createTickerStore } from './store.ts'
export type { TickerState, TickerStoreHandle, TickerStoreInstance } from './store.ts'
export type { TickerKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The ticker surface's copy. */
    'fun-ticker': TickerKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The durable settings section changed through this plugin's surface —
     * the poller re-reads symbols and cadence immediately instead of waiting
     * out the current interval.
     * @param section - the accepted durable section.
     * @mode emit
     */
    'fun-ticker/settings-changed'(section: TickerSettings): void
  }
}

/** Business face injected into every ticker slot entry. */
export interface TickerInjected {
  /** Selector hook over the live store instance. */
  useTicker: SnapshotSelectorHook<TickerState>
  /** Persist a full settings section and re-emit the change event on success. */
  saveSettings: (section: TickerSettings) => Promise<boolean>
}

/** Required services: slot registry and locale dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Persist the durable section through the proxy route, mirror the accepted
 * value into the store, and notify the poller.
 */
async function persistSettings(
  ctx: Context,
  ticker: TickerStoreInstance,
  section: TickerSettings,
): Promise<boolean> {
  try {
    const result = await apiSaveSettings(section)
    if (!result.ok) return false
    ticker.actions.syncSettings(result.section)
    ctx.emit('fun-ticker/settings-changed', result.section)
    return true
  } catch {
    return false
  }
}

/**
 * Client plugin body: dictionaries, the store + poller, and the three slot
 * registrations. The shared store instance crosses scopes through inject
 * faces rather than a store seat, because the settings section is root-scope
 * while the bar and header action are session-scope.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fun-ticker: dictionaries')

  const ticker = createTickerStore().create()
  const useTicker = bindSnapshotSelector(ticker)
  const saveSettings = (section: TickerSettings): Promise<boolean> => persistSettings(ctx, ticker, section)

  const refresh = async (): Promise<void> => {
    const { symbols } = ticker.getSnapshot().settings
    try {
      const result = await fetchQuotes(symbols)
      if (!result.ok) throw new Error('quotes rejected')
      ticker.actions.mergeQuotes(result.quotes)
      ticker.actions.mergeSeries(result.series)
      ticker.actions.markFetch(true)
    } catch {
      ticker.actions.markFetch(false)
    }
  }

  const loadSettings = async (): Promise<void> => {
    try {
      const result = await fetchSettings()
      if (!result.ok) throw new Error('settings rejected')
      ticker.actions.syncSettings(result.section)
      ticker.actions.setSettingsStatus('ready')
    } catch {
      if (ticker.getSnapshot().settingsStatus === 'loading') {
        ticker.actions.setSettingsStatus('error')
      }
    }
  }

  ctx.on('fun-ticker/settings-changed', () => { void refresh() })

  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    let disposed = false
    let timer: number | undefined
    const schedule = (): void => {
      if (disposed) return
      const interval = ticker.getSnapshot().settings.refreshInterval * 1000
      timer = window.setTimeout(() => {
        void refresh().finally(schedule)
      }, interval)
    }
    void loadSettings().then(() => refresh()).finally(schedule)
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, 'fun-ticker: poller')

  const injected = (): TickerInjected => ({ useTicker, saveSettings })

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'ticker',
    order: 30,
    locale: NS,
    inject: injected,
  }, TickerBar))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'ticker',
    order: 30,
    locale: NS,
    inject: injected,
  }, HeaderButton))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'ticker',
    order: 90,
    label: () => ctx.locale.bind(NS)('settings.title'),
    locale: NS,
    inject: injected,
  }, SettingsSection))
}
