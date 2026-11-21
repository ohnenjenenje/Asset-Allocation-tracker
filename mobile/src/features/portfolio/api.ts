import { ApiError, apiFetch } from '@/src/lib/api/client';

import { guessCurrency, normalizeExchangeAsset } from './normalize';
import type {
  Asset,
  FundAssetAllocation,
  FundData,
  FundHolding,
  FundMarketCapWeightage,
  FundSectorWeighting,
  Policy,
  PortfolioSnapshot,
  PriceData,
  ScreenerFilters,
  ScreenerStock,
} from './types';

interface RawSnapshotResponse {
  success: boolean;
  data?: PortfolioSnapshot;
  error?: string;
}

/** The API stores assets in rupees; normalize defensively at the boundary. */
function normalizeAsset(raw: Asset): Asset {
  return {
    ...raw,
    id: raw.id ?? `${raw.symbol}-${Math.random().toString(36).slice(2, 9)}`,
    symbol: raw.symbol ?? '',
    name: raw.name ?? raw.symbol ?? 'Untitled',
    quantity: Number(raw.quantity) || 0,
    entryPrice: Number(raw.entryPrice) || 0,
    currency: raw.currency ?? guessCurrency(raw.symbol ?? ''),
    // Keep the raw category: the form edits these values and the aggregation
    // layer is responsible for turning them into display labels.
    type: raw.type ?? 'STOCK',
    subItems: Array.isArray(raw.subItems) ? raw.subItems.map(normalizeAsset) : undefined,
  };
}

/**
 * Fetches the signed-in user's portfolio.
 *
 * Returns `null` when the user has no server document yet (HTTP 404) so the UI
 * can show an empty state rather than an error.
 */
