import { toPaise } from '@/src/lib/format/money';

import {
  cryptoBaseSymbol,
  cryptoDisplayName,
  cryptoSubtypeForAsset,
  hasKnownCostBasis,
  isCryptoAsset,
} from './crypto';
import { CATEGORY_COLORS, normalizeCategory, resolveAssetCurrency, toINR } from './normalize';
import type { Asset, PriceData } from './types';

export interface AllocationSlice {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
}

export interface Holding {
  asset: Asset;
  category: string;
  currentValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  hasLivePrice: boolean;
  /** Provider timestamp for the quote, when one was used. */
  quoteAsOf?: number | null;
  quoteSource?: string | null;
  /** True when the value came from a cache/fallback rather than a live quote. */
  quoteStale?: boolean;
  /** Stable key for a display position; crypto lots share one key per coin. */
  positionKey?: string;
  /** Number of underlying lots represented by this display position. */
  lotCount?: number;
  /** Present only on a consolidated crypto position. */
  lots?: Holding[];
  /** Weighted average cost in paise, from lots with a real cost basis. */
  averageCostPaise?: number | null;
  /** True when at least one lot has no reliable cost basis. */
  costBasisIncomplete?: boolean;
}

export interface PortfolioSummary {
  currentValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  /** Number of stored lots, including exchange balances. */
  assetCount: number;
  /** Number of display positions after consolidating crypto by coin. */
  positionCount: number;
  /** Holdings valued by a live quote or a manual price. */
  pricedCount: number;
  categories: number;
  allocation: AllocationSlice[];
  /** Individual lots; reports and tax-style views use these. */
  holdings: Holding[];
  /** Consolidated crypto positions plus non-crypto holdings. */
  positions: Holding[];
  topHoldings: Holding[];
}

export const DEFAULT_USD_TO_INR = 84;

/**
 * Portfolios created on the web can contain group nodes. Groups are containers
 * (their own quantity is usually zero), so valuation must happen on the leaves.
 */
export function flattenAssets(assets: Asset[]): Asset[] {
  return assets.flatMap((asset) =>
    asset.isGroup && asset.subItems && asset.subItems.length > 0
      ? flattenAssets(asset.subItems)
      : [asset],
  );
}

export function priceFor(asset: Asset, prices: Record<string, PriceData>): number {
  if (asset.manualPrice !== undefined && asset.manualPrice !== null) {
    return asset.manualPrice;
  }
  const quote = prices[asset.symbol];
  if (quote?.regularMarketPrice != null) return quote.regularMarketPrice;
  return asset.entryPrice;
}

function hasLivePrice(asset: Asset, prices: Record<string, PriceData>): boolean {
  if (asset.manualPrice !== undefined && asset.manualPrice !== null) return true;
  return prices[asset.symbol]?.regularMarketPrice != null;
}

function cryptoPositionKeyFor(asset: Asset): string {
  const base = cryptoBaseSymbol(asset.symbol) || asset.symbol.trim().toUpperCase();
  return `crypto:${base}`;
}

function enrichSingleHolding(holding: Holding): Holding {
  const crypto = isCryptoAsset(holding.asset);
  const known = hasKnownCostBasis(holding.asset);
  const quantity = holding.asset.quantity;
  const base = crypto ? cryptoBaseSymbol(holding.asset.symbol) : '';
  const asset =
    crypto && base
      ? {
          ...holding.asset,
          name: cryptoDisplayName(base, holding.asset.name),
          symbol: base,
        }
      : holding.asset;
  return {
    ...holding,
    asset,
    positionKey: crypto
      ? cryptoPositionKeyFor(holding.asset)
      : `asset:${holding.asset.id}`,
    lotCount: 1,
    averageCostPaise:
      known && quantity > 0 ? holding.investedValue / quantity : null,
    costBasisIncomplete: !known,
  };
}

/**
 * One exposure line per coin, with every venue balance kept as a child lot.
 * This mirrors institutional portfolio systems: aggregate the position for
 * exposure, but never destroy the lot-level cost basis.
 */
