/**
 * Shared Yahoo Finance client.
 *
 * Yahoo rate-limits the hosted Render egress (HTTP 429) and its crumb
 * handshake is the main trigger: yahoo-finance2 fetches a new cookie/crumb for
 * every call and throws when that request is throttled. It also validates
 * responses against a schema, which turns harmless upstream additions into
 * "Failed Yahoo Schema validation" errors.
 *
 * This module keeps one crumb/cookie pair, caches responses, serialises
 * requests, and pauses Yahoo for a few minutes after a 429. Callers get
 * `null`/`[]` instead of exceptions, so the existing provider fallbacks keep
 * working while Yahoo is unavailable.
 */

const YAHOO_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
] as const;

const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': YAHOO_USER_AGENT,
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

const REQUEST_TIMEOUT_MS = 8_000;
// Yahoo's limits are per egress IP. One request every 250 ms keeps bursts
// small without adding noticeable latency to a single lookup.
const MIN_REQUEST_INTERVAL_MS = 250;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const CRUMB_TTL_MS = 30 * 60_000;
const SEARCH_TTL_MS = 5 * 60_000;
const CHART_TTL_MS = 60_000;
const SUMMARY_TTL_MS = 6 * 60 * 60_000;
const EMPTY_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

export interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
}

export interface YahooChartQuote {
  symbol: string;
  regularMarketPrice: number;
  currency: string | null;
  shortName: string | null;
  longName: string | null;
  quoteType: string | null;
  regularMarketTime: Date | null;
}

type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function readCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function writeCache(key: string, value: unknown, ttlMs: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [entryKey, entry] of cache) {
      if (now >= entry.expiresAt) cache.delete(entryKey);
    }
    // Still full: drop the oldest insertion. Map preserves insertion order.
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

let blockedUntil = 0;

export function isYahooCoolingDown(): boolean {
  return Date.now() < blockedUntil;
}

function markRateLimited(status: number): void {
  const now = Date.now();
  if (now < blockedUntil) return;
  blockedUntil = now + RATE_LIMIT_COOLDOWN_MS;
  console.warn(
    `[yahoo] rate limited (HTTP ${status}); pausing Yahoo requests for ${
      RATE_LIMIT_COOLDOWN_MS / 60_000
    } minutes`,
  );
}

// Serialise requests so concurrent API routes cannot stampede Yahoo.
let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return task();
  });
  requestChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function yahooFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response | null> {
  if (isYahooCoolingDown()) return null;

  return schedule(async () => {
    if (isYahooCoolingDown()) return null;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...BASE_HEADERS,
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
      });

      if (response.status === 429 || response.status === 999) {
        markRateLimited(response.status);
        return null;
      }
      return response;
    } catch (error) {
      console.warn(
        `[yahoo] request failed: ${url.split('?')[0]}`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  });
}

interface YahooCrumb {
  crumb: string;
  cookie: string;
  expiresAt: number;
}

let cachedCrumb: YahooCrumb | null = null;
let crumbInFlight: Promise<YahooCrumb | null> | null = null;

async function getCrumb(): Promise<YahooCrumb | null> {
  if (cachedCrumb && Date.now() < cachedCrumb.expiresAt) return cachedCrumb;
  if (crumbInFlight) return crumbInFlight;

  crumbInFlight = (async () => {
    // fc.yahoo.com intentionally returns 404, but sets the A3 cookie used by
    // the crumb endpoint.
    const cookieResponse = await yahooFetch('https://fc.yahoo.com', {
      redirect: 'manual',
    });
    if (!cookieResponse) return null;

    const setCookies =
      typeof cookieResponse.headers.getSetCookie === 'function'
        ? cookieResponse.headers.getSetCookie()
        : [];
    let cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    if (!cookie) {
      const rawCookie = cookieResponse.headers.get('set-cookie');
      if (rawCookie) {
        cookie = rawCookie
          .split(/,(?=[^;,]+=)/)
          .map((value) => value.split(';')[0])
          .join('; ');
      }
    }
    if (!cookie) return null;

    for (const host of YAHOO_HOSTS) {
      const response = await yahooFetch(
        `https://${host}/v1/test/getcrumb`,
        { headers: { Cookie: cookie, Accept: 'text/plain' } },
      );
      if (!response?.ok) continue;

      const crumb = (await response.text())
        .trim()
        .replace(/^"|"$/g, '');
      if (!crumb || crumb.length > 40 || crumb.includes('<')) continue;

      cachedCrumb = {
        crumb,
        cookie,
        expiresAt: Date.now() + CRUMB_TTL_MS,
      };
      return cachedCrumb;
    }

    return null;
  })().finally(() => {
    crumbInFlight = null;
  });

  return crumbInFlight;
}

function toDateFromSeconds(value: unknown): Date | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const millis = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * quoteSummary wraps every number in `{ raw, fmt }`. yahoo-finance2 used to
 * unwrap those before returning, and the rest of the app expects plain
 * numbers (e.g. `holdingPercent`, `stockPosition`, sector weights). Unwrap
 * recursively so the raw endpoint stays a drop-in replacement.
 */
function unwrapSummaryValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapSummaryValues);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length > 0 &&
    keys.includes('raw') &&
    keys.every((key) => key === 'raw' || key === 'fmt' || key === 'longFmt')
  ) {
    return unwrapSummaryValues(record.raw);
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    normalized[key] = unwrapSummaryValues(entry);
  }
  return normalized;
}

/**
 * Raw Yahoo search. No crumb is required, and the response is not validated
 * against a schema, so new quote fields cannot break search.
 */
export async function yahooSearch(
  query: string,
  quotesCount = 10,
): Promise<YahooSearchQuote[]> {
  const searchQuery =
    query.replace(/\b(nse|bse)\s*:?\s*/gi, '').replace(/\s+/g, ' ').trim() ||
    query;
  const cacheKey = `search:${quotesCount}:${searchQuery.toLowerCase()}`;
  const cached = readCache<YahooSearchQuote[]>(cacheKey);
  if (cached) return cached;

  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v1/finance/search?q=${encodeURIComponent(
      searchQuery,
    )}&quotesCount=${quotesCount}&newsCount=0`;
    const response = await yahooFetch(url, {
      headers: { Referer: 'https://finance.yahoo.com/' },
    });
    if (!response?.ok) continue;

    const data = await response.json().catch(() => null);
    const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
    const mapped = quotes
      .filter((quote: any) => typeof quote?.symbol === 'string' && quote.symbol)
      .map((quote: any) => ({
        symbol: quote.symbol,
        shortname: quote.shortname,
        longname: quote.longname,
        quoteType: quote.quoteType,
        exchange: quote.exchange,
      }));

    if (mapped.length > 0) {
      writeCache(cacheKey, mapped, SEARCH_TTL_MS);
      return mapped;
    }
  }

  writeCache(cacheKey, [], EMPTY_TTL_MS);
  return [];
}

/**
 * Chart metadata for one symbol. The chart endpoint does not need a crumb and
 * includes the display names and price used by the holdings resolver.
 */
export async function yahooChartQuote(
  symbol: string,
): Promise<YahooChartQuote | null> {
  const cacheKey = `chart:${symbol}`;
  const cached = readCache<YahooChartQuote>(cacheKey);
  if (cached) return cached;

  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=5d&interval=1d&includePrePost=false`;
    const response = await yahooFetch(url);
    if (!response?.ok) continue;

    const data = await response.json().catch(() => null);
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) continue;

    const quote: YahooChartQuote = {
      symbol,
      regularMarketPrice: price,
      currency: meta?.currency || null,
      shortName: meta?.shortName || null,
      longName: meta?.longName || null,
      quoteType: meta?.instrumentType || null,
      regularMarketTime: toDateFromSeconds(meta?.regularMarketTime),
    };
    writeCache(cacheKey, quote, CHART_TTL_MS);
    return quote;
  }

  return null;
}

/** Resolve several symbols in order, skipping any Yahoo cannot resolve. */
export async function yahooQuotes(
  symbols: string[],
): Promise<YahooChartQuote[]> {
  const quotes: YahooChartQuote[] = [];
  for (const symbol of symbols) {
    const quote = await yahooChartQuote(symbol);
    if (quote) quotes.push(quote);
  }
  return quotes;
}

/**
 * Raw quoteSummary. Uses one cached crumb/cookie pair and returns the first
 * result object, matching the shape callers used to get from yahoo-finance2.
 */
export async function yahooQuoteSummary(
  symbol: string,
  modules: string[],
): Promise<any | null> {
  const cacheKey = `summary:${symbol}:${modules.join(',')}`;
  const cached = readCache<any>(cacheKey);
  if (cached) return cached;

  let credentials = await getCrumb();
  if (!credentials) return null;

  // A cached crumb can expire before its TTL. Refresh once on 401/403.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let refreshed = false;

    for (const host of YAHOO_HOSTS) {
      const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(
        symbol,
      )}?modules=${encodeURIComponent(
        modules.join(','),
      )}&crumb=${encodeURIComponent(credentials.crumb)}`;
      const response = await yahooFetch(url, {
        headers: { Cookie: credentials.cookie },
      });
      if (!response) continue;

      if (response.status === 401 || response.status === 403) {
        cachedCrumb = null;
        const nextCredentials = await getCrumb();
        if (!nextCredentials) return null;
        credentials = nextCredentials;
        refreshed = true;
        break;
      }
      if (!response.ok) continue;

      const data = await response.json().catch(() => null);
      const result = data?.quoteSummary?.result?.[0];
      if (result) {
        const normalized = unwrapSummaryValues(result);
        writeCache(cacheKey, normalized, SUMMARY_TTL_MS);
        return normalized;
      }
    }

    if (!refreshed) break;
  }

  return null;
}
