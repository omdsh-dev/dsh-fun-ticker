/**
 * Host-side quote proxy: per-symbol cache, per-category batching, a rolling
 * sparkline window, and the HTTP route the browser bundle polls. Symbols are
 * the ONLY client-controlled input, and each one must parse through
 * {@link categorizeSymbol} before it names any upstream request — the four
 * upstream domains below are a closed allowlist, never a client URL.
 * @module @deepseek-ai/dsh-fun-ticker/proxy
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import {
  categorizeSymbol, type TickerCategory, type TickerSettings, type TickerSparkPoint,
  type TickerQuoteView,
} from './contract.ts'
import { TickerSettingsSchema } from './settings.ts'
import {
  fetchCryptoBatch, fetchEastmoneyBatch, fetchFxBatch, fetchSinaBatch,
  fetchSuggestions, type SourceBatch,
} from './sources.ts'

/** Upstream allowlist — these four families are the entire egress surface. */
const MAX_SYMBOLS = 40
const MAX_BODY_BYTES = 64 * 1024

interface CachedQuote {
  view: TickerQuoteView
  /** Epoch ms of the last fetch attempt. */
  ts: number
  /** Latest refresh failed — keep the last good quote, grayed. */
  stale: boolean
}

/** Route prefix shared by the host registration and the browser fetches. */
export const TICKER_API_PATH = '/plugins/dsh-ticker/api'

function errorView(symbol: string, error: string): TickerQuoteView {
  return {
    symbol,
    name: symbol,
    price: null,
    changePct: null,
    changeAbs: null,
    ts: null,
    stale: false,
    error,
  }
}

/**
 * The quote engine: in-memory per-symbol cache refreshed per the settings'
 * refresh interval, one upstream call per category batch, plus a rolling
 * sparkline window seeded from upstream history on first appearance.
 */
export class TickerBackend {
  private readonly quotes = new Map<string, CachedQuote>()
  private readonly series = new Map<string, TickerSparkPoint[]>()
  private readonly inflight = new Map<TickerCategory, Promise<void>>()

  /** @param readSettings - resolved settings read at request time, so edits apply live. */
  constructor(private readonly readSettings: () => TickerSettings) {}

  /** Resolve fresh (cached-or-fetched) quotes and rolling series for the requested symbols. */
  async snapshot(symbols: string[]): Promise<{
    quotes: Record<string, TickerQuoteView>
    series: Record<string, TickerSparkPoint[]>
  }> {
    const settings = this.readSettings()
    const intervalMs = settings.refreshInterval * 1000
    const groups = new Map<TickerCategory, string[]>()
    for (const symbol of symbols) {
      const category = categorizeSymbol(symbol)
      if (category === null) {
        this.quotes.set(symbol, { view: errorView(symbol, 'invalid-symbol'), ts: Date.now(), stale: false })
        continue
      }
      const cached = this.quotes.get(symbol)
      if (cached === undefined || Date.now() - cached.ts >= intervalMs) {
        const list = groups.get(category)
        if (list === undefined) groups.set(category, [symbol])
        else list.push(symbol)
      }
    }
    await Promise.all([...groups.entries()].map(([category, list]) => this.refresh(category, list, settings)))
    const quoteViews: Record<string, TickerQuoteView> = {}
    const seriesViews: Record<string, TickerSparkPoint[]> = {}
    for (const symbol of symbols) {
      const cached = this.quotes.get(symbol)
      if (cached !== undefined) {
        quoteViews[symbol] = cached.stale ? { ...cached.view, stale: true } : cached.view
      }
      const points = this.series.get(symbol)
      if (points !== undefined) seriesViews[symbol] = points
    }
    return { quotes: quoteViews, series: seriesViews }
  }

  /** Refresh one category group, re-checking freshness after any in-flight batch completes. */
  private async refresh(category: TickerCategory, symbols: string[], settings: TickerSettings): Promise<void> {
    for (;;) {
      const pending = this.inflight.get(category)
      if (pending !== undefined) {
        // Another caller's batch is crossing the wire; when it lands, symbols
        // fetched by it are fresh and this loop exits on the freshness check.
        await pending
        continue
      }
      const intervalMs = settings.refreshInterval * 1000
      const now = Date.now()
      const expired = symbols.filter((symbol) => {
        const cached = this.quotes.get(symbol)
        return cached === undefined || now - cached.ts >= intervalMs
      })
      if (expired.length === 0) return
      const task = this.runBatch(category, expired, settings)
      this.inflight.set(category, task)
      try {
        await task
      } finally {
        this.inflight.delete(category)
      }
      return
    }
  }

