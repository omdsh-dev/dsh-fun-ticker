/**
 * Upstream quote sources for the ticker proxy: Binance (crypto, CoinGecko
 * fallback), Frankfurter (ECB FX), eastmoney (A-shares/indices, batched),
 * and Sina (HK/US, GBK). Every family normalizes into {@link SourceQuote}
 * keyed by the plugin's own symbol grammar — the HTTP route never lets a
 * client-side string reach a URL it did not parse.
 * @module @deepseek-ai/dsh-fun-ticker/sources
 */

import {
  categorizeSymbol, eastmoneySecid, type TickerCategory, type TickerSparkPoint,
  type TickerSuggestion,
} from './contract.ts'

/** One normalized quote from any upstream. */
export interface SourceQuote {
  symbol: string
  name: string
  price: number | null
  changePct: number | null
  changeAbs: number | null
  /** Epoch ms of the fetch. */
  ts: number
}

/** Result of one category batch: per-symbol quotes (null = unknown upstream) plus history seeds. */
export interface SourceBatch {
  /** Symbol → quote; a null value means the upstream answered without that symbol. */
  quotes: Map<string, SourceQuote | null>
  /** Symbol → seed history for a sparkline that has no points yet. */
  seeds: Map<string, TickerSparkPoint[]>
}

const UPSTREAM_TIMEOUT_MS = 8000

/** Non-OK upstream answer, carrying its status for per-symbol repair. */
class UpstreamError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message)
    this.name = 'UpstreamError'
  }
}

/** Fetch with an abort timeout and a browser-ish identity for the Chinese endpoints. */
async function upstreamGet(url: string, referer?: string): Promise<Response> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 dsh-ticker/1.0',
      ...(referer === undefined ? {} : { referer }),
    },
  })
  if (!response.ok) throw new UpstreamError(`upstream ${url} answered ${String(response.status)}`, response.status)
  return response
}

/** Parse a possibly-string upstream numeric field; '-' and junk read as null. */
function toFinite(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function baseName(code: string): string {
  return FX_CURRENCY_NAMES[code] ?? code
}

const FX_CURRENCY_NAMES: Readonly<Record<string, string>> = {
  CNY: '人民币', USD: '美元', EUR: '欧元', JPY: '日元', GBP: '英镑', HKD: '港元',
  AUD: '澳元', CAD: '加元', CHF: '瑞士法郎', KRW: '韩元', SGD: '新加坡元', TWD: '新台币',
  THB: '泰铢', RUB: '卢布', INR: '卢比', BRL: '雷亚尔', MXN: '比索', TRY: '里拉',
  ZAR: '兰特', SEK: '克朗', NOK: '克朗', DKK: '克朗', NZD: '新西兰元',
}

/** CoinGecko ids for the pairs a free fallback can name. */
const COINGECKO_IDS: Readonly<Record<string, string>> = {
  BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', BNBUSDT: 'binancecoin', SOLUSDT: 'solana',
  XRPUSDT: 'ripple', DOGEUSDT: 'dogecoin', ADAUSDT: 'cardano', AVAXUSDT: 'avalanche-2',
  LINKUSDT: 'chainlink', LTCUSDT: 'litecoin', DOTUSDT: 'polkadot', TRXUSDT: 'tron',
  MATICUSDT: 'matic-network', SHIBUSDT: 'shiba-inu', TONUSDT: 'the-open-network',
  BCHUSDT: 'bitcoin-cash', UNIUSDT: 'uniswap', ATOMUSDT: 'cosmos', NEARUSDT: 'near',
  APTUSDT: 'aptos', ARBUSDT: 'arbitrum', OPUSDT: 'optimism', FILUSDT: 'filecoin',
}

// ── crypto: Binance batch, CoinGecko fallback ────────────────────────────────

/**
 * Fetch a crypto batch from Binance's public data mirror; the whole batch
 * falls back to CoinGecko when Binance is unreachable.
 * @param symbols - uppercase pair symbols (BTCUSDT form).
 * @param seedPoints - kline history length for first-time sparklines.
 */
export async function fetchCryptoBatch(symbols: string[], seedPoints: number): Promise<SourceBatch> {
  const ts = Date.now()
  try {
    return await binanceBatch(symbols, seedPoints, ts)
  } catch {
    return await coingeckoBatch(symbols, ts)
  }
}

async function binanceBatch(symbols: string[], seedPoints: number, ts: number): Promise<SourceBatch> {
  let rows: Array<Record<string, unknown>> = []
  try {
    rows = await binanceRows(symbols)
  } catch (error) {
    if (!(error instanceof UpstreamError) || error.status !== 400) throw error
    // One unknown pair makes the whole batch a 400; repair per symbol so an
    // invalid entry marks only itself "not found" instead of nuking the batch.
    const results = await Promise.all(symbols.map(async (symbol) => {
      try {
        return (await binanceRows([symbol]))[0] as Record<string, unknown> | undefined
      } catch (inner) {
        if (inner instanceof UpstreamError && inner.status === 400) return undefined
        throw inner
      }
    }))
    rows = results.filter((row): row is Record<string, unknown> => row !== undefined)
  }
  const quotes = new Map<string, SourceQuote | null>()
  for (const row of rows) {
    const symbol = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : ''
    quotes.set(symbol, {
      symbol,
      name: symbol,
      price: toFinite(row.lastPrice),
      changePct: toFinite(row.priceChangePercent),
      changeAbs: toFinite(row.priceChange),
      ts,
    })
  }
  for (const symbol of symbols) if (!quotes.has(symbol)) quotes.set(symbol, null)
  const seeds = new Map<string, TickerSparkPoint[]>()
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const points = await binanceKlines(symbol, seedPoints)
      if (points.length > 0) seeds.set(symbol, points)
    } catch {
      // Seed is best-effort; the rolling cache takes over from here.
    }
  }))
  return { quotes, seeds }
}

