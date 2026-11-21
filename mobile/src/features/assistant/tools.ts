import { apiFetch } from '@/src/lib/api/client';

import type { PortfolioSummary } from '../portfolio/aggregate';
import type { PortfolioAnalytics } from '../portfolio/analytics';
import { fetchFundData, fetchPrices } from '../portfolio/api';
import type { Asset, FundData, PriceData } from '../portfolio/types';

export interface AssistantContext {
  summary: PortfolioSummary;
  analytics: PortfolioAnalytics;
  prices: Record<string, PriceData>;
  fundHoldings: Record<string, FundData>;
  /** Saved holdings, used to resolve and apply screenshot updates. */
  assets: Asset[];
}

export const TOOL_LABELS: Record<string, string> = {
  get_portfolio_summary: 'Reading your portfolio',
  get_exposure_summary: 'Calculating your exposure',
  search_asset: 'Searching the market',
  get_quote: 'Fetching the latest price',
  get_fund_holdings: 'Looking inside the fund',
  propose_asset_updates: 'Preparing your changes',
};

export type AssetChangeField = 'quantity' | 'entryPrice' | 'manualPrice';

export type AssetChange = {
  field: AssetChangeField;
  /** Current value, or null when the asset has no manual price yet. */
  from: number | null;
  to: number;
};

export type AssetUpdate = {
  assetId: string;
  symbol: string;
  name: string;
  currency: string;
  changes: AssetChange[];
};

export type AssetUpdateProposal = {
  id: string;
  summary: string;
  createdAt: number;
  updates: AssetUpdate[];
};

const CHANGE_ORDER: readonly AssetChangeField[] = [
  'quantity',
  'entryPrice',
  'manualPrice',
];

const MAX_FIELD_VALUE = 1e12;

const roundQuantity = (value: number): number => Math.round(value * 1e8) / 1e8;
const roundPrice = (value: number): number => Math.round(value * 1e6) / 1e6;

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();

// Product-name filler that should not decide which holding a screenshot row
// belongs to. Field labels such as "Value" or "Savings" stay in the token set
// so a row like "Silver Value" cannot match a silver holding by itself.
const GENERIC_MATCH_TOKENS = new Set([
  'account',
  'amount',
  'asset',
  'assets',
  'average',
  'avg',
  'balance',
  'bo',
  'buy',
  'company',
  'corp',
  'corporation',
  'eur',
  'gbp',
  'gram',
  'grams',
  'inc',
  'inr',
  'investment',
  'limited',
  'ltd',
  'market',
  'ns',
  'per',
  'physical',
  'plc',
  'portfolio',
  'price',
  'quantity',
  'the',
  'unit',
  'units',
  'usd',
  'vault',
  'wallet',
  'weight',
]);

function distinctiveTokens(value: string): string[] {
  return normalizeKey(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_MATCH_TOKENS.has(token));
}

