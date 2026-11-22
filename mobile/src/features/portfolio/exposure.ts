import { toPaise } from '@/src/lib/format/money';

import { flattenAssets, priceFor } from './aggregate';
import { normalizeCategory, resolveAssetCurrency, toINR } from './normalize';
import type { Asset, LiquidityTier, PriceData } from './types';

/** Exposure lenses that sit beside the asset-class tree, never inside it. */
export interface ExposureBucket {
  key: string;
  value: number;
  percentage: number;
}

export interface HoldingExposure {
  id: string;
  name: string;
  symbol: string;
  value: number;
  percentage: number;
  currency: string;
  liquidity: LiquidityTier;
  account: string;
  category: string;
}

const LIQUID_TIERS = new Set<LiquidityTier>(['Daily', 'Weekly']);

export function currencyFor(asset: Asset, prices: Record<string, PriceData>): string {
  const fallback = resolveAssetCurrency(asset);
  if (asset.manualPrice != null) return fallback;
  const quote = prices[asset.symbol];
  let currency = quote?.currency || fallback;
  if (asset.symbol.includes('-USD') && currency === 'INR') currency = 'USD';
  if (currency === 'GBP') currency = 'GBp';
  return currency;
}

/**
 * Liquidity policy uses four tiers. Manual overrides win, then instrument type
 * drives a conservative default: daily for exchange-traded and cash, weekly for
 * open-ended funds and physical commodities, monthly for everything unclear.
 */
export function liquidityFor(asset: Asset): LiquidityTier {
  if (asset.manualLiquidity) return asset.manualLiquidity;
  const type = (asset.type || '').toUpperCase();
  if (type === 'CASH') return 'Daily';
  if (type === 'STOCK' || type === 'ETF' || type === 'CRYPTO') return 'Daily';
  if (type === 'MUTUALFUND' || type === 'DEBT') return 'Weekly';
  if (type === 'GOLD' || type === 'SILVER') return 'Weekly';
  return 'Monthly';
}

export function accountFor(asset: Asset): string {
  return asset.account?.trim() || 'Primary';
}

export function holdingExposure(
  assets: Asset[],
  prices: Record<string, PriceData>,
  usdToInr: number,
): HoldingExposure[] {
  const flat = flattenAssets(assets);
  const rows: HoldingExposure[] = [];
  let total = 0;

  for (const asset of flat) {
    const currency = currencyFor(asset, prices);
    const value =
      toPaise(toINR(priceFor(asset, prices), currency, usdToInr) * asset.quantity);
    if (!Number.isFinite(value) || value <= 0) continue;
    total += value;
    rows.push({
      id: asset.id,
      name: asset.name,
      symbol: asset.symbol,
      value,
      percentage: 0,
      currency,
      liquidity: liquidityFor(asset),
      account: accountFor(asset),
      category: normalizeCategory(asset.categoryPath?.[0] ?? asset.type),
    });
  }

  return rows
    .map((row) => ({
      ...row,
      percentage: total > 0 ? (row.value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export function bucketBy(
  holdings: HoldingExposure[],
  keyOf: (holding: HoldingExposure) => string,
): ExposureBucket[] {
  const buckets = new Map<string, number>();
  let total = 0;
  for (const holding of holdings) {
    const key = keyOf(holding);
    buckets.set(key, (buckets.get(key) ?? 0) + holding.value);
    total += holding.value;
  }
  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      value,
      percentage: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export function currencyExposure(
  holdings: HoldingExposure[],
): ExposureBucket[] {
  return bucketBy(holdings, (holding) => holding.currency);
}

export function liquidityExposure(
  holdings: HoldingExposure[],
): ExposureBucket[] {
  return bucketBy(holdings, (holding) => holding.liquidity);
}

export function accountExposure(
  holdings: HoldingExposure[],
): ExposureBucket[] {
  return bucketBy(holdings, (holding) => holding.account);
}

export function liquidPercentage(holdings: HoldingExposure[]): number {
  let total = 0;
  let liquid = 0;
  for (const holding of holdings) {
    total += holding.value;
    if (LIQUID_TIERS.has(holding.liquidity)) liquid += holding.value;
  }
  return total > 0 ? (liquid / total) * 100 : 0;
}

export function topHoldingConcentration(
  holdings: HoldingExposure[],
): HoldingExposure | null {
  return holdings[0] ?? null;
}