async function binanceRows(symbols: string[]): Promise<Array<Record<string, unknown>>> {
  const query = encodeURIComponent(JSON.stringify(symbols))
  const response = await upstreamGet(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${query}`)
  return await response.json() as Array<Record<string, unknown>>
}

async function binanceKlines(symbol: string, limit: number): Promise<TickerSparkPoint[]> {
  const response = await upstreamGet(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`)
  const rows = await response.json() as unknown[][]
  return rows
    .map((row) => ({ price: toFinite(row[4]), ts: toFinite(row[0]) }))
    .filter((p): p is TickerSparkPoint => p.price !== null && p.ts !== null)
}

async function coingeckoBatch(symbols: string[], ts: number): Promise<SourceBatch> {
  const known = symbols.filter(symbol => COINGECKO_IDS[symbol] !== undefined)
  const quotes = new Map<string, SourceQuote | null>()
  if (known.length > 0) {
    const ids = known.map(symbol => COINGECKO_IDS[symbol]).join(',')
    const response = await upstreamGet(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`)
    const rows = await response.json() as Record<string, { usd?: number; usd_24h_change?: number }>
    for (const symbol of known) {
      const id = COINGECKO_IDS[symbol]
      if (id === undefined) continue
      const row = rows[id]
      quotes.set(symbol, row === undefined ? null : {
        symbol,
        name: symbol,
        price: toFinite(row.usd),
        changePct: toFinite(row.usd_24h_change),
        changeAbs: null,
        ts,
      })
    }
  }
  for (const symbol of symbols) if (!quotes.has(symbol)) quotes.set(symbol, null)
  return { quotes, seeds: new Map() }
}

// ── FX: Frankfurter (ECB) ───────────────────────────────────────────────────

/**
 * Fetch FX pairs from Frankfurter. One timeseries request per base currency
 * supplies the current rate, the previous rate (change), and the sparkline
 * seed in a single round trip.
 */
export async function fetchFxBatch(symbols: string[], seedPoints: number): Promise<SourceBatch> {
  const ts = Date.now()
  const byBase = new Map<string, string[]>()
  for (const symbol of symbols) {
    const base = symbol.slice(0, 3)
    const list = byBase.get(base)
    if (list === undefined) byBase.set(base, [symbol])
    else list.push(symbol)
  }
  const quotes = new Map<string, SourceQuote | null>()
  const seeds = new Map<string, TickerSparkPoint[]>()
  await Promise.all([...byBase.entries()].map(async ([base, pairSymbols]) => {
    const quotesList = pairSymbols.map(symbol => symbol.slice(4))
    try {
      const { current, previous, series } = await frankfurterWindow(base, quotesList, seedPoints)
      for (const symbol of pairSymbols) {
        const quote = symbol.slice(4)
        const price = toFinite(current[quote])
        const prev = toFinite(previous[quote])
        const changePct = price !== null && prev !== null && prev !== 0 ? (price - prev) / prev * 100 : null
        quotes.set(symbol, {
          symbol,
          name: `${baseName(base)}/${baseName(quote)}`,
          price,
          changePct,
          changeAbs: price !== null && prev !== null ? price - prev : null,
          ts,
        })
        const points = series
          .map(entry => ({ price: toFinite(entry.rates[quote]), ts: entry.ts }))
          .filter((p): p is TickerSparkPoint => p.price !== null)
        if (points.length > 0) seeds.set(symbol, points)
      }
    } catch {
      for (const symbol of pairSymbols) quotes.set(symbol, null)
    }
  }))
  return { quotes, seeds }
}

interface FrankfurterWindow {
  current: Record<string, unknown>
  previous: Record<string, unknown>
  series: { rates: Record<string, unknown>; ts: number }[]
}

async function frankfurterWindow(base: string, quotes: string[], seedPoints: number): Promise<FrankfurterWindow> {
  const end = new Date()
  const start = new Date(end.getTime() - (seedPoints + 14) * 24 * 60 * 60 * 1000)
  const range = `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`
  const response = await upstreamGet(`https://api.frankfurter.dev/v1/${range}?base=${base}&symbols=${quotes.join(',')}`)
  const payload = await response.json() as { rates?: Record<string, Record<string, unknown>> }
  const entries = Object.entries(payload.rates ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rates]) => ({ rates, ts: Date.parse(date) }))
  const last = entries.at(-1)
  const beforeLast = entries.at(-2)
  if (last === undefined) throw new Error(`frankfurter returned no rates for base ${base}`)
  return {
    current: last.rates,
    previous: beforeLast === undefined ? {} : beforeLast.rates,
    series: entries.slice(-seedPoints),
  }
}

