/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fun-ticker`.
 * @module @deepseek-ai/dsh-fun-ticker/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fun-ticker'

/** Cordis companion plugin name. */
export const name = 'fun-ticker-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the ticker settings namespace validates and persists
 * the durable section, while the host-side quote cache is a bounded in-memory
 * mirror rebuilt from upstream on every refresh interval — agreement is
 * covered directly by this package's host routing and source specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
