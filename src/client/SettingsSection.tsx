/**
 * Settings page section「行情跑马灯」: the current symbol list plus the four
 * durable preferences. Every change writes through the proxy route, and the
 * poller picks symbol/interval changes up on its next tick.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  type TickerColorScheme, type TickerRefreshSeconds, type TickerSettings,
} from '../contract.ts'
import { NS, type TickerKey } from './locales.ts'
import type { TickerInjected } from './index.ts'
import { cx } from './format.ts'
import styles from './Popover.module.css'

export type SettingsSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & TickerInjected

const INTERVAL_KEYS: readonly TickerRefreshSeconds[] = [10, 30, 60]
const INTERVAL_LABELS: Record<TickerRefreshSeconds, TickerKey> = {
  10: 'settings.refreshInterval.10',
  30: 'settings.refreshInterval.30',
  60: 'settings.refreshInterval.60',
}

export function SettingsSection(props: SettingsSectionProps) {
  const { t, useTicker, saveSettings } = props
  const settings = useTicker(s => s.settings)
  const quotes = useTicker(s => s.quotes)
  const [pointsDraft, setPointsDraft] = useState<string>(String(settings.sparklinePoints))
  useEffect(() => { setPointsDraft(String(settings.sparklinePoints)) }, [settings.sparklinePoints])
  const patch = (partial: Partial<TickerSettings>): void => {
    void saveSettings({ ...settings, ...partial })
  }
  const commitPoints = (): void => {
    const parsed = Number.parseInt(pointsDraft, 10)
    const clamped = Number.isFinite(parsed) ? Math.min(120, Math.max(10, parsed)) : settings.sparklinePoints
    setPointsDraft(String(clamped))
    if (clamped !== settings.sparklinePoints) patch({ sparklinePoints: clamped })
  }
  return (
    <div className={styles.section}>
      <div className={styles.field}>
        <div className={styles.label}>{t('settings.symbols')}</div>
        <div className={styles.chips}>
          {settings.symbols.length === 0 && <span className={styles.muted}>—</span>}
          {settings.symbols.map(symbol => (
            <span key={symbol} className={styles.chip} title={quotes[symbol]?.name}>
              {symbol}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <div className={styles.label}>{t('settings.refreshInterval')}</div>
        <div className={styles.segment}>
          {INTERVAL_KEYS.map(seconds => (
            <button
              key={seconds}
              type="button"
              className={cx(styles.segmentButton, settings.refreshInterval === seconds && styles.active)}
              onClick={() => { patch({ refreshInterval: seconds }) }}
            >
              {t(INTERVAL_LABELS[seconds])}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <div className={styles.label}>{t('settings.sparklinePoints')}</div>
        <input
          type="number"
          className={styles.pointsInput}
          min={10}
          max={120}
          value={pointsDraft}
          onChange={event => { setPointsDraft(event.target.value) }}
          onBlur={commitPoints}
          onKeyDown={event => {
            if (event.key === 'Enter') commitPoints()
          }}
        />
      </div>
      <div className={styles.field}>
        <div className={styles.label}>{t('manage.colorScheme')}</div>
        <div className={styles.segment}>
          {(['cn', 'intl'] as const).map(scheme => (
            <button
              key={scheme}
              type="button"
              className={cx(styles.segmentButton, settings.colorScheme === scheme && styles.active)}
              onClick={() => { patch({ colorScheme: scheme as TickerColorScheme }) }}
            >
              {t(scheme === 'cn' ? 'manage.colorScheme.cn' : 'manage.colorScheme.intl')}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={settings.showDetailButton}
            onChange={event => { patch({ showDetailButton: event.target.checked }) }}
          />
          <span>{t('settings.showDetailButton')}</span>
        </label>
      </div>
    </div>
  )
}