// ── A-shares/indices: eastmoney ulist batch + kline seed ────────────────────

/**
 * Fetch A-share and index quotes in ONE ulist request for every symbol, then
 * seed sparklines from the 1-minute kline endpoint.
 */
export async function fetchEastmoneyBatch(symbols: string[], seedPoints: number): Promise<SourceBatch> {
  const ts = Date.now()
  const secidOf = new Map<string, string>()
  const symbolOf = new Map<string, string>()
  for (const symbol of symbols) {
    const secid = eastmoneySecid(symbol)
    if (secid === null) continue
    secidOf.set(symbol, secid)
    symbolOf.set(secid, symbol)
  }
  const quotes = new Map<string, SourceQuote | null>()
  if (secidOf.size > 0) {
    const secids = [...secidOf.values()].join(',')
    const response = await upstreamGet(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids}&fields=f12,f13,f14,f2,f3,f4`,
      'https://quote.eastmoney.com/',
    )
    const payload = await response.json() as { data?: { diff?: Array<Record<string, unknown>> } }
    const diff = payload.data?.diff ?? []
    for (const row of diff) {
      const code = String(row.f12 ?? '')
      const market = String(row.f13 ?? '')
      const symbol = symbolOf.get(`${market}.${code}`)
      if (symbol === undefined) continue
      // ulist reports price/change/percent in cents (×100) — normalize to units.
      const scaled = (value: unknown): number | null => {
        const parsed = toFinite(value)
        return parsed === null ? null : parsed / 100
      }
      quotes.set(symbol, {
        symbol,
        name: String(row.f14 ?? symbol),
        price: scaled(row.f2),
        changePct: scaled(row.f3),
        changeAbs: scaled(row.f4),
        ts,
      })
    }
  }
  for (const symbol of symbols) if (!quotes.has(symbol)) quotes.set(symbol, null)
  const seeds = new Map<string, TickerSparkPoint[]>()
  await Promise.all(symbols.map(async (symbol) => {
    const secid = secidOf.get(symbol)
    if (secid === undefined) return
    try {
      const points = await eastmoneyKlines(secid, seedPoints)
      if (points.length > 0) seeds.set(symbol, points)
    } catch {
      // Seed is best-effort.
    }
  }))
  return { quotes, seeds }
}

async function eastmoneyKlines(secid: string, limit: number): Promise<TickerSparkPoint[]> {
  const response = await upstreamGet(
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=1&fqt=1&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&end=20500101&lmt=${limit}`,
    'https://quote.eastmoney.com/',
  )
  const payload = await response.json() as { data?: { klines?: string[] } }
  return (payload.data?.klines ?? []).flatMap((line) => {
    const [time, close] = line.split(',')
    if (time === undefined) return []
    const price = toFinite(close)
    const ts = Date.parse(`${time.replace(' ', 'T')}Z`)
    return price === null || !Number.isFinite(ts) ? [] : [{ price, ts }]
  })
}

