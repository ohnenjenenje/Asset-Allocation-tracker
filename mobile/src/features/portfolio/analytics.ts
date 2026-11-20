import { toPaise } from '@/src/lib/format/money';

import { flattenAssets, priceFor } from './aggregate';
import {
  getCapCategory,
  getCommoditySubCategory,
  guessCurrency,
  isCommodityFund,
  isDebtFund,
  isDomesticEquity,
  isFundAsset,
  isGlobalFund,
  isLikelyEtf,
  normalizeCategory,
  normalizeGroup,
  toINR,
} from './normalize';
import type {
  Asset,
  FundAssetAllocation,
  FundData,
  FundSectorWeighting,
  PriceData,
} from './types';

export const DEFAULT_IDEAL_ALLOCATION: Record<string, number> = {
  Equities: 60,
  'Fixed Income': 20,
  Commodities: 5,
  Crypto: 5,
  Cash: 10,
};

export const CAP_ORDER = ['Large Cap', 'Mid Cap', 'Small Cap', 'Other / Uncategorized'];

export const CAP_COLORS: Record<string, string> = {
  'Large Cap': '#2563EB',
  'Mid Cap': '#059669',
  'Small Cap': '#7C3AED',
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

export interface ExposureConstituent {
  name: string;
  symbol: string;
  value: number;
  type: 'direct' | 'indirect';
  subHoldings?: { name: string; value: number }[];
  otherAllocations?: { name: string; value: number }[];
}

export interface ExposureSlice {
  key: string;
  name: string;
  value: number;
  direct: number;
  indirect: number;
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
  const assetCurrency = asset.currency || guessCurrency(asset.symbol);
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
 * `marketCap` is quoted in the listing currency, so convert INR to USD first.
 */
function marketCapBand(
  marketCap: number,
  currency: string,
  usdToInr: number,
): 'Large Cap' | 'Mid Cap' | 'Small Cap' {
  const rate = usdToInr > 0 ? usdToInr : 84;
  const capInUsd = currency === 'INR' ? marketCap / rate : marketCap;
  if (capInUsd >= 10_000_000_000) return 'Large Cap';
  if (capInUsd >= 2_000_000_000) return 'Mid Cap';
  return 'Small Cap';
}

function capFromQuote(
  asset: Asset,
  prices: Record<string, PriceData>,
  usdToInr: number,
): string | null {
  const marketCap = prices[asset.symbol]?.marketCap;
  if (marketCap == null || !Number.isFinite(marketCap)) return null;
  return marketCapBand(marketCap, currentCurrency(asset, prices), usdToInr);
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
  constituents: ExposureConstituent[];
}

function emptyExposure(): ExposureAccumulator {
  return { total: 0, direct: 0, indirect: 0, constituents: [] };
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

    // Commodity funds are never equity, even if a provider reports a stock
    // position placeholder. Keep them in the commodity sleeve.
    if (fund && isCommodityFund(data?.categoryName, asset.name)) {
      addAllocation(`Commodities > ${getCommoditySubCategory(asset)}`, totalValue, asset);
      continue;
    }

    if ((topCategory === 'Mutual Funds' || topCategory === 'ETFs' || fund) && data?.assetAllocation) {
      const allocation = data.assetAllocation;
      const totalAlloc = allocationTotal(allocation);
      if (totalAlloc > 0) {
        const addPercent = (percent: number, category: string) => {
          addAllocation(category, totalValue * (percent / totalAlloc), asset);
        };

        const stock = num(allocation.stockPosition);
        if (stock > 0) {
          if (isGlobalFund(data.categoryName, asset.name)) {
            addPercent(stock, 'Equities > Global Equity');
          } else {
            const weights = capWeights(data);
            if (weights.total > 0) {
              addPercent((stock * weights.large) / weights.total, 'Equities > Domestic Equity > Large Cap');
              addPercent((stock * weights.mid) / weights.total, 'Equities > Domestic Equity > Mid Cap');
              addPercent((stock * weights.small) / weights.total, 'Equities > Domestic Equity > Small Cap');
              addPercent((stock * weights.others) / weights.total, 'Equities > Domestic Equity');
            } else {
              const cap = capForAsset(asset, prices, usdToInr, data.categoryName);
              addPercent(
                stock,
                cap === 'Large Cap' || cap === 'Mid Cap' || cap === 'Small Cap'
                  ? `Equities > Domestic Equity > ${cap}`
                  : 'Equities > Domestic Equity',
              );
            }
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

    let finalCategory = topCategory;

    if (finalCategory === 'Equities') {
      if (isDomesticEquity(asset)) {
        const cap = capForAsset(asset, prices, usdToInr);
        finalCategory =
          cap === 'Large Cap' || cap === 'Mid Cap' || cap === 'Small Cap'
            ? `Equities > Domestic Equity > ${cap}`
            : 'Equities > Domestic Equity';
      } else {
        finalCategory = 'Equities > Global Equity';
      }
    }

    if (finalCategory === 'Mutual Funds' || finalCategory === 'ETFs') {
      if (isDebtFund(data?.categoryName, asset.name)) {
        finalCategory = 'Fixed Income';
      } else if (isCommodityFund(data?.categoryName, asset.name)) {
        finalCategory = `Commodities > ${getCommoditySubCategory(asset)}`;
      } else if (isGlobalFund(data?.categoryName, asset.name)) {
        finalCategory = 'Equities > Global Equity';
      } else {
        const cap = capForAsset(asset, prices, usdToInr, data?.categoryName);
        finalCategory =
          cap === 'Large Cap' || cap === 'Mid Cap' || cap === 'Small Cap'
            ? `Equities > Domestic Equity > ${cap}`
            : 'Equities > Domestic Equity';
      }
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
    subHoldings?: { name: string; value: number }[],
    otherAllocations?: { name: string; value: number }[],
  ) => {
    const bucket =
      marketCapAllocation[cap] ?? (marketCapAllocation[cap] = emptyExposure());
    bucket.total += value;
    if (isDirect) bucket.direct += value;
    else bucket.indirect += value;

    const existing = bucket.constituents.find((item) => item.symbol === symbol);
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
        subHoldings,
        otherAllocations,
      });
    }
  };

  for (const asset of assets) {
    const totalValue = values.get(asset) ?? 0;
    const equityValue = equityValues.get(asset) ?? 0;
    if (totalValue <= 0 || equityValue <= 0) continue;

    const data = fundHoldings[asset.symbol];
    const holdings = data?.holdings ?? [];
    const weights = capWeights(data);
    const nonEquity = Math.max(0, totalValue - equityValue);

    if (weights.total > 0) {
      const capEntries = [
        ['Large Cap', weights.large],
        ['Mid Cap', weights.mid],
        ['Small Cap', weights.small],
        ['Other / Uncategorized', weights.others],
      ] as const;

      for (const [cap, weight] of capEntries) {
        if (weight <= 0) continue;
        const capValue = equityValue * (weight / weights.total);
        const otherAllocations: { name: string; value: number }[] = capEntries
          .filter(([otherCap, otherWeight]) => otherCap !== cap && otherWeight > 0)
          .map(([otherCap, otherWeight]) => ({
            name: otherCap,
            value: equityValue * (otherWeight / weights.total),
          }));
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToMarketCap(
          cap,
          capValue,
          false,
          asset.name,
          asset.symbol,
          undefined,
          otherAllocations,
        );
      }
      continue;
    }

    if (holdings.length > 0) {
      const percentScale = holdingPercentIsPercentScale(holdings);
      const groups: Record<string, { total: number; holdings: { name: string; value: number }[] }> =
        {};
      let mappedValue = 0;

      for (const holding of holdings) {
        const rawPercent = num(holding.holdingPercent);
        const percent = percentScale ? rawPercent / 100 : rawPercent;
        if (percent <= 0) continue;

        const holdingValue = totalValue * percent;
        const quote = prices[holding.symbol];
        const cap =
          quote?.marketCap != null
            ? marketCapBand(quote.marketCap, quote.currency || 'INR', usdToInr)
            : (getCapCategory(holding.holdingName) ?? 'Other / Uncategorized');

        const group = groups[cap] ?? (groups[cap] = { total: 0, holdings: [] });
        group.total += holdingValue;
        group.holdings.push({ name: holding.holdingName || holding.symbol, value: holdingValue });
        mappedValue += holdingValue;
      }

      const unmappedEquity = Math.max(0, equityValue - mappedValue);
      for (const [cap, group] of Object.entries(groups)) {
        const otherAllocations = Object.entries(groups)
          .filter(([otherCap]) => otherCap !== cap)
          .map(([otherCap, otherGroup]) => ({ name: otherCap, value: otherGroup.total }));
        if (unmappedEquity > 0) {
          otherAllocations.push({ name: 'Unmapped Equity', value: unmappedEquity });
        }
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToMarketCap(
          cap,
          group.total,
          false,
          asset.name,
          asset.symbol,
          group.holdings,
          otherAllocations,
        );
      }

      if (unmappedEquity > 0) {
        const otherAllocations = Object.entries(groups).map(([cap, group]) => ({
          name: cap,
          value: group.total,
        }));
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToMarketCap(
          'Other / Uncategorized',
          unmappedEquity,
          false,
          `Unmapped Equity (${asset.name})`,
          `${asset.symbol}-unmapped`,
          undefined,
          otherAllocations,
        );
      }
      continue;
    }

    const cap =
      capForAsset(asset, prices, usdToInr, data?.categoryName) ??
      'Other / Uncategorized';
    addToMarketCap(cap, equityValue, isDirectEquity(asset), asset.name, asset.symbol);
  }

  const marketCap: ExposureSlice[] = Object.entries(marketCapAllocation)
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

    const data = fundHoldings[asset.symbol];
    const sectors = data?.sectorWeightings ?? [];
    const weights = capWeights(data);
    const direct = isDirectEquity(asset);
    const defaultCap =
      capForAsset(asset, prices, usdToInr, data?.categoryName) ??
      'Other / Uncategorized';

    const distributeToCaps = (sectorName: string, value: number) => {
      const addToCap = (cap: string, amount: number) => {
        sectorByCap[cap] = sectorByCap[cap] ?? {};
        addToRecord(sectorByCap[cap], sectorName, amount);
      };

      if (!direct && weights.total > 0) {
        const capEntries = [
          ['Large Cap', weights.large],
          ['Mid Cap', weights.mid],
          ['Small Cap', weights.small],
          ['Other / Uncategorized', weights.others],
        ] as const;
        for (const [cap, weight] of capEntries) {
          if (weight > 0) addToCap(cap, value * (weight / weights.total));
        }
      } else {
        addToCap(defaultCap, value);
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
      const mappedValue = normalized.reduce(
        (sum, sector) => sum + equityValue * sector.percent,
        0,
      );
      const unmappedSector = Math.max(0, equityValue - mappedValue);
      const nonEquity = Math.max(0, totalValue - equityValue);

      for (const sector of normalized) {
        const value = equityValue * sector.percent;
        if (value <= 0) continue;
        const otherAllocations = normalized
          .filter((other) => other.name !== sector.name)
          .map((other) => ({ name: other.name, value: equityValue * other.percent }))
          .filter((other) => other.value > 0);
        if (unmappedSector > 0) {
          otherAllocations.push({ name: 'Unmapped Equity', value: unmappedSector });
        }
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToSector(sector.name, value, false, asset.name, asset.symbol, otherAllocations);
        distributeToCaps(sector.name, value);
      }

      if (unmappedSector > 0) {
        const otherAllocations = normalized
          .map((sector) => ({ name: sector.name, value: equityValue * sector.percent }))
          .filter((other) => other.value > 0);
        if (nonEquity > 0) {
          otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
        }
        addToSector(
          'Other / Uncategorized',
          unmappedSector,
          false,
          `Unmapped Equity (${asset.name})`,
          `${asset.symbol}-unmapped`,
          otherAllocations,
        );
        distributeToCaps('Other / Uncategorized', unmappedSector);
      }
    } else {
      const sectorName =
        asset.manualSector || prices[asset.symbol]?.sector || 'Other / Uncategorized';
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
        sectorWeightings: data?.sectorWeightings,
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
            sectorWeightings: data?.sectorWeightings,
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
        addUnderlying(
          holding.symbol || holding.holdingName,
          holding.holdingName || holding.symbol,
          totalValue * percent,
          'EQUITY',
          getCapCategory(holding.holdingName) ?? undefined,
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
