import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XAUS_URL = 'https://xaus.com/api/v1/spot';
// Yahoo's v7 quote endpoint now requires a crumb/cookie handshake that is
// frequently rejected for cloud-hosted IPs. The chart endpoint is public and
// returns the same regularMarketPrice/regularMarketTime fields we need.
const YAHOO_CHART_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
] as const;
const YAHOO_USER_AGENT =
  'Mozilla/5.0 (compatible; AssetTracker/0.1; +https://github.com/ohnenjenenje/Asset-Allocation-tracker)';
const CACHE_MS = 10 * 60_000;
const SHORT_CACHE_MS = 2 * 60_000;
const UPSTREAM_TIMEOUT_MS = 6_000;
const CROSS_CHECK_TOLERANCE_PCT = 1.5;

type CrossCheckStatus = 'match' | 'mismatch' | 'stale' | 'unavailable';

interface MetalQuote {
  goldUsd: number | null;
  silverUsd: number | null;
  ratio: number | null;
  asOf: string | null;
  stale: boolean;
}

interface GoldSilverData {
  ratio: number | null;
  goldUsd: number | null;
  silverUsd: number | null;
  primarySource: 'yahoo' | 'xaus' | null;
  asOf: string | null;
  stale: boolean;
  yahoo: MetalQuote | null;
  xaus: MetalQuote | null;
  crossCheck: {
    status: CrossCheckStatus;
    differencePct: number | null;
    tolerancePct: number;
  };
}

let cache: { data: GoldSilverData; expiresAt: number } | null = null;

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function timestampToIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Yahoo quotes use seconds; guard against millisecond timestamps too.
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function computeRatio(goldUsd: number | null, silverUsd: number | null): number | null {
  if (!goldUsd || !silverUsd) return null;
  return goldUsd / silverUsd;
}

interface YahooChartMeta {
  regularMarketPrice?: unknown;
  regularMarketTime?: unknown;
}

async function fetchYahooChartMeta(symbol: string): Promise<YahooChartMeta> {
  let lastError: unknown = null;

  for (const host of YAHOO_CHART_HOSTS) {
    try {
      const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': YAHOO_USER_AGENT,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`${host} responded with ${response.status} for ${symbol}`);
      }

      const payload = (await response.json()) as any;
      const meta = payload?.chart?.result?.[0]?.meta as YahooChartMeta | undefined;
      if (!meta) {
        throw new Error(`${host} returned no chart metadata for ${symbol}`);
      }
      return meta;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Yahoo chart request failed for ${symbol}`);
}

async function fetchYahooQuote(): Promise<MetalQuote | null> {
  try {
    const [gold, silver] = await Promise.all([
      fetchYahooChartMeta('GC=F'),
      fetchYahooChartMeta('SI=F'),
    ]);

    const goldUsd = positiveNumber(gold?.regularMarketPrice);
    const silverUsd = positiveNumber(silver?.regularMarketPrice);
    const ratio = computeRatio(goldUsd, silverUsd);
    if (!ratio) return null;

    const timestamps = [gold, silver]
      .map((meta) => timestampToIso(meta?.regularMarketTime))
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      goldUsd,
      silverUsd,
      ratio,
      asOf: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
      stale: false,
    };
  } catch (error) {
    console.error('[gold-silver] Yahoo quote failed:', error);
    return null;
  }
}

async function fetchXausQuote(): Promise<MetalQuote | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(XAUS_URL, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'AssetTracker/0.1',
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`xaus responded with ${response.status}`);
      }

      const payload = (await response.json()) as any;
      const goldUsd =
        positiveNumber(payload?.xau?.price) ?? positiveNumber(payload?.spot_usd_oz);
      const silverUsd = positiveNumber(payload?.silver_usd_oz);
      const ratio =
        positiveNumber(payload?.gold_silver_ratio) ?? computeRatio(goldUsd, silverUsd);
      if (!ratio) return null;

      return {
        goldUsd,
        silverUsd,
        ratio,
        asOf: timestampToIso(payload?.price_as_of ?? payload?.updated_at),
        stale: Boolean(payload?.stale),
      };
    } catch (error) {
      if (attempt === 1) {
        console.error('[gold-silver] xaus quote failed:', error);
        return null;
      }
    }
  }

  return null;
}

function crossCheckFor(
  yahooQuote: MetalQuote | null,
  xausQuote: MetalQuote | null,
): GoldSilverData['crossCheck'] {
  if (!yahooQuote?.ratio || !xausQuote?.ratio) {
    return {
      status: 'unavailable',
      differencePct: null,
      tolerancePct: CROSS_CHECK_TOLERANCE_PCT,
    };
  }

  const midpoint = (yahooQuote.ratio + xausQuote.ratio) / 2;
  const differencePct =
    midpoint > 0 ? (Math.abs(yahooQuote.ratio - xausQuote.ratio) / midpoint) * 100 : null;
  const status: CrossCheckStatus = xausQuote.stale
    ? 'stale'
    : differencePct != null && differencePct <= CROSS_CHECK_TOLERANCE_PCT
      ? 'match'
      : 'mismatch';

  return { status, differencePct, tolerancePct: CROSS_CHECK_TOLERANCE_PCT };
}

function buildData(
  yahooQuote: MetalQuote | null,
  xausQuote: MetalQuote | null,
): GoldSilverData {
  const primary = yahooQuote ?? xausQuote;

  return {
    ratio: primary?.ratio ?? null,
    goldUsd: primary?.goldUsd ?? null,
    silverUsd: primary?.silverUsd ?? null,
    primarySource: yahooQuote ? 'yahoo' : xausQuote ? 'xaus' : null,
    asOf: primary?.asOf ?? null,
    stale: Boolean(primary?.stale),
    yahoo: yahooQuote,
    xaus: xausQuote,
    crossCheck: crossCheckFor(yahooQuote, xausQuote),
  };
}

/** Retry sooner while the independent cross-check is missing. */
function cacheTtlFor(data: GoldSilverData): number {
  return data.crossCheck.status === 'unavailable' ? SHORT_CACHE_MS : CACHE_MS;
}

function cacheHeadersFor(ttlMs: number): Record<string, string> {
  const seconds = Math.ceil(ttlMs / 1000);
  return {
    'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds / 2}`,
  };
}

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(
      { success: true, data: cache.data },
      { headers: cacheHeadersFor(cache.expiresAt - now) },
    );
  }

  const [yahooQuote, xausQuote] = await Promise.all([fetchYahooQuote(), fetchXausQuote()]);
  const data = buildData(yahooQuote, xausQuote);

  if (!data.ratio) {
    if (cache) {
      const staleData = { ...cache.data, stale: true };
      cache = { data: staleData, expiresAt: now + SHORT_CACHE_MS };
      return NextResponse.json(
        { success: true, data: staleData },
        { headers: cacheHeadersFor(SHORT_CACHE_MS) },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Gold and silver quotes are unavailable right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ttl = cacheTtlFor(data);
  cache = { data, expiresAt: now + ttl };
  return NextResponse.json(
    { success: true, data },
    { headers: cacheHeadersFor(ttl) },
  );
}