// ── HK/US: Sina (GBK) ───────────────────────────────────────────────────────

/** Fetch HK (`hk00700`) and US (`gb_aapl`) quotes from Sina's legacy feed. */
export async function fetchSinaBatch(symbols: string[]): Promise<SourceBatch> {
  const ts = Date.now()
  const quotes = new Map<string, SourceQuote | null>()
  const response = await upstreamGet(`https://hq.sinajs.cn/list=${symbols.join(',').toLowerCase()}`, 'https://finance.sina.com.cn/')
  const buffer = await response.arrayBuffer()
  const text = new TextDecoder('gbk').decode(buffer)
  for (const match of text.matchAll(/hq_str_(\w+)="([^"]*)"/g)) {
    const raw = match[1] ?? ''
    const symbol = raw.startsWith('gb_') ? `gb_${raw.slice(3).toLowerCase()}` : raw
    if (!symbols.includes(symbol)) continue
    const fields = (match[2] ?? '').split(',')
    quotes.set(symbol, symbol.startsWith('gb_') ? parseSinaUs(symbol, fields, ts) : parseSinaHk(symbol, fields, ts))
  }
  for (const symbol of symbols) if (!quotes.has(symbol)) quotes.set(symbol, null)
  return { quotes, seeds: new Map() }
}

function parseSinaHk(symbol: string, fields: string[], ts: number): SourceQuote | null {
  if (fields.length < 9 || fields[6] === '') return null
  return {
    symbol,
    name: fields[1] ?? symbol,
    price: toFinite(fields[6]),
    changePct: toFinite(fields[8]),
    changeAbs: toFinite(fields[7]),
    ts,
  }
}

function parseSinaUs(symbol: string, fields: string[], ts: number): SourceQuote | null {
  if (fields.length < 5 || fields[1] === '') return null
  return {
    symbol,
    name: fields[0] ?? symbol,
    price: toFinite(fields[1]),
    changePct: toFinite(fields[2]),
    changeAbs: toFinite(fields[4]),
    ts,
  }
}

// ── suggestion catalog ──────────────────────────────────────────────────────