export async function fetchSnapshot(
  uid: string,
  options: { signal?: AbortSignal; token?: string | null } = {},
): Promise<PortfolioSnapshot | null> {
  try {
    const response = await apiFetch<RawSnapshotResponse>(
      `/api/sync?uid=${encodeURIComponent(uid)}`,
      {
        signal: options.signal,
        token: options.token,
        // The free Render backend may need to boot after idling. A longer
        // timeout lets the first request finish instead of aborting and
        // starting over.
        timeoutMs: 45_000,
      },
    );
    if (!response.success || !response.data) {
      throw new ApiError(response.error ?? 'Malformed portfolio response', 500);
    }
    const snapshot = response.data;
    return {
      ...snapshot,
      assets: (snapshot.assets ?? []).map(normalizeAsset),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export interface SavePortfolioInput {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  assets: Asset[];
  token?: string | null;
}

export async function savePortfolio(input: SavePortfolioInput): Promise<void> {
  const { uid, email, displayName, assets, token } = input;
  await apiFetch<{ success: boolean }>('/api/sync', {
    method: 'POST',
    token,
    body: {
      uid,
      email,
      displayName,
      data: {
        assets,
        // The backend blocks saving an empty array unless this flag is set.
        ...(assets.length === 0 ? { forceClear: true } : {}),
      },
    },
  });
}

export interface SavePolicyInput {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  policy: Policy;
  history: Policy[];
  token?: string | null;
}

/**
 * Persist a confirmed policy. Targets are dual-written to
 * `settings.idealAllocation` because that remains the web app's source of truth;
 * the sync route merges settings keys instead of replacing the object.
 */
export async function savePolicy(input: SavePolicyInput): Promise<void> {
  const { uid, email, displayName, policy, history, token } = input;
  await apiFetch<{ success: boolean }>('/api/sync', {
    method: 'POST',
    token,
    body: {
      uid,
      email,
      displayName,
      data: {
        policy,
        policyHistory: history,
        settings: { idealAllocation: policy.targets },
      },
    },
  });
}

interface RawQuote {
  symbol?: string;
  regularMarketPrice?: number | null;
  currency?: string | null;
  shortName?: string | null;
  marketCap?: number | null;
  quoteType?: string | null;
  sector?: string | null;
  source?: string | null;
  lastUpdated?: number;
  asOf?: number | null;
  stale?: boolean;
}

function normalizeQuote(raw: RawQuote): PriceData | null {
  if (!raw.symbol || raw.regularMarketPrice == null) return null;
  return {
    symbol: raw.symbol,
    regularMarketPrice: Number(raw.regularMarketPrice),
    currency: raw.currency ?? guessCurrency(raw.symbol),
    shortName: raw.shortName ?? raw.symbol,
    marketCap: raw.marketCap ?? null,
    quoteType: raw.quoteType ?? null,
    sector: raw.sector ?? null,
    source: raw.source ?? null,
    lastUpdated: raw.lastUpdated,
    asOf: typeof raw.asOf === 'number' ? raw.asOf : null,
    stale: Boolean(raw.stale),
  };
}

/**
 * Batch quote lookup. The backend already coalesces multiple providers, so a
 * single request for every symbol is both faster and kinder to rate limits.
 */
export async function fetchPrices(
  symbols: readonly string[],
  options: {
    /** Ask the backend to write the fetched quotes back to Google Sheets. */
    sync?: boolean;
    signal?: AbortSignal;
    token?: string | null;
  } = {},
): Promise<Record<string, PriceData>> {
  const unique = [...new Set(symbols.filter(Boolean))];
  if (unique.length === 0) return {};

  const query = new URLSearchParams({ symbols: unique.join(',') });
  if (options.sync) query.set('sync', 'true');

  const response = await apiFetch<RawQuote[]>(`/api/price?${query.toString()}`, {
    signal: options.signal,
    token: options.token,
    timeoutMs: 30_000,
  });

  const quotes: Record<string, PriceData> = {};
  for (const raw of Array.isArray(response) ? response : []) {
    const quote = normalizeQuote(raw);
    if (quote) quotes[quote.symbol] = quote;
  }
  return quotes;
}

interface RawExchangeAsset {
  symbol?: string;
  name?: string;
  quantity?: number;
  type?: string;
  currency?: string;
  currentPrice?: number;
  entryPrice?: number;
  exchange?: string;
}

/**
 * Fetch live exchange balances. These endpoints use server-side API keys, so
 * the mobile app only needs the auth token. A failure is non-fatal: callers
 * fall back to the cached snapshot and show its age.
 */
export async function fetchExchangeBalances(
  exchange: 'binance' | 'coindcx',
  options: { signal?: AbortSignal; token?: string | null } = {},
): Promise<Asset[]> {
  const label = exchange === 'binance' ? 'Binance' : 'CoinDCX';
  const response = await apiFetch<RawExchangeAsset[] | { error?: string }>(
    `/api/crypto/${exchange}`,
    {
      signal: options.signal,
      token: options.token,
      // Binance often needs to load its market catalogue before responding.
      timeoutMs: 60_000,
    },
  );

  if (!Array.isArray(response)) {
    // CoinDCX answers with HTTP 200 and an `{ error }` envelope for expired
    // keys, so a malformed payload has to carry the server's explanation.
    const message =
      response && typeof response.error === 'string' && response.error.trim()
        ? response.error.trim()
        : `${label} returned an unexpected response`;
    throw new ApiError(message, 502);
  }

  return response.map((raw) =>
    normalizeExchangeAsset(
      {
        ...raw,
        id: `${exchange}-${String(raw.symbol ?? raw.name ?? '').toUpperCase()}`,
        name: raw.name ?? raw.symbol ?? 'Unknown',
        entryPrice: Number(raw.entryPrice) || 0,
        currency: raw.currency ?? 'USD',
        type: raw.type ?? 'CRYPTO',
      } as Asset & { currentPrice?: number },
      label,
    ),
  );
}

interface RawFundData {
  symbol?: string;
  source?: string | null;
  categoryName?: string | null;
  holdings?: {
    symbol?: string;
    holdingName?: string;
    holdingPercent?: number | string | null;
  }[];
  sectorWeightings?: { sector?: string; percentage?: number | string | null }[];
  assetAllocation?: {
    stockPosition?: number | string | null;
    bondPosition?: number | string | null;
    cashPosition?: number | string | null;
    otherPosition?: number | string | null;
    preferredPosition?: number | string | null;
    convertiblePosition?: number | string | null;
  } | null;
  marketCapWeightage?: {
    largeCap?: number | string | null;
    midCap?: number | string | null;
    smallCap?: number | string | null;
    others?: number | string | null;
  } | null;
  lookthrough?: string | null;
  note?: string | null;
  debug?: string;
  error?: string;
}

const numeric = (value: number | string | null | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function normalizeFundData(raw: RawFundData, fallbackSymbol: string): FundData {
  const holdings: FundHolding[] = (raw.holdings ?? [])
    .map((holding) => ({
      symbol: holding.symbol ?? '',
      holdingName: holding.holdingName ?? holding.symbol ?? 'Unknown holding',
      holdingPercent: numeric(holding.holdingPercent),
    }))
    .filter((holding) => holding.holdingPercent > 0);

  const sectorWeightings: FundSectorWeighting[] = (raw.sectorWeightings ?? [])
    .map((sector) => ({
      sector: sector.sector ?? 'Other',
      percentage: numeric(sector.percentage),
    }))
    .filter((sector) => sector.percentage > 0);

  const allocation = raw.assetAllocation;
  const assetAllocation: FundAssetAllocation | null = allocation
    ? {
        stockPosition: numeric(allocation.stockPosition),
        bondPosition: numeric(allocation.bondPosition),
        cashPosition: numeric(allocation.cashPosition),
        otherPosition: numeric(allocation.otherPosition),
        preferredPosition: numeric(allocation.preferredPosition),
        convertiblePosition: numeric(allocation.convertiblePosition),
      }
    : null;

  const weightage = raw.marketCapWeightage;
  const marketCapWeightage: FundMarketCapWeightage | null = weightage
    ? {
        largeCap: numeric(weightage.largeCap),
        midCap: numeric(weightage.midCap),
        smallCap: numeric(weightage.smallCap),
        others: numeric(weightage.others),
      }
    : null;

  return {
    symbol: raw.symbol ?? fallbackSymbol,
    source: raw.source ?? null,
    categoryName: raw.categoryName ?? null,
    holdings,
    sectorWeightings,
    assetAllocation,
    marketCapWeightage,
    lookthrough: raw.lookthrough ?? null,
    note: raw.note ?? null,
    debug: raw.debug,
  };
}

/**
 * Look-through holdings for a mutual fund or ETF. The backend resolves scheme
 * codes and falls back to Yahoo Finance, so callers only need a symbol (and a
 * name helps the fallback search).
 */
export async function fetchFundData(
  symbol: string,
  name?: string,
  options: { signal?: AbortSignal; token?: string | null } = {},
): Promise<FundData> {
  const query = new URLSearchParams({ symbol });
  if (name) query.set('name', name);

  const response = await apiFetch<RawFundData>(`/api/holdings?${query.toString()}`, {
    signal: options.signal,
    token: options.token,
    timeoutMs: 30_000,
  });

  if (response.error) throw new ApiError(response.error, 502);
  return normalizeFundData(response, symbol);
}

interface RawScreenerResult {
  sid?: string;
  stock?: {
    ticker?: string;
    name?: string;
    sector?: string;
    info?: { ticker?: string; name?: string; sector?: string };
    advancedRatios?: {
      marketCap?: number;
      peRatio?: number;
      pbRatio?: number;
      divYield?: number;
    };
  };
  ticker?: string;
  name?: string;
  sector?: string;
  marketCap?: number;
  peRatio?: number;
  pbRatio?: number;
  divYield?: number;
}

interface RawScreenerResponse {
  data?: { results?: RawScreenerResult[] };
  error?: string;
}

/** Market cap is reported in millions of INR by Tickertape. */
const capInMillions = (value?: number) => (typeof value === 'number' ? value : undefined);

export async function fetchScreener(
  filters: ScreenerFilters,
  options: { signal?: AbortSignal; token?: string | null } = {},
): Promise<ScreenerStock[]> {
  const response = await apiFetch<RawScreenerResponse>('/api/screener', {
    method: 'POST',
    signal: options.signal,
    token: options.token,
    timeoutMs: 30_000,
    body: {
      filters: filters.filters,
      sort: filters.sort,
      order: filters.order,
      limit: filters.limit,
    },
  });

  if (response.error) throw new ApiError(response.error, 502);

  return (response.data?.results ?? []).map((result) => {
    const info = result.stock?.info;
    const ratios = result.stock?.advancedRatios;
    return {
      sid: result.sid ?? `${info?.ticker ?? 'N'}-${Math.random().toString(36).slice(2, 8)}`,
      ticker: info?.ticker ?? result.stock?.ticker ?? result.ticker ?? '—',
      name: info?.name ?? result.stock?.name ?? result.name ?? 'Unknown company',
      sector: info?.sector ?? result.stock?.sector ?? result.sector ?? 'Other',
      marketCap: capInMillions(ratios?.marketCap ?? result.marketCap),
      peRatio: ratios?.peRatio ?? result.peRatio,
      pbRatio: ratios?.pbRatio ?? result.pbRatio,
      divYield: ratios?.divYield ?? result.divYield,
    };
  });
}
