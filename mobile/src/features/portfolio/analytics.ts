import { toPaise } from '@/src/lib/format/money';

import { flattenAssets, priceFor } from './aggregate';
import {
  canonicalSectorLabel,
  getCapCategory,
  getCommoditySubCategory,
  isCommodityFund,
  isDebtFund,
  isDomesticEquity,
  isFundAsset,
  isGlobalFund,
  isLikelyEtf,
  isMarketCapCategory,
  normalizeCategory,
  normalizeGroup,
  normalizeSectorWeightings,
  resolveAssetCurrency,
  toINR,
} from './normalize';
import type {
  Asset,
  FundAssetAllocation,
  FundData,
  FundSectorWeighting,
  MarketCapCategory,
  PriceData,
} from './types';

export const DEFAULT_IDEAL_ALLOCATION: Record<string, number> = {
  Equities: 60,
  'Fixed Income': 20,
  Commodities: 5,
  Crypto: 5,
  Cash: 10,
};

export const CAP_ORDER = [
  'Large Cap',
  'Mid Cap',
  'Small Cap',
  'Diversified Equity',
  'Global Equity',
  'Other / Uncategorized',
];

export const CAP_COLORS: Record<string, string> = {
  'Large Cap': '#2563EB',
  'Mid Cap': '#059669',
  'Small Cap': '#7C3AED',
  'Diversified Equity': '#0EA5E9',
  'Global Equity': '#DB2777',
  'Other / Uncategorized': '#71717A',
  'Flexi Cap': '#D97706',
  'Multi Cap': '#DB2777',
  ELSS: '#0EA5E9',
};

export const SECTOR_PALETTE = [
  '#2563EB',
  '#0D9488',
  '#7C3AED',
  '#D97706',
  '#DB2777',
  '#0EA5E9',
  '#65A30D',
  '#64748B',
  '#F59E0B',
  '#10B981',
  '#6366F1',
  '#EC4899',
] as const;

export type EquityRegion = 'Domestic' | 'Global';

/** Value split between Indian and overseas equity, in paise. */
export interface RegionSplit {
  domestic: number;
  global: number;
}

/**
 * The internal cap key stays `Global Equity` so existing policy paths and
 * colours keep working. The Insights tab uses the institutional label below.
 */
export const GLOBAL_DIVERSIFIED_LABEL = 'Global – Diversified';

export function capDisplayLabel(cap: string): string {
  return cap === 'Global Equity' ? GLOBAL_DIVERSIFIED_LABEL : cap;
}

export const REGION_COLORS: Record<EquityRegion, string> = {
  Domestic: '#0EA5E9',
  Global: '#DB2777',
};

export interface ExposureConstituent {
  name: string;
  symbol: string;
  value: number;
  type: 'direct' | 'indirect';
  /** Geography tag for market-cap drill-downs. */
  region?: EquityRegion;
  subHoldings?: { name: string; value: number }[];
  otherAllocations?: { name: string; value: number }[];
}

export interface ExposureSlice {
  key: string;
  name: string;
  value: number;
  direct: number;
  indirect: number;
  /** Present on market-cap rows; sums to `value`. */
  regions?: RegionSplit;
  constituents: ExposureConstituent[];
}

export interface FundConstituent {
  name: string;
  symbol: string;
  value: number;
  subHoldings: { name: string; value: number }[];
  assetAllocation?: FundAssetAllocation | null;
  sectorWeightings?: FundSectorWeighting[];
}

export interface FundSlice {
  key: string;
  name: string;
  value: number;
  constituents: FundConstituent[];
}

export interface AllocationNode {
  category: string;
  fullPath: string;
  currentValue: number;
  currentPercentage: number;
  idealPercentage: number;
  diffPercentage: number;
  diffValue: number;
  constituents: { name: string; symbol: string; value: number }[];
  subCategories: AllocationNode[];
}

export interface UnderlyingExposure {
  symbol: string;
  name: string;
  value: number;
  type: string;
  marketCapCategory?: string;
}

export interface CapSectorRow {
  cap: string;
  total: number;
  /** Same Domestic/Global split as the matching market-cap row. */
  regions: RegionSplit;
  sectors: { sector: string; value: number }[];
}

export interface PortfolioAnalytics {
  marketCap: ExposureSlice[];
  sectors: ExposureSlice[];
  funds: FundSlice[];
  sectorByCap: Record<string, Record<string, number>>;
  capRows: CapSectorRow[];
  allSectors: string[];
  sectorColors: Record<string, string>;
  capColors: Record<string, string>;
  allocationAnalysis: AllocationNode[];
  underlying: UnderlyingExposure[];
  fundCoverage: { withData: number; total: number };
  totals: { portfolio: number; equity: number; fund: number };
}

