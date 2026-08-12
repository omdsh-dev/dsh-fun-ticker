/** Session-header action opening the manage popover. */

import { useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { TickerInjected } from './index.ts'
import { ManagePopover } from './ManagePopover.tsx'
import styles from './Popover.module.css'

export type HeaderButtonProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS> & TickerInjected

export function HeaderButton(props: HeaderButtonProps) {
  const { t, useTicker, saveSettings } = props
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number; height: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const toggle = (): void => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect !== undefined) {
      setAnchor({ left: rect.left, top: rect.top, height: rect.height })
      setOpen(true)
    }
  }
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        title={t('header.open')}
        onClick={toggle}
      >
        {t('header.open')}
      </button>
      {open && anchor !== null && (
        <ManagePopover
          anchor={anchor}
          t={t}
          useTicker={useTicker}
          saveSettings={saveSettings}
          onClose={() => { setOpen(false) }}
        />
      )}
    </>
  )
}