/** Built-in catalog that needs no upstream call. */
const BUILTIN_CATALOG: readonly TickerSuggestion[] = [
  // indices
  { symbol: 'SH000001', name: '上证指数', category: 'index' },
  { symbol: 'SZ399001', name: '深证成指', category: 'index' },
  { symbol: 'SZ399006', name: '创业板指', category: 'index' },
  // A-shares
  { symbol: '600519', name: '贵州茅台', category: 'ashare' },
  { symbol: '601318', name: '中国平安', category: 'ashare' },
  { symbol: '600036', name: '招商银行', category: 'ashare' },
  { symbol: '000858', name: '五粮液', category: 'ashare' },
  { symbol: '300750', name: '宁德时代', category: 'ashare' },
  { symbol: '601899', name: '紫金矿业', category: 'ashare' },
  { symbol: '002594', name: '比亚迪', category: 'ashare' },
  { symbol: '600900', name: '长江电力', category: 'ashare' },
  { symbol: '601988', name: '中国银行', category: 'ashare' },
  { symbol: '600030', name: '中信证券', category: 'ashare' },
  { symbol: '000333', name: '美的集团', category: 'ashare' },
  { symbol: '601166', name: '兴业银行', category: 'ashare' },
  // FX
  { symbol: 'USD/CNY', name: '美元/人民币', category: 'fx' },
  { symbol: 'EUR/CNY', name: '欧元/人民币', category: 'fx' },
  { symbol: 'JPY/CNY', name: '日元/人民币', category: 'fx' },
  { symbol: 'GBP/CNY', name: '英镑/人民币', category: 'fx' },
  { symbol: 'USD/JPY', name: '美元/日元', category: 'fx' },
  { symbol: 'EUR/USD', name: '欧元/美元', category: 'fx' },
  { symbol: 'USD/HKD', name: '美元/港元', category: 'fx' },
  // HK
  { symbol: 'hk00700', name: '腾讯控股', category: 'hk' },
  { symbol: 'hk09988', name: '阿里巴巴-W', category: 'hk' },
  { symbol: 'hk03690', name: '美团-W', category: 'hk' },
  { symbol: 'hk01810', name: '小米集团-W', category: 'hk' },
  { symbol: 'hk00941', name: '中国移动', category: 'hk' },
  { symbol: 'hk00005', name: '汇丰控股', category: 'hk' },
  { symbol: 'hk09999', name: '网易-S', category: 'hk' },
  { symbol: 'hk01024', name: '快手-W', category: 'hk' },
  { symbol: 'hk00388', name: '香港交易所', category: 'hk' },
  { symbol: 'hk01211', name: '比亚迪股份', category: 'hk' },
  // US
  { symbol: 'gb_aapl', name: '苹果', category: 'us' },
  { symbol: 'gb_msft', name: '微软', category: 'us' },
  { symbol: 'gb_googl', name: '谷歌-A', category: 'us' },
  { symbol: 'gb_amzn', name: '亚马逊', category: 'us' },
  { symbol: 'gb_nvda', name: '英伟达', category: 'us' },
  { symbol: 'gb_tsla', name: '特斯拉', category: 'us' },
  { symbol: 'gb_meta', name: 'Meta', category: 'us' },
  { symbol: 'gb_baba', name: '阿里巴巴', category: 'us' },
  { symbol: 'gb_brk_a', name: '伯克希尔-A', category: 'us' },
  // crypto
  { symbol: 'BTCUSDT', name: '比特币', category: 'crypto' },
  { symbol: 'ETHUSDT', name: '以太坊', category: 'crypto' },
  { symbol: 'BNBUSDT', name: '币安币', category: 'crypto' },
  { symbol: 'SOLUSDT', name: 'Solana', category: 'crypto' },
  { symbol: 'XRPUSDT', name: '瑞波币', category: 'crypto' },
  { symbol: 'DOGEUSDT', name: '狗狗币', category: 'crypto' },
  { symbol: 'ADAUSDT', name: 'Cardano', category: 'crypto' },
  { symbol: 'AVAXUSDT', name: 'Avalanche', category: 'crypto' },
  { symbol: 'LINKUSDT', name: 'Chainlink', category: 'crypto' },
  { symbol: 'LTCUSDT', name: '莱特币', category: 'crypto' },
  { symbol: 'SHIBUSDT', name: 'Shiba Inu', category: 'crypto' },
  { symbol: 'TONUSDT', name: 'Toncoin', category: 'crypto' },
]