const num = (value: number | null | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function addToRecord(record: Record<string, number>, key: string, value: number): void {
  record[key] = (record[key] ?? 0) + value;
}

/**
 * The web app has shipped several target-allocation schemas. Normalize old
 * keys before running the analysis so existing users keep their targets.
 */
export function normalizeIdealAllocation(
  input?: Record<string, number> | null,
): Record<string, number> {
  if (!input) return {};
  const out: Record<string, number> = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;

    switch (rawKey) {
      case 'Mutual Funds':
        addToRecord(out, 'Equities', Math.round(value * 0.7));
        addToRecord(out, 'Fixed Income', Math.round(value * 0.3));
        break;
      case 'Mutual Fund - Equity':
        addToRecord(out, 'Equities', value);
        break;
      case 'Mutual Fund - Debt':
      case 'Debt':
      case 'Debt and Fixed':
        addToRecord(out, 'Fixed Income', value);
        break;
      case 'Domestic Equity':
        addToRecord(out, 'Equities > Domestic Equity', value);
        break;
      case 'Global Equity':
        addToRecord(out, 'Equities > Global Equity', value);
        break;
      case 'Gold':
        addToRecord(out, 'Commodities > Gold', value);
        break;
      case 'Silver':
        addToRecord(out, 'Commodities > Silver', value);
        break;
      default:
        addToRecord(out, normalizeGroup(rawKey), value);
    }
  }

  return out;
}

function allocationTotal(allocation?: FundAssetAllocation | null): number {
  if (!allocation) return 0;
  return (
    num(allocation.stockPosition) +
    num(allocation.bondPosition) +
    num(allocation.cashPosition) +
    num(allocation.otherPosition) +
    num(allocation.preferredPosition) +
    num(allocation.convertiblePosition)
  );
}

function capWeights(data?: FundData | null) {
  const weightage = data?.marketCapWeightage;
  const large = num(weightage?.largeCap);
  const mid = num(weightage?.midCap);
  const small = num(weightage?.smallCap);
  const others = num(weightage?.others);
  return { large, mid, small, others, total: large + mid + small + others };
}

/** Size tag in the institutional two-tag model. */
export type EquitySize = MarketCapCategory | 'Diversified';

export interface EquityBucket {
  size: EquitySize;
  /** Share of the equity sleeve, 0..1. */
  weight: number;
  /** Disclosed holdings in this bucket, as fractions of fund value. */
  holdings?: { name: string; percent: number }[];
}

export interface AssetEquityProfile {
  region: EquityRegion;
  buckets: EquityBucket[];
}

/**
 * Market-cap rows stay size-first, so a global diversified fund needs a
 * descriptive key instead of an Indian size band. The key stays `Global Equity`
 * for policy/colour compatibility; `capDisplayLabel` renders the institutional
 * label in the UI.
 */
export function marketCapKey(region: EquityRegion, size: EquitySize): string {
  if (size !== 'Diversified') return size;
  return region === 'Global' ? 'Global Equity' : 'Diversified Equity';
}

/** Allocation paths are geography-first even though Insights is size-first. */
export function allocationPathFor(region: EquityRegion, size: EquitySize): string {
  const parent = region === 'Global' ? 'Equities > Global Equity' : 'Equities > Domestic Equity';
  return `${parent} > ${size}`;
}

/** Domestic means an Indian listing or an Indian fund mandate. */
function resolveAssetRegion(asset: Asset, data?: FundData | null): EquityRegion {
  if (isFundAsset(asset)) {
    return isGlobalFund(data?.categoryName, asset.name) ? 'Global' : 'Domestic';
  }
  return isDomesticEquity(asset) ? 'Domestic' : 'Global';
}

/** A single-cap mandate, or null when the fund name does not name one size. */
function resolveFundSize(asset: Asset, data?: FundData | null): MarketCapCategory | null {
  const category = getCapCategory(asset.name, data?.categoryName);
  return isMarketCapCategory(category) ? category : null;
}

/**
 * Normalize provider cap weights into size buckets. Provider "others" is
 * unclassified equity, not a separate asset class:
 *   - a single-cap mandate folds it into that size;
 *   - a global fund with no size mandate keeps it as Diversified;
 *   - a domestic flexi/multi-cap fund spreads it across reported sizes.
 * The result always sums to 100% of the equity sleeve.
 */
function resolveCapWeights(
  data: FundData | null | undefined,
  region: EquityRegion,
  mandate: MarketCapCategory | null,
): EquityBucket[] {
  const weights = capWeights(data);
  const knownTotal = weights.large + weights.mid + weights.small;
  const others = weights.others;

  if (knownTotal > 0) {
    const buckets: { size: EquitySize; raw: number }[] = (
      [
        ['Large Cap', weights.large],
        ['Mid Cap', weights.mid],
        ['Small Cap', weights.small],
      ] as const
    )
      .filter(([, raw]) => raw > 0)
      .map(([size, raw]) => ({ size, raw }));

    if (others > 0) {
      if (mandate) {
        const existing = buckets.find((bucket) => bucket.size === mandate);
        if (existing) existing.raw += others;
        else buckets.push({ size: mandate, raw: others });
      } else if (region === 'Global') {
        buckets.push({ size: 'Diversified', raw: others });
      }
      // Domestic without a mandate: leave `others` out of the numerator so it
      // is spread proportionally over the reported sizes.
    }

    const total = buckets.reduce((sum, bucket) => sum + bucket.raw, 0);
    return buckets.map((bucket) => ({ size: bucket.size, weight: bucket.raw / total }));
  }

  if (others > 0) {
    return [{ size: mandate ?? 'Diversified', weight: 1 }];
  }
  return [];
}