function consolidateCryptoLots(lots: Holding[]): Holding {
  const first = lots[0];
  const base =
    cryptoBaseSymbol(first.asset.symbol) || first.asset.symbol.trim().toUpperCase();
  const quantity = lots.reduce((sum, lot) => sum + lot.asset.quantity, 0);
  const currentValue = lots.reduce((sum, lot) => sum + lot.currentValue, 0);
  const investedValue = lots.reduce((sum, lot) => sum + lot.investedValue, 0);
  const pnl = currentValue - investedValue;
  const knownLots = lots.filter(
    (lot) => hasKnownCostBasis(lot.asset) && lot.asset.quantity > 0,
  );
  const knownQuantity = knownLots.reduce(
    (sum, lot) => sum + lot.asset.quantity,
    0,
  );
  const knownInvested = knownLots.reduce(
    (sum, lot) => sum + lot.investedValue,
    0,
  );
  const averageCostPaise =
    knownQuantity > 0 ? knownInvested / knownQuantity : null;
  const subtype = cryptoSubtypeForAsset(first.asset) ?? undefined;
  const asset: Asset = {
    ...first.asset,
    id: `crypto-position-${base}`,
    name: cryptoDisplayName(base, first.asset.name),
    symbol: base,
    quantity,
    entryPrice:
      averageCostPaise != null
        ? averageCostPaise / 100
        : first.asset.entryPrice,
    currency: 'INR',
    type: 'CRYPTO',
    categoryPath: subtype ? ['Crypto', subtype] : ['Crypto'],
    isGroup: true,
    subItems: lots.map((lot) => lot.asset),
    exchange: undefined,
    account: undefined,
    costBasisKnown: knownLots.length === lots.length,
  };

  return {
    asset,
    category: 'Crypto',
    currentValue,
    investedValue,
    pnl,
    pnlPercent: investedValue > 0 ? (pnl / investedValue) * 100 : 0,
    hasLivePrice: lots.some((lot) => lot.hasLivePrice),
    quoteAsOf: lots.find((lot) => lot.quoteAsOf != null)?.quoteAsOf ?? null,
    quoteSource: lots.find((lot) => lot.quoteSource)?.quoteSource ?? null,
    quoteStale: lots.some((lot) => lot.quoteStale),
    positionKey: `crypto:${base}`,
    lotCount: lots.length,
    lots,
    averageCostPaise,
    costBasisIncomplete: knownLots.length !== lots.length,
  };
}

/** Collapse crypto lots by coin while leaving every other asset untouched. */
function buildPositions(holdings: Holding[]): Holding[] {
  const groups = new Map<string, Holding[]>();
  for (const holding of holdings) {
    const key = isCryptoAsset(holding.asset)
      ? cryptoPositionKeyFor(holding.asset)
      : `asset:${holding.asset.id}`;
    const group = groups.get(key);
    if (group) group.push(holding);
    else groups.set(key, [holding]);
  }

  return [...groups.values()].map((group) =>
    group.length === 1
      ? enrichSingleHolding(group[0])
      : consolidateCryptoLots(group),
  );
}

/** Pure, memo-friendly derivation of every number the dashboard needs. */
export function summarize(
  assets: Asset[],
  prices: Record<string, PriceData> = {},
  usdToInr = DEFAULT_USD_TO_INR,
): PortfolioSummary {
  const holdings: Holding[] = flattenAssets(assets).map((asset) => {
    const assetCurrency = resolveAssetCurrency(asset);
    const quote = prices[asset.symbol];
    const priceCurrency =
      asset.manualPrice !== undefined
        ? assetCurrency
        : quote?.currency || assetCurrency;

    const currentPrice = toINR(priceFor(asset, prices), priceCurrency, usdToInr);
    const entryPrice = toINR(asset.entryPrice, assetCurrency, usdToInr);

    const currentValue = toPaise(currentPrice * asset.quantity);
    const investedValue = toPaise(entryPrice * asset.quantity);
    const pnl = currentValue - investedValue;
    const manual = asset.manualPrice !== undefined && asset.manualPrice !== null;

    return {
      asset,
      category: normalizeCategory(asset.type),
      currentValue,
      investedValue,
      pnl,
      pnlPercent: investedValue > 0 ? (pnl / investedValue) * 100 : 0,
      hasLivePrice: hasLivePrice(asset, prices),
      quoteAsOf: manual ? null : (quote?.asOf ?? null),
      quoteSource: manual ? 'Manual' : (quote?.source ?? null),
      quoteStale: manual ? false : Boolean(quote?.stale),
    };
  });

  const currentValue = holdings.reduce((sum, item) => sum + item.currentValue, 0);
  const investedValue = holdings.reduce((sum, item) => sum + item.investedValue, 0);
  const pnl = currentValue - investedValue;

  const byCategory = new Map<string, number>();
  for (const holding of holdings) {
    byCategory.set(holding.category, (byCategory.get(holding.category) ?? 0) + holding.currentValue);
  }

  const allocation: AllocationSlice[] = [...byCategory.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({
      key: label,
      label,
      value,
      percent: currentValue > 0 ? (value / currentValue) * 100 : 0,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));

  const sorted = [...holdings].sort((a, b) => b.currentValue - a.currentValue);
  const positions = buildPositions(holdings).sort(
    (a, b) => b.currentValue - a.currentValue,
  );

  return {
    currentValue,
    investedValue,
    pnl,
    pnlPercent: investedValue > 0 ? (pnl / investedValue) * 100 : 0,
    assetCount: holdings.length,
    positionCount: positions.length,
    pricedCount: holdings.filter((holding) => holding.hasLivePrice).length,
    categories: byCategory.size,
    allocation,
    holdings: sorted,
    positions,
    topHoldings: positions.slice(0, 5),
  };
}