interface CatalogCache {
  ts: number
  value: TickerSuggestion[]
}

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const catalogCache = new Map<string, CatalogCache>()

/** Binance exchangeInfo-derived crypto pairs (cached 24h; built-ins on failure). */
async function cryptoCatalog(): Promise<TickerSuggestion[]> {
  const cached = catalogCache.get('binance')
  if (cached !== undefined && Date.now() - cached.ts < CATALOG_TTL_MS) return cached.value
  let value: TickerSuggestion[] = []
  try {
    const response = await upstreamGet('https://data-api.binance.vision/api/v3/exchangeInfo')
    const payload = await response.json() as { symbols?: Array<{ symbol?: string; status?: string; quoteAsset?: string }> }
    value = (payload.symbols ?? [])
      .filter(entry => entry.status === 'TRADING' && entry.quoteAsset === 'USDT')
      .map(entry => ({ symbol: entry.symbol ?? '', name: entry.symbol ?? '', category: 'crypto' as const }))
  } catch {
    value = BUILTIN_CATALOG.filter(entry => entry.category === 'crypto')
  }
  catalogCache.set('binance', { ts: Date.now(), value })
  return value
}

/** Frankfurter currency codes (cached 24h; built-in FX pairs on failure). */
async function fxCatalog(): Promise<TickerSuggestion[]> {
  const cached = catalogCache.get('frankfurter')
  if (cached !== undefined && Date.now() - cached.ts < CATALOG_TTL_MS) return cached.value
  let value: TickerSuggestion[] = []
  try {
    const response = await upstreamGet('https://api.frankfurter.dev/v1/currencies')
    const payload = await response.json() as Record<string, string>
    value = Object.keys(payload)
      .filter(code => code.length === 3)
      .map(code => ({ symbol: `USD/${code}`, name: `美元/${payload[code] ?? code}`, category: 'fx' as const }))
  } catch {
    value = BUILTIN_CATALOG.filter(entry => entry.category === 'fx')
  }
  catalogCache.set('frankfurter', { ts: Date.now(), value })
  return value
}

const MAX_PER_CATEGORY = 12

/**
 * Autocomplete over the built-in and upstream catalogs for one query.
 * A query that already parses as a valid symbol is offered verbatim first.
 */
export async function fetchSuggestions(query: string): Promise<TickerSuggestion[]> {
  const q = query.trim().toUpperCase()
  if (q === '') return []
  const [crypto, fx] = await Promise.all([cryptoCatalog(), fxCatalog()])
  const all = [...crypto, ...fx, ...BUILTIN_CATALOG]
  const seen = new Set<string>()
  const counts = new Map<TickerCategory, number>()
  const matches: TickerSuggestion[] = []
  const push = (entry: TickerSuggestion): void => {
    const count = counts.get(entry.category) ?? 0
    if (count >= MAX_PER_CATEGORY || seen.has(entry.symbol)) return
    seen.add(entry.symbol)
    counts.set(entry.category, count + 1)
    matches.push(entry)
  }
  const self = categorizeSymbol(q)
  if (self !== null) {
    push({ symbol: q, name: q.toUpperCase(), category: self })
  }
  for (const entry of all) {
    const symbol = entry.symbol.toUpperCase()
    const name = entry.name.toUpperCase()
    if (!symbol.includes(q) && !name.includes(q)) continue
    push(entry)
  }
  return matches.slice(0, 60)
}