function numericArg(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function findAsset(item: any, assets: Asset[]): Asset | null {
  const id = typeof item?.assetId === 'string' ? item.assetId.trim() : '';
  if (id) {
    const match = assets.find((asset) => asset.id === id);
    if (match) return match;
  }

  const symbol = typeof item?.symbol === 'string' ? item.symbol.trim().toUpperCase() : '';
  const name = typeof item?.name === 'string' ? item.name.trim() : '';

  if (symbol) {
    const exact = assets.filter((asset) => asset.symbol.toUpperCase() === symbol);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    // "HDFCBANK" in a screenshot should match "HDFCBANK.NS" in the portfolio.
    const bare = symbol.replace(/\.(NS|BO|L)$/i, '');
    const bareMatches = assets.filter(
      (asset) => asset.symbol.toUpperCase().replace(/\.(NS|BO|L)$/i, '') === bare,
    );
    if (bareMatches.length === 1) return bareMatches[0];
    if (bareMatches.length > 1) return null;
  }

  if (name) {
    const normalized = normalizeKey(name);
    const exactName = assets.filter((asset) => normalizeKey(asset.name) === normalized);
    if (exactName.length === 1) return exactName[0];
    if (exactName.length > 1) return null;
  }

  const query = normalizeKey(name || symbol);
  if (query.length >= 4) {
    const partial = assets.filter((asset) => {
      const assetName = normalizeKey(asset.name);
      return assetName.includes(query) || normalizeKey(asset.symbol).includes(query);
    });
    if (partial.length === 1) return partial[0];
  }

  // Screenshot titles are often product names rather than tickers: a
  // "Silver Vault" detail screen belongs to "Physical Silver (Per Gram)".
  // Match on all remaining distinctive words, but only when exactly one
  // holding contains them. Ambiguous matches stay unmatched on purpose.
  const tokens = new Set(distinctiveTokens(name || symbol));
  if (tokens.size > 0 && numericArg(item?.quantity) != null) {
    const tokenMatches = assets.filter((asset) => {
      const candidateTokens = new Set([
        ...distinctiveTokens(asset.name),
        ...distinctiveTokens(asset.symbol),
      ]);
      return [...tokens].every((token) => candidateTokens.has(token));
    });
    if (tokenMatches.length === 1) return tokenMatches[0];
  }

  return null;
}

/**
 * Turn model output into a canonical proposal against the saved portfolio.
 * Only existing assets and the three editable position fields are accepted.
 */
export function buildAssetProposal(
  raw: any,
  assets: Asset[],
): { proposal: AssetUpdateProposal } | { error: string } {
  const rawUpdates = Array.isArray(raw?.updates) ? raw.updates.slice(0, 50) : [];
  if (rawUpdates.length === 0) {
    return { error: 'No changes were provided.' };
  }

  const summary =
    typeof raw?.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim().slice(0, 300)
      : 'Screenshot changes';

  const merged = new Map<string, AssetUpdate>();

  for (const item of rawUpdates) {
    if (!item || typeof item !== 'object') continue;
    const asset = findAsset(item, assets);
    if (!asset) continue;

    const existing = merged.get(asset.id);
    const changes = new Map<AssetChangeField, AssetChange>(
      existing?.changes.map((change) => [change.field, change]) ?? [],
    );

    const quantity = numericArg(item.quantity);
    if (
      quantity != null &&
      quantity > 0 &&
      quantity <= MAX_FIELD_VALUE &&
      Math.abs(quantity - asset.quantity) > 1e-9
    ) {
      changes.set('quantity', {
        field: 'quantity',
        from: asset.quantity,
        to: roundQuantity(quantity),
      });
    }

    const entryPrice = numericArg(item.entryPrice);
    if (
      entryPrice != null &&
      entryPrice >= 0 &&
      entryPrice <= MAX_FIELD_VALUE &&
      Math.abs(entryPrice - asset.entryPrice) > 1e-9
    ) {
      changes.set('entryPrice', {
        field: 'entryPrice',
        from: asset.entryPrice,
        to: roundPrice(entryPrice),
      });
    }

    const manualPrice = numericArg(item.manualPrice);
    if (
      manualPrice != null &&
      manualPrice > 0 &&
      manualPrice <= MAX_FIELD_VALUE &&
      Math.abs(manualPrice - Number(asset.manualPrice ?? 0)) > 1e-9
    ) {
      changes.set('manualPrice', {
        field: 'manualPrice',
        from:
          typeof asset.manualPrice === 'number' && Number.isFinite(asset.manualPrice)
            ? asset.manualPrice
            : null,
        to: roundPrice(manualPrice),
      });
    }

    const ordered = CHANGE_ORDER.flatMap((field) => {
      const change = changes.get(field);
      return change ? [change] : [];
    });

    if (ordered.length > 0) {
      merged.set(asset.id, {
        assetId: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        currency: asset.currency || 'INR',
        changes: ordered,
      });
    }
  }

  if (merged.size === 0) {
    return { error: 'None of the screenshot rows matched an existing holding, or no value changed.' };
  }

  return {
    proposal: {
      id: `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      summary,
      createdAt: Date.now(),
      updates: [...merged.values()],
    },
  };
}

/** Fold several tool calls from one turn into a single confirmation card. */
export function mergeAssetProposals(
  proposals: AssetUpdateProposal[],
): AssetUpdateProposal | null {
  if (proposals.length === 0) return null;
  if (proposals.length === 1) return proposals[0];

  const merged = new Map<string, AssetUpdate>();
  for (const proposal of proposals) {
    for (const update of proposal.updates) {
      const existing = merged.get(update.assetId);
      if (!existing) {
        merged.set(update.assetId, { ...update, changes: [...update.changes] });
        continue;
      }
      const changes = new Map<AssetChangeField, AssetChange>(
        existing.changes.map((change) => [change.field, change]),
      );
      for (const change of update.changes) changes.set(change.field, change);
      existing.changes = CHANGE_ORDER.flatMap((field) => {
        const change = changes.get(field);
        return change ? [change] : [];
      });
    }
  }

  return {
    id: proposals[proposals.length - 1].id,
    summary: proposals[0].summary,
    createdAt: proposals[0].createdAt,
    updates: [...merged.values()],
  };
}

/** Apply a confirmed proposal to a saved asset list without mutating it. */
export function applyAssetProposal(
  assets: Asset[],
  proposal: AssetUpdateProposal,
): Asset[] {
  const byAsset = new Map(proposal.updates.map((update) => [update.assetId, update]));

  return assets.map((asset) => {
    const update = byAsset.get(asset.id);
    if (!update) return asset;

    const next: Asset = { ...asset };
    for (const change of update.changes) {
      if (change.field === 'quantity') next.quantity = change.to;
      else if (change.field === 'entryPrice') next.entryPrice = change.to;
      else next.manualPrice = change.to;
    }
    return next;
  });
}

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
};

const percentOf = (value: number, total: number): number =>
  total > 0 ? round((value / total) * 100) : 0;

// Mobile aggregates store money in paise; the model works in rupees.
const rupees = (paise: number): number => Math.round(paise / 100);

function portfolioSummary(context: AssistantContext) {
  const { summary } = context;
  return {
    totalValue: rupees(summary.currentValue),
    investedValue: rupees(summary.investedValue),
    profitLoss: rupees(summary.pnl),
    profitLossPercent: round(summary.pnlPercent),
    assetCount: summary.assetCount,
    allocation: summary.allocation.map((slice) => ({
      category: slice.label,
      value: rupees(slice.value),
      percent: round(slice.percent),
    })),
    holdings: summary.holdings.slice(0, 60).map((holding) => ({
      id: holding.asset.id,
      symbol: holding.asset.symbol,
      name: holding.asset.name,
      type: holding.category,
      value: rupees(holding.currentValue),
      weightPercent: percentOf(holding.currentValue, summary.currentValue),
      pnlPercent: round(holding.pnlPercent),
      livePrice: holding.hasLivePrice,
      quantity: holding.asset.quantity,
      entryPrice: holding.asset.entryPrice,
      manualPrice: holding.asset.manualPrice ?? null,
      currency: holding.asset.currency,
    })),
  };
}

function exposureSummary(context: AssistantContext) {
  const { analytics } = context;
  const total = analytics.totals.portfolio;
  return {
    totalPortfolioValue: rupees(total),
    equityValue: rupees(analytics.totals.equity),
    fundValue: rupees(analytics.totals.fund),
    fundCoverage: analytics.fundCoverage,
    sectors: analytics.sectors.slice(0, 15).map((sector) => ({
      sector: sector.name,
      value: rupees(sector.value),
      percentOfPortfolio: percentOf(sector.value, total),
    })),
    marketCap: analytics.marketCap.map((bucket) => ({
      bucket: bucket.name,
      value: rupees(bucket.value),
      percentOfPortfolio: percentOf(bucket.value, total),
    })),
    topUnderlying: analytics.underlying.slice(0, 15).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      value: rupees(item.value),
      type: item.type,
    })),
  };
}

async function searchAsset(query: string, token?: string | null) {
  const search = new URLSearchParams({ q: query, source: 'yahoo' });
  const results = await apiFetch<any[]>(`/api/search?${search.toString()}`, {
    token,
    timeoutMs: 30_000,
  });

  return (Array.isArray(results) ? results : []).slice(0, 6).map((item) => ({
    symbol: item.symbol,
    name: item.longname || item.shortname || item.symbol,
    type: item.quoteType || 'UNKNOWN',
    source: item.source || 'Yahoo Finance',
  }));
}

async function quote(symbol: string, token?: string | null) {
  // Reads are live by default and never write to the sheet; `sync=true` is the
  // only mutating mode, and the assistant never asks for it.
  const quotes = await fetchPrices([symbol], { token });
  const quoteData = quotes[symbol];
  if (!quoteData) {
    return { error: `No live quote found for ${symbol}. Check the ticker and try again.` };
  }
  return {
    symbol: quoteData.symbol,
    price: quoteData.regularMarketPrice,
    currency: quoteData.currency,
    name: quoteData.shortName,
    source: quoteData.source,
    asOf: quoteData.asOf ?? null,
    stale: Boolean(quoteData.stale),
    lastUpdated: quoteData.lastUpdated,
  };
}

async function fundHoldings(
  symbol: string,
  name: string | undefined,
  token?: string | null,
) {
  const data = await fetchFundData(symbol, name, { token });
  const holdings = data.holdings ?? [];
  const total = holdings.reduce((sum, holding) => sum + (holding.holdingPercent || 0), 0);
  // Providers either send fractions (0.08) or percentages (8); normalize to %.
  const scale = total > 1.5 ? 1 : 100;

  return {
    symbol,
    source: data.source,
    category: data.categoryName,
    lookthrough: data.lookthrough ?? null,
    note: data.note ?? null,
    holdings: holdings.slice(0, 20).map((holding) => ({
      name: holding.holdingName,
      symbol: holding.symbol,
      percent: round((holding.holdingPercent || 0) * scale),
    })),
    sectors: (data.sectorWeightings ?? []).slice(0, 10).map((sector) => ({
      sector: sector.sector,
      percent: round(sector.percentage),
    })),
    assetAllocation: data.assetAllocation ?? null,
  };
}

/**
 * Runs one model-requested tool against the screen's already-loaded portfolio
 * data and public API clients. Always returns a JSON string because that is
 * what the model receives as the tool result.
 */
export async function executeAssistantTool(
  name: string,
  rawArguments: string,
  context: AssistantContext,
  options: {
    token?: string | null;
    onProposal?: (proposal: AssetUpdateProposal) => void;
  } = {},
): Promise<string> {
  let args: any = {};
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    args = {};
  }

  try {
    switch (name) {
      case 'get_portfolio_summary':
        return JSON.stringify(portfolioSummary(context));
      case 'get_exposure_summary':
        return JSON.stringify(exposureSummary(context));
      case 'search_asset': {
        const query = String(args.query || '').trim();
        if (!query) return JSON.stringify({ error: 'A search query is required.' });
        return JSON.stringify({ results: await searchAsset(query, options.token) });
      }
      case 'get_quote': {
        const symbol = String(args.symbol || '').trim();
        if (!symbol) return JSON.stringify({ error: 'A symbol is required.' });
        return JSON.stringify(await quote(symbol, options.token));
      }
      case 'get_fund_holdings': {
        const symbol = String(args.symbol || '').trim();
        if (!symbol) return JSON.stringify({ error: 'A fund or ETF symbol is required.' });
        const fundName = typeof args.name === 'string' ? args.name : undefined;
        return JSON.stringify(await fundHoldings(symbol, fundName, options.token));
      }
      case 'propose_asset_updates': {
        const built = buildAssetProposal(args, context.assets);
        if ('error' in built) return JSON.stringify({ error: built.error });
        options.onProposal?.(built.proposal);

        return JSON.stringify({
          status: 'pending_user_confirmation',
          proposalId: built.proposal.id,
          summary: built.proposal.summary,
          changes: built.proposal.updates.map((update) => ({
            symbol: update.symbol,
            name: update.name,
            fields: update.changes.map(
              (change) => `${change.field}: ${change.from ?? 'none'} -> ${change.to}`,
            ),
          })),
          note: 'The app is showing a confirmation card. Nothing is saved until the user taps Apply. Summarize the changes briefly and ask them to confirm.',
        });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : 'The lookup failed.',
    });
  }
}