function holdingSize(
  holding: { symbol: string; holdingName: string },
  prices: Record<string, PriceData>,
  usdToInr: number,
): MarketCapCategory | null {
  const quote = prices[holding.symbol];
  if (isMarketCapCategory(quote?.capCategory)) return quote.capCategory;
  const band = marketCapBand(quote?.marketCap, quote?.currency || 'INR', usdToInr);
  if (band) return band;
  const nameCap = getCapCategory(holding.holdingName);
  return isMarketCapCategory(nameCap) ? nameCap : null;
}

function holdingPercent(
  holding: { holdingPercent: number },
  percentScale: boolean,
): number {
  const raw = num(holding.holdingPercent);
  return percentScale ? raw / 100 : raw;
}

/**
 * Classify disclosed holdings into size buckets. A sample covering less than
 * 5% of the fund is not a mandate; return null so the caller can fall back to
 * the fund's stated size instead of extrapolating from a tiny slice.
 */
function resolveHoldingsBuckets(
  data: FundData | null | undefined,
  prices: Record<string, PriceData>,
  usdToInr: number,
): EquityBucket[] | null {
  const holdings = data?.holdings ?? [];
  if (holdings.length === 0) return null;

  const percentScale = holdingPercentIsPercentScale(holdings);
  const groups = new Map<
    MarketCapCategory,
    { total: number; holdings: { name: string; percent: number }[] }
  >();
  let classified = 0;

  for (const holding of holdings) {
    const percent = holdingPercent(holding, percentScale);
    if (percent <= 0) continue;
    const size = holdingSize(holding, prices, usdToInr);
    if (!size) continue;

    classified += percent;
    const group = groups.get(size) ?? { total: 0, holdings: [] };
    group.total += percent;
    group.holdings.push({ name: holding.holdingName || holding.symbol, percent });
    groups.set(size, group);
  }

  if (classified < 0.05) return null;

  return [...groups.entries()].map(([size, group]) => ({
    size,
    weight: group.total / classified,
    holdings: group.holdings,
  }));
}

function allHoldings(data?: FundData | null): { name: string; percent: number }[] {
  const holdings = data?.holdings ?? [];
  const percentScale = holdingPercentIsPercentScale(holdings);
  return holdings
    .map((holding) => ({
      name: holding.holdingName || holding.symbol,
      percent: holdingPercent(holding, percentScale),
    }))
    .filter((holding) => holding.percent > 0);
}

/**
 * One classifier feeds the market-cap chart, the sector × cap matrix and the
 * allocation tree. Region and size are independent: a global fund can sit in
 * Large Cap, while a domestic fund with no size data is Diversified.
 */
export function equityBucketsForAsset(
  asset: Asset,
  data: FundData | null | undefined,
  prices: Record<string, PriceData>,
  usdToInr: number,
): AssetEquityProfile {
  const region = resolveAssetRegion(asset, data);

  if (!isFundAsset(asset)) {
    const cap = capForAsset(asset, prices, usdToInr, data?.categoryName);
    return {
      region,
      buckets: [{ size: isMarketCapCategory(cap) ? cap : 'Diversified', weight: 1 }],
    };
  }

  const mandate = resolveFundSize(asset, data);
  const providerWeights = resolveCapWeights(data, region, mandate);
  if (providerWeights.length > 0) {
    return { region, buckets: providerWeights };
  }

  if (mandate) {
    return {
      region,
      buckets: [{ size: mandate, weight: 1, holdings: allHoldings(data) }],
    };
  }

  const lookThrough = resolveHoldingsBuckets(data, prices, usdToInr);
  if (lookThrough) return { region, buckets: lookThrough };

  return {
    region,
    buckets: [{ size: 'Diversified', weight: 1, holdings: allHoldings(data) }],
  };
}

/**
 * Best-effort sector label for a fund whose provider returned no sector
 * weights. A global fund is not an Indian sector, and a diversified fund cannot
 * be assigned one sector; both get an explicit descriptive bucket instead of
 * being dropped into "Other / Uncategorized".
 */
function inferFundSector(asset: Asset, data?: FundData | null): string | null {
  const description = `${asset.name ?? ''} ${data?.categoryName ?? ''}`.toLowerCase();
  if (/(debt|bond|liquid|fixed income|gilt|money market)/.test(description)) return null;
  if (isGlobalFund(data?.categoryName, asset.name)) return 'Unclassified Equity';
  if (
    /(equity|index|flexi|multi|large|mid|small|elss|value|momentum|alpha|nifty|sensex|bees|etf)/.test(
      description,
    )
  ) {
    return 'Diversified Equity';
  }
  return null;
}

function holdingPercentIsPercentScale(holdings?: { holdingPercent: number }[]): boolean {
  const total = (holdings ?? []).reduce((sum, holding) => sum + num(holding.holdingPercent), 0);
  return total > 1.5;
}

/** Whether a fund has enough look-through data to drive the analytics. */
export function hasFundLookThrough(data?: FundData | null): boolean {
  if (!data) return false;
  return Boolean(
    (data.holdings?.length ?? 0) > 0 ||
      (data.sectorWeightings?.length ?? 0) > 0 ||
      allocationTotal(data.assetAllocation) > 0 ||
      capWeights(data).total > 0,
  );
}

function currentCurrency(asset: Asset, prices: Record<string, PriceData>): string {
  const assetCurrency = resolveAssetCurrency(asset);
  if (asset.manualPrice !== undefined && asset.manualPrice !== null) return assetCurrency;

  const quote = prices[asset.symbol];
  let currency = quote?.currency || assetCurrency;
  // Some providers report Indian-listed crypto proxies with an INR currency.
  if (asset.symbol.includes('-USD') && currency === 'INR') currency = 'USD';
  return currency;
}