  /** One upstream call per category; per-symbol misses stay per-symbol, source outages gray the cache. */
  private async runBatch(category: TickerCategory, symbols: string[], settings: TickerSettings): Promise<void> {
    const now = Date.now()
    let result: SourceBatch
    try {
      result = await this.dispatch(category, symbols, settings.sparklinePoints)
    } catch {
      for (const symbol of symbols) {
        const cached = this.quotes.get(symbol)
        this.quotes.set(symbol, cached === undefined
          ? { view: errorView(symbol, 'upstream'), ts: now, stale: false }
          : { ...cached, stale: true })
      }
      return
    }
    for (const symbol of symbols) {
      const quote = result.quotes.get(symbol)
      const view = quote === undefined || quote === null
        ? errorView(symbol, 'not-found')
        : {
            symbol: quote.symbol,
            name: quote.name,
            price: quote.price,
            changePct: quote.changePct,
            changeAbs: quote.changeAbs,
            ts: quote.ts,
            stale: false,
          }
      this.quotes.set(symbol, { view, ts: now, stale: false })
      this.appendSeries(symbol, result.seeds.get(symbol), view.price, now, settings)
    }
  }

  private dispatch(category: TickerCategory, symbols: string[], seedPoints: number): Promise<SourceBatch> {
    switch (category) {
      case 'crypto': return fetchCryptoBatch(symbols, seedPoints)
      case 'fx': return fetchFxBatch(symbols, seedPoints)
      case 'ashare':
      case 'index': return fetchEastmoneyBatch(symbols, seedPoints)
      case 'hk':
      case 'us': return fetchSinaBatch(symbols)
    }
  }

  /** Grow the rolling window by one point per refresh; seed from history on first appearance. */
  private appendSeries(
    symbol: string,
    seed: TickerSparkPoint[] | undefined,
    price: number | null,
    now: number,
    settings: TickerSettings,
  ): void {
    const existing = this.series.get(symbol)
    if (existing === undefined) {
      const points = seed === undefined || seed.length === 0 ? [] : [...seed]
      if (price !== null) points.push({ price, ts: now })
      this.series.set(symbol, points.slice(-settings.sparklinePoints))
      return
    }
    if (price === null) return
    const last = existing.at(-1)
    if (last !== undefined && now - last.ts < settings.refreshInterval * 500) return
    this.series.set(symbol, [...existing, { price, ts: now }].slice(-settings.sparklinePoints))
  }
}

// ── HTTP route ──────────────────────────────────────────────────────────────

const MAX_QUERY_SYMBOLS = 60

/** Parse the request URL against the API prefix. */
function subpath(req: IncomingMessage): string | null {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
  if (pathname === TICKER_API_PATH) return ''
  if (!pathname.startsWith(`${TICKER_API_PATH}/`)) return null
  return pathname.slice(TICKER_API_PATH.length)
}

/** Read a bounded JSON request body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return undefined
  return JSON.parse(text) as unknown
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/**
 * Build the prefix route: `GET /quotes`, `GET /settings`, `POST /settings`,
 * and `GET /suggest` under {@link TICKER_API_PATH}.
 * @param scope - the registered `dsh-ticker` settings owner scope.
 * @returns the webserver route registration.
 */
export function createTickerRoute(scope: SettingsScope<TickerSettings>): WebRoute {
  const backend = new TickerBackend(() => scope.get())
  return {
    kind: 'prefix',
    path: TICKER_API_PATH,
    handler: (req, res) => {
      void handle(backend, scope, req, res)
    },
  }
}

async function handle(
  backend: TickerBackend,
  scope: SettingsScope<TickerSettings>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = subpath(req)
  if (path === null) {
    sendJson(res, 404, { ok: false, error: 'unknown route' })
    return
  }
  try {
    if (path === '/quotes' && (req.method === 'GET' || req.method === 'HEAD')) {
      const url = new URL(req.url ?? '/', 'http://x')
      const raw = url.searchParams.get('symbols') ?? ''
      const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(s => s !== ''))].slice(0, MAX_QUERY_SYMBOLS)
      const { quotes, series } = await backend.snapshot(symbols)
      sendJson(res, 200, { ok: true, quotes, series })
      return
    }
    if (path === '/settings' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, section: scope.get() })
      return
    }
    if (path === '/settings' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (body === undefined || typeof body !== 'object' || body === null || Array.isArray(body)) {
        sendJson(res, 400, { ok: false, error: 'expected a JSON settings section' })
        return
      }
      let section: TickerSettings
      try {
        section = TickerSettingsSchema(body as TickerSettings)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: `invalid settings: ${String((error as Error).message ?? error)}` })
        return
      }
      const symbols = [...new Set(section.symbols.map(s => s.trim().toUpperCase()))]
        .filter(symbol => categorizeSymbol(symbol) !== null)
        .slice(0, MAX_SYMBOLS)
      const stored = { ...section, symbols }
      await scope.replace(stored)
      sendJson(res, 200, { ok: true, section: scope.get() })
      return
    }
    if (path === '/suggest' && req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://x')
      const query = url.searchParams.get('q') ?? ''
      sendJson(res, 200, { ok: true, suggestions: await fetchSuggestions(query) })
      return
    }
    sendJson(res, 404, { ok: false, error: 'unknown route' })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String((error as Error).message ?? error) })
  }
}
