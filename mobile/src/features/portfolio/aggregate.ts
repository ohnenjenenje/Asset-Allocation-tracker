import { toPaise } from '@/src/lib/format/money';

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
}

export interface PortfolioSummary {
  currentValue: number;
  investedValue: number;
  pnl: number;
  pnlPercent: number;
  assetCount: number;
  /** Holdings valued by a live quote or a manual price. */
  pricedCount: number;
  categories: number;
  allocation: AllocationSlice[];
  holdings: Holding[];
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

  return {
    currentValue,
    investedValue,
    pnl,
    pnlPercent: investedValue > 0 ? (pnl / investedValue) * 100 : 0,
    assetCount: holdings.length,
    pricedCount: holdings.filter((holding) => holding.hasLivePrice).length,
    categories: byCategory.size,
    allocation,
    holdings: sorted,
    topHoldings: sorted.slice(0, 5),
  };
}