function valueOf(asset: Asset, prices: Record<string, PriceData>, usdToInr: number): number {
  const currency = currentCurrency(asset, prices);
  return toPaise(toINR(priceFor(asset, prices), currency, usdToInr) * asset.quantity);
}

/**
 * Institutional cap bands: >= $10B large, >= $2B mid, below that small.
 * `marketCap` is quoted in the listing currency, so normalize it to USD first.
 * Returns null for missing/invalid values instead of inventing a bucket.
 */
function marketCapBand(
  marketCap: number | null | undefined,
  currency: string,
  usdToInr: number,
): MarketCapCategory | null {
  if (marketCap == null || !Number.isFinite(marketCap) || marketCap <= 0) return null;

  const rate = usdToInr > 0 ? usdToInr : 84;
  let capInUsd: number;
  if (currency === 'INR') {
    capInUsd = marketCap / rate;
  } else if (currency === 'GBp' || currency === 'GBX') {
    // London quotes use pence; convert to pounds before the USD comparison.
    capInUsd = (marketCap / 100) * 1.25;
  } else if (currency === 'GBP') {
    capInUsd = marketCap * 1.25;
  } else {
    capInUsd = marketCap;
  }

  if (capInUsd >= 10_000_000_000) return 'Large Cap';
  if (capInUsd >= 2_000_000_000) return 'Mid Cap';
  return 'Small Cap';
}

function capFromQuote(
  asset: Asset,
  prices: Record<string, PriceData>,
  usdToInr: number,
): MarketCapCategory | null {
  const quote = prices[asset.symbol];
  // NSE index membership beats the provider's market-cap field. HDFC Bank,
  // for example, has been returned with a market cap 100x too small.
  if (isMarketCapCategory(quote?.capCategory)) return quote.capCategory;
  return marketCapBand(
    quote?.marketCap,
    quote?.currency || currentCurrency(asset, prices),
    usdToInr,
  );
}

/** A manual cap override always wins; otherwise quote data then name inference. */
function capForAsset(
  asset: Asset,
  prices: Record<string, PriceData>,
  usdToInr: number,
  categoryName?: string | null,
): string | null {
  if (asset.manualCap?.trim()) return asset.manualCap.trim();
  return (
    capFromQuote(asset, prices, usdToInr) ??
    getCapCategory(asset.name, categoryName)
  );
}

/** The equity share of an asset; debt funds and non-equity assets return 0. */
function equityPortion(
  asset: Asset,
  totalValue: number,
  fundHoldings: Record<string, FundData>,
): number {
  const topCategory = normalizeCategory(asset.categoryPath?.[0] ?? asset.type);
  const data = fundHoldings[asset.symbol];
  const fund = isFundAsset(asset);

  if (fund && data?.assetAllocation) {
    const total = allocationTotal(data.assetAllocation);
    if (total > 0) {
      return totalValue * (num(data.assetAllocation.stockPosition) / total);
    }
  }

  if (fund) {
    if (isCommodityFund(data?.categoryName, asset.name)) return 0;
    return isDebtFund(data?.categoryName, asset.name) ? 0 : totalValue;
  }

  return topCategory === 'Equities' ? totalValue : 0;
}

function isDirectEquity(asset: Asset): boolean {
  const type = (asset.type || '').toUpperCase();
  return (type === 'EQUITY' || type === 'STOCK') && !isLikelyEtf(asset);
}

interface ExposureAccumulator {
  total: number;
  direct: number;
  indirect: number;
  regions: RegionSplit;
  constituents: ExposureConstituent[];
}

function emptyExposure(): ExposureAccumulator {
  return {
    total: 0,
    direct: 0,
    indirect: 0,
    regions: { domestic: 0, global: 0 },
    constituents: [],
  };
}

