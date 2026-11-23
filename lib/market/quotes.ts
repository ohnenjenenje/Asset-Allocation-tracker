/**
 * Live market quote providers that do not depend on Yahoo Finance.
 *
 * Yahoo rate-limits the hosted Render service (HTTP 429), so every quote used
 * to fall back to Google Sheets and was reported as stale. These providers give
 * the price API a live path for each asset class while Yahoo remains available
 * as an optional fallback.
 */

export interface MarketQuote {
  symbol: string;
  regularMarketPrice: number;
  currency: string;
  shortName?: string | null;
  quoteType?: string | null;
  marketCap?: number | null;
  /** Provider timestamp for the quote, not the time we fetched it. */
  regularMarketTime: Date | null;
  source: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const REQUEST_TIMEOUT_MS = 8_000;

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const toDateFromSeconds = (value: unknown): Date | null => {
  const seconds = toNumber(value);
  if (seconds == null || seconds <= 0) return null;
  // Some providers return milliseconds even when the field name says seconds.
  const ms = seconds > 10_000_000_000 ? seconds : seconds * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date : null;
};

const toDateFromIso = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

async function getJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<any | null> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function getText(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': USER_AGENT,
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const TZ_OFFSETS: Record<string, string> = {
  EST: '-05:00',
  EDT: '-04:00',
  CST: '-06:00',
  CDT: '-05:00',
  MST: '-07:00',
  MDT: '-06:00',
  PST: '-08:00',
  PDT: '-07:00',
  UTC: '+00:00',
  GMT: '+00:00',
};

/**
 * Parse US market timestamps such as "Nov 20, 2026, 4:00 PM EST" without
 * relying on the server's local timezone.
 */
function parseUsMarketTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const cleaned = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const match =
    /^([A-Z][a-z]{2}) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ?([A-Z]{2,4})?$/.exec(
      cleaned,
    );
  if (!match) return null;

  const [, monthName, dayRaw, yearRaw, hourRaw, minuteRaw, meridiem, zoneRaw] =
    match;
  const month = MONTHS[monthName];
  if (month == null) return null;

  const day = Number(dayRaw);
  const year = Number(yearRaw);
  let hour = Number(hourRaw) % 12;
  if (meridiem === 'PM') hour += 12;
  const minute = Number(minuteRaw);

  // US daylight saving runs from the second Sunday in March to the first
  // Sunday in November. Compute it from the date instead of assuming the whole
  // of November is still on summer time.
  const secondSundayMarch =
    8 + ((7 - new Date(year, 2, 8).getDay()) % 7);
  const firstSundayNovember =
    1 + ((7 - new Date(year, 10, 1).getDay()) % 7);
  const isUsDst =
    month > 2 && month < 10
      ? true
      : month < 2 || month > 10
        ? false
        : month === 2
          ? day >= secondSundayMarch
          : day < firstSundayNovember;

  let zone = zoneRaw || 'ET';
  if (zone === 'ET') zone = isUsDst ? 'EDT' : 'EST';
  if (zone === 'CT') zone = isUsDst ? 'CDT' : 'CST';
  if (zone === 'MT') zone = isUsDst ? 'MDT' : 'MST';
  if (zone === 'PT') zone = isUsDst ? 'PDT' : 'PST';

  const offset = TZ_OFFSETS[zone] || '-05:00';
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

const isMutualFundCode = (symbol: string): boolean =>
  symbol.startsWith('0P') ||
  /^\d+$/.test(symbol) ||
  symbol.startsWith('MF_') ||
  /^INF[A-Z0-9]{9}$/i.test(symbol);

const isBondIsin = (symbol: string): boolean =>
  /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(symbol);

// BSE's mobile quote page is keyed by numeric scrip code, not ISIN. These are
// the codes for the bonds in the portfolio; unknown ISINs are resolved from
// Fixed Alpha below and then cached for the life of the server process.
const BSE_BOND_SCRIP_CODES: Record<string, string> = {
  INE342T07635: '977017',
  INE101Q07BK8: '940635',
};
const bseBondScripCodeCache = new Map<string, string>();

// BSE's mobile quote page is reliable but can be slow on a cold cache. Keep
// the last good LTP so a transient timeout does not flip an otherwise valid
// bond quote back to "stale".
const BSE_BOND_QUOTE_TTL_MS = 5 * 60_000;
const BSE_BOND_QUOTE_FALLBACK_MS = 60 * 60_000;
const bseBondQuoteCache = new Map<
  string,
  { quote: MarketQuote; fetchedAt: number }
>();

const decodeHtmlText = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();

/** Parse BSE's "LTD- 20 Nov 26 | 04:00 PM" timestamp as IST. */
function parseBseBondTime(value: string | null): Date | null {
  if (!value) return null;
  const match =
    /LTD-\s*(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{2})\s*\|\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(
      value,
    );
  if (!match) return null;

  const [, dayRaw, monthName, yearRaw, hourRaw, minuteRaw, meridiem] = match;
  const month =
    MONTHS[
      `${monthName[0].toUpperCase()}${monthName.slice(1).toLowerCase()}`
    ];
  if (month == null) return null;

  let hour = Number(hourRaw) % 12;
  if (meridiem.toUpperCase() === 'PM') hour += 12;

  const iso = `20${yearRaw}-${String(month + 1).padStart(2, '0')}-${String(Number(dayRaw)).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minuteRaw}:00+05:30`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function resolveBseBondScripCode(isin: string): Promise<string | null> {
  const known = BSE_BOND_SCRIP_CODES[isin];
  if (known) return known;

  const cached = bseBondScripCodeCache.get(isin);
  if (cached) return cached;

  const html = await getText(
    `https://www.fixedalpha.com/bonds/${encodeURIComponent(isin)}`,
    {},
    12_000,
  );
  if (!html) return null;

  // Fixed Alpha embeds the exchange identifiers in its React payload, where
  // quotes are backslash-escaped.
  const normalized = html.replace(/\\"/g, '"');
  const code = /"bseScripCode"\s*:\s*"(\d{5,7})"/.exec(normalized)?.[1];
  if (!code) return null;

  bseBondScripCodeCache.set(isin, code);
  return code;
}

/**
 * Last traded price for a BSE-listed corporate bond. The public desktop API is
 * blocked by Akamai, but BSE's mobile quote page renders the same LTP as HTML.
 */
async function fetchBseBondQuote(symbol: string): Promise<MarketQuote | null> {
  const isin = symbol.toUpperCase();
  const cached = bseBondQuoteCache.get(isin);
  const cacheAge = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && cacheAge < BSE_BOND_QUOTE_TTL_MS) return cached.quote;

  const scripCode = await resolveBseBondScripCode(isin);
  if (!scripCode) {
    return cached && cacheAge < BSE_BOND_QUOTE_FALLBACK_MS ? cached.quote : null;
  }

  const html = await getText(
    `https://m.bseindia.com/StockReach.aspx?scripcd=${encodeURIComponent(scripCode)}`,
    { headers: { Referer: 'https://m.bseindia.com/' } },
    40_000,
  );

  const price = toNumber(
    /id="strongCvalue">([^<]+)</i.exec(html || '')?.[1],
  );
  if (html && price != null && price > 0) {
    const name = decodeHtmlText(
      /id="spanCname"[^>]*>([^<]+)</i.exec(html)?.[1] || '',
    );
    const timeText = /id="strongDate">([^<]+)</i.exec(html)?.[1] || null;

    const quote: MarketQuote = {
      symbol,
      regularMarketPrice: price,
      currency: 'INR',
      shortName: name || null,
      quoteType: 'BOND',
      marketCap: null,
      regularMarketTime: parseBseBondTime(timeText),
      source: 'BSE India',
    };
    bseBondQuoteCache.set(isin, { quote, fetchedAt: Date.now() });
    return quote;
  }

  return cached && cacheAge < BSE_BOND_QUOTE_FALLBACK_MS ? cached.quote : null;
}

/** NSE/BSE equity quote from Groww's public live-price endpoint. */
async function fetchGrowwQuote(symbol: string): Promise<MarketQuote | null> {
  const ticker = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
  if (!ticker) return null;

  const data = await getJson(
    `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${encodeURIComponent(ticker)}/latest`,
  );
  const price = toNumber(data?.ltp) ?? toNumber(data?.indicativePrice);
  if (price == null || price <= 0) return null;

  return {
    symbol,
    regularMarketPrice: price,
    currency: 'INR',
    shortName: null,
    quoteType: 'EQUITY',
    marketCap: null,
    regularMarketTime:
      toDateFromSeconds(data?.lastTradeTime) ??
      toDateFromSeconds(data?.tsInMillis),
    source: 'Groww',
  };
}

/**
 * Moneycontrol fallback for NSE/BSE. The public price feed needs Moneycontrol's
 * own scrip id, which the autosuggest endpoint returns for a ticker.
 */
async function fetchMoneycontrolQuote(
  symbol: string,
): Promise<MarketQuote | null> {
  const ticker = symbol.replace(/\.(NS|BO)$/i, '').toUpperCase();
  if (!ticker) return null;

  const suggestions = await getJson(
    `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${encodeURIComponent(ticker)}&type=1&format=json`,
  );
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  const match =
    suggestions.find((item: any) => {
      const text = `${item?.pdt_dis_nm || ''} ${item?.link_src || ''}`;
      return text.toUpperCase().includes(ticker);
    }) || suggestions[0];

  const scripId = typeof match?.sc_id === 'string' ? match.sc_id : null;
  if (!scripId) return null;

  const feeds =
    symbol.endsWith('.BO') ? ['bse', 'nse'] : ['nse', 'bse'];
  for (const feed of feeds) {
    const data = await getJson(
      `https://priceapi.moneycontrol.com/pricefeed/${feed}/equitycash/${encodeURIComponent(scripId)}`,
      { headers: { Referer: 'https://www.moneycontrol.com/' } },
    );
    const price = toNumber(data?.data?.pricecurrent);
    if (price == null || price <= 0) continue;

    return {
      symbol,
      regularMarketPrice: price,
      currency: 'INR',
      shortName: typeof data?.data?.HN === 'string' ? data.data.HN : null,
      quoteType: 'EQUITY',
      marketCap: null,
      regularMarketTime: toDateFromSeconds(data?.data?.lastupd_epoch),
      source: 'Moneycontrol',
    };
  }

  return null;
}

/** Regular-session close/last price for US stocks and ETFs. */
async function fetchStockAnalysisQuote(
  symbol: string,
): Promise<MarketQuote | null> {
  const data = await getJson(
    `https://stockanalysis.com/api/quotes/s/${encodeURIComponent(symbol)}`,
  );
  const price = toNumber(data?.data?.p) ?? toNumber(data?.data?.ep);
  if (price == null || price <= 0) return null;

  const ts = toNumber(data?.data?.ts);
  return {
    symbol,
    regularMarketPrice: price,
    currency: 'USD',
    shortName: null,
    quoteType: null,
    marketCap: null,
    regularMarketTime: ts != null ? toDateFromSeconds(ts) : null,
    source: 'StockAnalysis',
  };
}

/** Nasdaq quote fallback for US-listed stocks and ETFs. */
async function fetchNasdaqQuote(symbol: string): Promise<MarketQuote | null> {
  for (const assetclass of ['etf', 'stocks']) {
    const data = await getJson(
      `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetclass}&markettype=${assetclass}`,
      {
        headers: {
          Origin: 'https://www.nasdaq.com',
          Referer: 'https://www.nasdaq.com/',
        },
      },
    );
    const price = toNumber(data?.data?.primaryData?.lastSalePrice);
    if (price == null || price <= 0) continue;

    return {
      symbol,
      regularMarketPrice: price,
      currency: 'USD',
      shortName: data?.data?.companyName || null,
      quoteType: null,
      marketCap: null,
      regularMarketTime: parseUsMarketTime(
        data?.data?.primaryData?.lastTradeTimestamp,
      ),
      source: 'Nasdaq',
    };
  }
  return null;
}

const COINGECKO_IDS: Record<string, string> = {
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  BCH: 'bitcoin-cash',
  BNB: 'binancecoin',
  BTC: 'bitcoin',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  ETH: 'ethereum',
  LINK: 'chainlink',
  LTC: 'litecoin',
  MATIC: 'matic-network',
  SHIB: 'shiba-inu',
  SOL: 'solana',
  TON: 'the-open-network',
  TRX: 'tron',
  USDC: 'usd-coin',
  USDT: 'tether',
  XRP: 'ripple',
};

async function fetchCoinGeckoQuote(
  symbol: string,
): Promise<MarketQuote | null> {
  const base = symbol.replace(/-USD$/i, '').toUpperCase();
  const id = COINGECKO_IDS[base];
  if (!id) return null;

  const data = await getJson(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_last_updated_at=true`,
  );
  const price = toNumber(data?.[id]?.usd);
  if (price == null || price <= 0) return null;

  return {
    symbol,
    regularMarketPrice: price,
    currency: 'USD',
    shortName: null,
    quoteType: 'CRYPTOCURRENCY',
    marketCap: null,
    regularMarketTime: toDateFromSeconds(data?.[id]?.last_updated_at),
    source: 'CoinGecko',
  };
}

async function fetchCoinbaseQuote(
  symbol: string,
): Promise<MarketQuote | null> {
  const base = symbol.replace(/-USD$/i, '').toUpperCase();
  if (!base) return null;

  const data = await getJson(
    `https://api.coinbase.com/v2/prices/${encodeURIComponent(base)}-USD/spot`,
  );
  const price = toNumber(data?.data?.amount);
  if (price == null || price <= 0) return null;

  return {
    symbol,
    regularMarketPrice: price,
    currency: 'USD',
    shortName: null,
    quoteType: 'CRYPTOCURRENCY',
    marketCap: null,
    regularMarketTime: new Date(),
    source: 'Coinbase',
  };
}

/** Spot metal price in USD per troy ounce. */
async function fetchGoldApiQuote(
  symbol: string,
  code: 'XAU' | 'XAG',
): Promise<MarketQuote | null> {
  const data = await getJson(`https://api.gold-api.com/price/${code}`);
  const price = toNumber(data?.price);
  if (price == null || price <= 0) return null;

  return {
    symbol,
    regularMarketPrice: price,
    currency: 'USD',
    shortName: data?.name || null,
    quoteType: 'COMMODITY',
    marketCap: null,
    regularMarketTime: toDateFromIso(data?.updatedAt),
    source: 'Gold API',
  };
}

/**
 * USD/INR reference rate. Daily reference rates are deliberately preferred
 * over a second Yahoo request; they are also what the metals conversion used
 * before intraday FX was introduced.
 */
async function fetchUsdInrQuote(): Promise<MarketQuote | null> {
  const frankfurter = await getJson(
    'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR',
  );
  const frankfurterRate = toNumber(frankfurter?.rates?.INR);
  if (frankfurterRate != null && frankfurterRate > 0) {
    const date =
      typeof frankfurter?.date === 'string'
        ? new Date(`${frankfurter.date}T14:00:00Z`)
        : null;
    return {
      symbol: 'INR=X',
      regularMarketPrice: frankfurterRate,
      currency: 'INR',
      shortName: 'USD/INR',
      quoteType: 'CURRENCY',
      marketCap: null,
      regularMarketTime:
        date && Number.isFinite(date.getTime()) ? date : new Date(),
      source: 'Frankfurter',
    };
  }

  const erApi = await getJson('https://open.er-api.com/v6/latest/USD');
  const erRate = toNumber(erApi?.rates?.INR);
  if (erRate != null && erRate > 0) {
    return {
      symbol: 'INR=X',
      regularMarketPrice: erRate,
      currency: 'INR',
      shortName: 'USD/INR',
      quoteType: 'CURRENCY',
      marketCap: null,
      regularMarketTime: toDateFromSeconds(erApi?.time_last_update_unix),
      source: 'Open Exchange Rates',
    };
  }

  const fawaz = await getJson(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  );
  const fawazRate = toNumber(fawaz?.usd?.inr);
  if (fawazRate != null && fawazRate > 0) {
    const date =
      typeof fawaz?.date === 'string' ? new Date(`${fawaz.date}T14:00:00Z`) : null;
    return {
      symbol: 'INR=X',
      regularMarketPrice: fawazRate,
      currency: 'INR',
      shortName: 'USD/INR',
      quoteType: 'CURRENCY',
      marketCap: null,
      regularMarketTime:
        date && Number.isFinite(date.getTime()) ? date : new Date(),
      source: 'Currency API',
    };
  }

  return null;
}

/**
 * Yahoo's chart endpoint is lighter than its quote endpoint and does not need a
 * crumb. It is used only when the non-Yahoo providers cannot resolve a symbol.
 * The public CORS proxy is a last resort for hosts that block Render's IPs.
 */
export async function fetchYahooChartQuote(
  symbol: string,
): Promise<MarketQuote | null> {
  const chartPath = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
  const urls = [
    `https://query2.finance.yahoo.com${chartPath}`,
    `https://query1.finance.yahoo.com${chartPath}`,
  ];

  for (const url of urls) {
    const data = await getJson(url);
    const meta = data?.chart?.result?.[0]?.meta;
    const price = toNumber(meta?.regularMarketPrice);
    if (price == null || price <= 0) continue;

    return {
      symbol,
      regularMarketPrice: price,
      currency: meta?.currency || 'USD',
      shortName: meta?.shortName || meta?.longName || null,
      quoteType: meta?.instrumentType || null,
      marketCap: null,
      regularMarketTime: toDateFromSeconds(meta?.regularMarketTime),
      source: 'Yahoo Finance',
    };
  }

  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(urls[0])}`;
  const proxied = await getJson(proxyUrl, {}, 12_000);
  const proxiedMeta = proxied?.chart?.result?.[0]?.meta;
  const proxiedPrice = toNumber(proxiedMeta?.regularMarketPrice);
  if (proxiedPrice == null || proxiedPrice <= 0) return null;

  return {
    symbol,
    regularMarketPrice: proxiedPrice,
    currency: proxiedMeta?.currency || 'USD',
    shortName: proxiedMeta?.shortName || proxiedMeta?.longName || null,
    quoteType: proxiedMeta?.instrumentType || null,
    marketCap: null,
    regularMarketTime: toDateFromSeconds(proxiedMeta?.regularMarketTime),
    source: 'Yahoo Finance',
  };
}

/**
 * Resolve a symbol through the non-Yahoo provider chain. This returns `null`
 * for symbols that need Yahoo or that should stay on the sheet value.
 */
export async function fetchFallbackQuote(
  symbol: string,
): Promise<MarketQuote | null> {
  const upper = symbol.toUpperCase();

  if (upper === 'GC=F') return fetchGoldApiQuote(symbol, 'XAU');
  if (upper === 'SI=F') return fetchGoldApiQuote(symbol, 'XAG');
  if (upper === 'INR=X') return fetchUsdInrQuote();

  if (isBondIsin(upper)) return fetchBseBondQuote(symbol);
  if (isMutualFundCode(upper)) return null;

  if (upper.endsWith('.NS') || upper.endsWith('.BO')) {
    return (await fetchGrowwQuote(upper)) || (await fetchMoneycontrolQuote(upper));
  }

  if (upper.endsWith('-USD')) {
    return (
      (await fetchCoinGeckoQuote(upper)) || (await fetchCoinbaseQuote(upper))
    );
  }

  // US-listed stocks and ETFs.
  if (!upper.includes('.')) {
    return (await fetchStockAnalysisQuote(upper)) || (await fetchNasdaqQuote(upper));
  }

  return null;
}