export function analyzePortfolio(input: {
  assets: Asset[];
  prices: Record<string, PriceData>;
  fundHoldings: Record<string, FundData>;
  idealAllocation: Record<string, number>;
  usdToInr: number;
}): PortfolioAnalytics {
  const { prices, fundHoldings, idealAllocation, usdToInr } = input;
  const assets = flattenAssets(input.assets);

  const values = new Map<Asset, number>();
  const equityValues = new Map<Asset, number>();
  for (const asset of assets) {
    const value = valueOf(asset, prices, usdToInr);
    values.set(asset, value);
    equityValues.set(asset, equityPortion(asset, value, fundHoldings));
  }
  const portfolioTotal = [...values.values()].reduce((sum, value) => sum + value, 0);

  // One classification per asset, shared by the allocation tree, market-cap
  // chart and sector × cap matrix. This is what keeps the tabs consistent.
  const equityProfiles = new Map<Asset, AssetEquityProfile>();
  for (const asset of assets) {
    if ((equityValues.get(asset) ?? 0) <= 0) continue;
    equityProfiles.set(
      asset,
      equityBucketsForAsset(asset, fundHoldings[asset.symbol], prices, usdToInr),
    );
  }

  // ---------------------------------------------------------------------------
  // Asset allocation analysis (current vs ideal, N-level tree)
  // ---------------------------------------------------------------------------
  interface AllocationBucket {
    name: string;
    value: number;
    constituents: { name: string; symbol: string; value: number }[];
  }

  const allocationMap = new Map<string, AllocationBucket>();
  const addAllocation = (name: string, value: number, asset: Asset) => {
    if (value <= 0) return;
    const key = name.trim();
    const existing = allocationMap.get(key);
    if (existing) {
      existing.value += value;
      existing.constituents.push({ name: asset.name, symbol: asset.symbol, value });
    } else {
      allocationMap.set(key, {
        name: key,
        value,
        constituents: [{ name: asset.name, symbol: asset.symbol, value }],
      });
    }
  };

  for (const asset of assets) {
    const totalValue = values.get(asset) ?? 0;
    if (totalValue <= 0) continue;

    const topCategory = normalizeCategory(asset.categoryPath?.[0] ?? asset.type);
    const data = fundHoldings[asset.symbol];
    const fund = isFundAsset(asset);
    const profile = equityProfiles.get(asset);

    // Commodity funds are never equity, even if a provider reports a stock
    // position placeholder. Keep them in the commodity sleeve.
    if (fund && isCommodityFund(data?.categoryName, asset.name)) {
      addAllocation(`Commodities > ${getCommoditySubCategory(asset)}`, totalValue, asset);
      continue;
    }

    if (fund && data?.assetAllocation) {
      const allocation = data.assetAllocation;
      const totalAlloc = allocationTotal(allocation);
      if (totalAlloc > 0) {
        const addPercent = (percent: number, category: string) => {
          addAllocation(category, totalValue * (percent / totalAlloc), asset);
        };

        const stock = num(allocation.stockPosition);
        if (stock > 0 && profile) {
          for (const bucket of profile.buckets) {
            if (bucket.weight <= 0) continue;
            addPercent(stock * bucket.weight, allocationPathFor(profile.region, bucket.size));
          }
        }

        addPercent(num(allocation.bondPosition), 'Fixed Income');
        addPercent(num(allocation.cashPosition), 'Cash');
        addPercent(
          num(allocation.otherPosition) +
            num(allocation.preferredPosition) +
            num(allocation.convertiblePosition),
          'Other',
        );
        continue;
      }
    }

    if (profile) {
      for (const bucket of profile.buckets) {
        if (bucket.weight <= 0) continue;
        addAllocation(
          allocationPathFor(profile.region, bucket.size),
          totalValue * bucket.weight,
          asset,
        );
      }
      continue;
    }

    // Non-equity fallbacks: debt funds, commodities and everything outside the
    // equity sleeve keep their existing top-level treatment.
    let finalCategory = topCategory;
    if (fund && isDebtFund(data?.categoryName, asset.name)) {
      finalCategory = 'Fixed Income';
    } else if (finalCategory === 'Commodities') {
      finalCategory = `Commodities > ${getCommoditySubCategory(asset)}`;
    }

    addAllocation(finalCategory, totalValue, asset);
  }

  const allocationData = [...allocationMap.values()];
  const analysedTotal = allocationData.reduce((sum, item) => sum + item.value, 0);
  const discrepancy = portfolioTotal - analysedTotal;
  if (discrepancy > 100) {
    allocationData.push({
      name: 'Uncategorized / Discrepancy',
      value: discrepancy,
      constituents: [],
    });
  }
  const totalCurrentValue =
    allocationData.reduce((sum, item) => sum + item.value, 0) || portfolioTotal;

  const consolidatedIdeal: Record<string, number> = {};
  for (const [key, value] of Object.entries(idealAllocation)) {
    addToRecord(consolidatedIdeal, normalizeGroup(key), value);
  }

  const allPathsSet = new Set<string>();
  for (const category of [
    ...Object.keys(consolidatedIdeal),
    ...allocationData.map((item) => normalizeGroup(item.name)),
  ]) {
    const parts = category.split(' > ');
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath} > ${part.trim()}` : part.trim();
      allPathsSet.add(currentPath);
    }
  }
  const allCategories = [...allPathsSet];

  const effectiveIdeal: Record<string, number> = {};
  const sortedByDepth = [...allCategories].sort(
    (a, b) => a.split('>').length - b.split('>').length,
  );
  for (const category of sortedByDepth) {
    const parts = category.split(' > ');
    if (parts.length === 1) {
      effectiveIdeal[category] = consolidatedIdeal[category] ?? 0;
      continue;
    }
    const parentPath = parts.slice(0, -1).join(' > ');
    const parentRaw = consolidatedIdeal[parentPath] ?? 0;
    const parentEffective = effectiveIdeal[parentPath] ?? 0;
    const rawIdeal = consolidatedIdeal[category] ?? 0;
    effectiveIdeal[category] = parentRaw > 0 ? (rawIdeal / 100) * parentEffective : rawIdeal;
  }

  const nodeMap: Record<string, AllocationNode> = {};
  for (const category of allCategories) {
    const parts = category.split(' > ');
    const matchingItems = allocationData.filter(
      (item) => normalizeGroup(item.name) === category,
    );
    const currentValue = matchingItems.reduce((sum, item) => sum + item.value, 0);
    nodeMap[category] = {
      category: parts[parts.length - 1],
      fullPath: category,
      currentValue,
      currentPercentage: totalCurrentValue > 0 ? (currentValue / totalCurrentValue) * 100 : 0,
      idealPercentage: effectiveIdeal[category] ?? 0,
      diffPercentage: 0,
      diffValue: 0,
      constituents: matchingItems.flatMap((item) => item.constituents),
      subCategories: [],
    };
  }

  const reversedCategories = [...allCategories].sort(
    (a, b) => b.split('>').length - a.split('>').length,
  );
  for (const category of reversedCategories) {
    const node = nodeMap[category];
    const parts = category.split(' > ');
    if (parts.length === 1) continue;

    const parentPath = parts.slice(0, -1).join(' > ');
    const parent = nodeMap[parentPath];
    if (!parent) continue;

    parent.subCategories.push(node);
    parent.currentValue += node.currentValue;
    parent.currentPercentage += node.currentPercentage;
    if (!(consolidatedIdeal[parentPath] > 0)) {
      parent.idealPercentage += node.idealPercentage;
    }
  }

  const allocationAnalysis: AllocationNode[] = [];
  for (const category of allCategories) {
    const node = nodeMap[category];
    node.diffPercentage = node.currentPercentage - node.idealPercentage;
    node.diffValue = (node.diffPercentage / 100) * totalCurrentValue;
    node.subCategories.sort((a, b) => b.currentValue - a.currentValue);
    if (category.split(' > ').length === 1) allocationAnalysis.push(node);
  }
  allocationAnalysis.sort((a, b) => b.currentValue - a.currentValue);

  // ---------------------------------------------------------------------------
  // Market cap exposure (direct stocks + fund look-through)
  // ---------------------------------------------------------------------------
  const marketCapAllocation: Record<string, ExposureAccumulator> = {};
  for (const cap of CAP_ORDER) marketCapAllocation[cap] = emptyExposure();

  const addToMarketCap = (
    cap: string,
    value: number,
    isDirect: boolean,
    name: string,
    symbol: string,
    region: EquityRegion,
    subHoldings?: { name: string; value: number }[],
    otherAllocations?: { name: string; value: number }[],
  ) => {
    const bucket =
      marketCapAllocation[cap] ?? (marketCapAllocation[cap] = emptyExposure());
    bucket.total += value;
    if (region === 'Global') bucket.regions.global += value;
    else bucket.regions.domestic += value;
    if (isDirect) bucket.direct += value;
    else bucket.indirect += value;

    const existing = bucket.constituents.find(
      (item) => item.symbol === symbol && item.region === region,
    );
    if (existing) {
      existing.value += value;
      if (subHoldings) existing.subHoldings = [...(existing.subHoldings ?? []), ...subHoldings];
      if (otherAllocations) existing.otherAllocations = otherAllocations;
    } else {
      bucket.constituents.push({
        name,
        symbol,
        value,
        type: isDirect ? 'direct' : 'indirect',
        region,
        subHoldings,
        otherAllocations,
      });
    }
  };

  for (const asset of assets) {
    const totalValue = values.get(asset) ?? 0;
    const equityValue = equityValues.get(asset) ?? 0;
    if (totalValue <= 0 || equityValue <= 0) continue;

    const profile = equityProfiles.get(asset);
    if (!profile) continue;

    const nonEquity = Math.max(0, totalValue - equityValue);
    const isDirect = isDirectEquity(asset);

    for (const bucket of profile.buckets) {
      if (bucket.weight <= 0) continue;

      const cap = marketCapKey(profile.region, bucket.size);
      const subHoldings = (bucket.holdings ?? [])
        .map((holding) => ({ name: holding.name, value: totalValue * holding.percent }))
        .filter((holding) => holding.value > 0)
        .sort((a, b) => b.value - a.value);

      const otherAllocations: { name: string; value: number }[] = profile.buckets
        .filter((other) => other !== bucket && other.weight > 0)
        .map((other) => ({
          name: capDisplayLabel(marketCapKey(profile.region, other.size)),
          value: equityValue * other.weight,
        }));
      if (nonEquity > 0) {
        otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
      }

      addToMarketCap(
        cap,
        equityValue * bucket.weight,
        isDirect,
        asset.name,
        asset.symbol,
        profile.region,
        subHoldings.length > 0 ? subHoldings : undefined,
        otherAllocations.length > 0 ? otherAllocations : undefined,
      );
    }
  }

  const marketCap: ExposureSlice[] = Object.entries(marketCapAllocation)
    .filter(([, bucket]) => bucket.total > 0)
    .map(([name, bucket]) => ({
      key: name,
      name,
      value: bucket.total,
      direct: bucket.direct,
      indirect: bucket.indirect,
      regions: bucket.regions,
      constituents: bucket.constituents.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);

  // ---------------------------------------------------------------------------
  // Sector exposure + sector × market-cap matrix
  // ---------------------------------------------------------------------------
  const sectorAllocation: Record<string, ExposureAccumulator> = {};
  const sectorByCap: Record<string, Record<string, number>> = {};
  for (const cap of CAP_ORDER) sectorByCap[cap] = {};

  const addToSector = (
    sectorName: string,
    value: number,
    isDirect: boolean,
    name: string,
    symbol: string,
    otherAllocations?: { name: string; value: number }[],
  ) => {
    const bucket = sectorAllocation[sectorName] ?? (sectorAllocation[sectorName] = emptyExposure());
    bucket.total += value;
    if (isDirect) bucket.direct += value;
    else bucket.indirect += value;

    const existing = bucket.constituents.find((item) => item.symbol === symbol);
    if (existing) {
      existing.value += value;
      if (otherAllocations) existing.otherAllocations = otherAllocations;
    } else {
      bucket.constituents.push({
        name,
        symbol,
        value,
        type: isDirect ? 'direct' : 'indirect',
        otherAllocations,
      });
    }
  };

  for (const asset of assets) {
    const totalValue = values.get(asset) ?? 0;
    const equityValue = equityValues.get(asset) ?? 0;
    if (totalValue <= 0 || equityValue <= 0) continue;

    const fund = isFundAsset(asset);
    const data = fundHoldings[asset.symbol];
    const sectors = fund ? normalizeSectorWeightings(data?.sectorWeightings) : [];
    const direct = isDirectEquity(asset);
    const profile = equityProfiles.get(asset);

    const distributeToCaps = (sectorName: string, value: number) => {
      if (!profile) return;
      for (const bucket of profile.buckets) {
        if (bucket.weight <= 0) continue;
        const cap = marketCapKey(profile.region, bucket.size);
        sectorByCap[cap] = sectorByCap[cap] ?? {};
        addToRecord(sectorByCap[cap], sectorName, value * bucket.weight);
      }
    };

    if (sectors.length > 0 && !asset.manualSector) {
      const percentScale = holdingPercentIsPercentScale(
        sectors.map((sector) => ({ holdingPercent: sector.percentage })),
      );
      const normalized = sectors.map((sector) => ({
        name: sector.sector || 'Other',
        percent: (sector.percentage || 0) / (percentScale ? 100 : 1),
      }));
      const totalPercent = normalized.reduce(
        (sum, sector) => sum + sector.percent * 100,
        0,
      );
      // Provider sector weights often cover only the equity sleeve (94.9%)
      // rather than 100%. Scale material coverage to the sleeve so the
      // residual does not become a phantom "Other" slice. Sparse samples keep
      // their reported values and use the inferred fund sector for the rest.
      const scale =
        totalPercent >= 50 ? equityValue / (totalPercent / 100) : equityValue;
      const coveredValue = normalized.reduce(
        (sum, sector) => sum + sector.percent * scale,
        0,
      );
      const unmappedSector = Math.max(0, equityValue - coveredValue);
      const fallbackSector =
        (fund ? inferFundSector(asset, data) : null) ?? 'Diversified Equity';
      const nonEquity = Math.max(0, totalValue - equityValue);

      for (const sector of normalized) {
        const value = sector.percent * scale;
        if (value <= 0) continue;
        const otherAllocations = normalized
          .filter((other) => other.name !== sector.name)
          .map((other) => ({ name: other.name, value: other.percent * scale }))
          .filter((other) => other.value > 0);
        if (unmappedSector > equityValue * 0.001 && fallbackSector !== sector.name) {
          otherAllocations.push({ name: fallbackSector, value: unmappedSector });
        }
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToSector(sector.name, value, false, asset.name, asset.symbol, otherAllocations);
        distributeToCaps(sector.name, value);
      }

      if (unmappedSector > equityValue * 0.001) {
        const otherAllocations = normalized
          .map((sector) => ({ name: sector.name, value: sector.percent * scale }))
          .filter((other) => other.value > 0);
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToSector(
          fallbackSector,
          unmappedSector,
          false,
          `${asset.name} (unclassified equity)`,
          `${asset.symbol}-unclassified`,
          otherAllocations,
        );
        distributeToCaps(fallbackSector, unmappedSector);
      }
    } else {
      const sectorName =
        asset.manualSector ||
        (fund ? inferFundSector(asset, data) : null) ||
        canonicalSectorLabel(prices[asset.symbol]?.sector ?? '') ||
        'Other / Uncategorized';
      addToSector(sectorName, equityValue, direct, asset.name, asset.symbol);
      distributeToCaps(sectorName, equityValue);
    }
  }

  const sectors: ExposureSlice[] = Object.entries(sectorAllocation)
    .filter(([, bucket]) => bucket.total > 0)
    .map(([name, bucket]) => ({
      key: name,
      name,
      value: bucket.total,
      direct: bucket.direct,
      indirect: bucket.indirect,
      constituents: bucket.constituents.sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);

  const capRows: CapSectorRow[] = Object.entries(sectorByCap)
    .map(([cap, bySector]) => ({
      cap,
      total: Object.values(bySector).reduce((sum, value) => sum + value, 0),
      regions: marketCapAllocation[cap]?.regions ?? { domestic: 0, global: 0 },
      sectors: Object.entries(bySector)
        .filter(([, value]) => value > 0)
        .map(([sector, value]) => ({ sector, value }))
        .sort((a, b) => b.value - a.value),
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => {
      const aIndex = CAP_ORDER.indexOf(a.cap);
      const bIndex = CAP_ORDER.indexOf(b.cap);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });

  const sectorTotals = new Map<string, number>();
  for (const row of capRows) {
    for (const sector of row.sectors) {
      sectorTotals.set(sector.sector, (sectorTotals.get(sector.sector) ?? 0) + sector.value);
    }
  }
  for (const sector of sectors) {
    if (!sectorTotals.has(sector.name)) sectorTotals.set(sector.name, sector.value);
  }
  const allSectors = [...sectorTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sector]) => sector);

  const sectorColors: Record<string, string> = {};
  [...allSectors]
    .sort((a, b) => a.localeCompare(b))
    .forEach((sector, index) => {
      sectorColors[sector] = SECTOR_PALETTE[index % SECTOR_PALETTE.length];
    });

  // ---------------------------------------------------------------------------
  // Mutual fund / ETF allocation
  // ---------------------------------------------------------------------------
  const fundMap = new Map<string, FundSlice>();
  const fundAssets = assets.filter(isFundAsset);

  for (const asset of fundAssets) {
    const totalValue = values.get(asset) ?? 0;
    if (totalValue <= 0) continue;

    const data = fundHoldings[asset.symbol];
    const percentScale = holdingPercentIsPercentScale(data?.holdings);
    const subHoldings = (data?.holdings ?? [])
      .map((holding) => {
        const rawPercent = num(holding.holdingPercent);
        const percent = percentScale ? rawPercent / 100 : rawPercent;
        return {
          name: holding.holdingName || holding.symbol,
          value: totalValue * percent,
        };
      })
      .filter((holding) => holding.value > 0)
      .sort((a, b) => b.value - a.value);

    const existing = fundMap.get(asset.name);
    if (existing) {
      existing.value += totalValue;
      existing.constituents.push({
        name: asset.name,
        symbol: asset.symbol,
        value: totalValue,
        subHoldings,
        assetAllocation: data?.assetAllocation,
        sectorWeightings: normalizeSectorWeightings(data?.sectorWeightings),
      });
    } else {
      fundMap.set(asset.name, {
        key: asset.name,
        name: asset.name,
        value: totalValue,
        constituents: [
          {
            name: asset.name,
            symbol: asset.symbol,
            value: totalValue,
            subHoldings,
            assetAllocation: data?.assetAllocation,
            sectorWeightings: normalizeSectorWeightings(data?.sectorWeightings),
          },
        ],
      });
    }
  }

  const funds = [...fundMap.values()].sort((a, b) => b.value - a.value);

  // ---------------------------------------------------------------------------
  // Underlying security exposure (look through every fund)
  // ---------------------------------------------------------------------------
  const underlyingMap = new Map<string, UnderlyingExposure>();
  const addUnderlying = (
    key: string,
    name: string,
    value: number,
    type: string,
    marketCapCategory?: string,
  ) => {
    const existing = underlyingMap.get(key);
    if (existing) {
      existing.value += value;
      return;
    }
    underlyingMap.set(key, { symbol: key, name, value, type, marketCapCategory });
  };

  for (const asset of assets) {
    const totalValue = values.get(asset) ?? 0;
    if (totalValue <= 0) continue;

    const data = fundHoldings[asset.symbol];
    const holdings = data?.holdings ?? [];

    if (holdings.length > 0) {
      const percentScale = holdingPercentIsPercentScale(holdings);
      let accounted = 0;
      for (const holding of holdings) {
        const rawPercent = num(holding.holdingPercent);
        const percent = percentScale ? rawPercent / 100 : rawPercent;
        if (percent <= 0) continue;
        accounted += percent;

        const quote = prices[holding.symbol];
        const holdingCap = isMarketCapCategory(quote?.capCategory)
          ? quote.capCategory
          : marketCapBand(quote?.marketCap, quote?.currency || 'INR', usdToInr);
        const nameCap = getCapCategory(holding.holdingName);
        const cap = holdingCap ?? (isMarketCapCategory(nameCap) ? nameCap : null);

        addUnderlying(
          holding.symbol || holding.holdingName,
          holding.holdingName || holding.symbol,
          totalValue * percent,
          'EQUITY',
          cap ?? undefined,
        );
      }
      const remaining = Math.max(0, 1 - accounted);
      if (remaining > 0) {
        addUnderlying(
          `OTHER_${asset.symbol}`,
          `Other (${asset.name})`,
          totalValue * remaining,
          'OTHER',
          getCapCategory(asset.name, data?.categoryName) ?? undefined,
        );
      }
      continue;
    }

    addUnderlying(
      asset.symbol,
      asset.name,
      totalValue,
      asset.type,
      capForAsset(asset, prices, usdToInr, data?.categoryName) ?? undefined,
    );
  }

  const underlying = [...underlyingMap.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const capNames = [
    ...new Set([...marketCap.map((slice) => slice.name), ...capRows.map((row) => row.cap)]),
  ].sort((a, b) => {
    const aIndex = CAP_ORDER.indexOf(a);
    const bIndex = CAP_ORDER.indexOf(b);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.localeCompare(b);
  });
  const capColors: Record<string, string> = {};
  capNames.forEach((cap, index) => {
    capColors[cap] = CAP_COLORS[cap] ?? SECTOR_PALETTE[(index + 3) % SECTOR_PALETTE.length];
  });

  return {
    marketCap,
    sectors,
    funds,
    sectorByCap,
    capRows,
    allSectors,
    sectorColors,
    capColors,
    allocationAnalysis,
    underlying,
    fundCoverage: {
      withData: fundAssets.filter((asset) => hasFundLookThrough(fundHoldings[asset.symbol])).length,
      total: fundAssets.length,
    },
    totals: {
      portfolio: portfolioTotal,
      equity: [...equityValues.values()].reduce((sum, value) => sum + value, 0),
      fund: funds.reduce((sum, fund) => sum + fund.value, 0),
    },
  };
}
