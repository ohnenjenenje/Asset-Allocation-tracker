import React, { useMemo } from 'react';
import { Asset, PriceData } from '@/lib/types';
import {
  normalizeCategory,
  getCommoditySubCategory,
  guessCurrency,
  resolveAssetCurrency,
  getConvertedPrice,
  getCapCategory,
  normalizeGroup,
  formatCompact,
  isMarketCapCategory,
  marketCapCategoryFromValue,
  normalizeSectorWeightings,
  type MarketCapCategory,
} from '@/lib/portfolio-utils';

interface UsePortfolioCalculationsParams {
  mergedAssets: Asset[];
  assets: Asset[];
  prices: Record<string, PriceData>;
  fundHoldings: Record<string, any>;
  idealAllocation: Record<string, number>;
}

/** Shared price/currency resolution for every allocation calculation. */
const resolveAssetValue = (
  asset: Asset,
  priceData: PriceData | undefined,
  usdToInr: number,
) => {
  const hasPrice = priceData?.regularMarketPrice != null;
  const currentPriceRaw = asset.manualPrice !== undefined
    ? asset.manualPrice
    : hasPrice
      ? priceData!.regularMarketPrice
      : asset.entryPrice;

  let currentCurrency: string;
  if (asset.manualPrice !== undefined) {
    currentCurrency = resolveAssetCurrency(asset);
  } else if (hasPrice) {
    currentCurrency = priceData!.currency || guessCurrency(asset.symbol);
    if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') {
      currentCurrency = 'USD';
    }
  } else {
    currentCurrency = resolveAssetCurrency(asset);
  }

  const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
  return { currentCurrency, totalValue: currentPrice * asset.quantity };
};

/** Clamp provider allocation quirks (negative cash, >100% stock) before use. */
const normalizeFundAllocation = (allocation: any) => {
  if (!allocation) return null;

  const stock = Math.max(0, Number(allocation.stockPosition) || 0);
  const bond = Math.max(0, Number(allocation.bondPosition) || 0);
  const cash = Math.max(0, Number(allocation.cashPosition) || 0);
  const other =
    Math.max(0, Number(allocation.otherPosition) || 0) +
    Math.max(0, Number(allocation.preferredPosition) || 0) +
    Math.max(0, Number(allocation.convertiblePosition) || 0);
  const total = stock + bond + cash + other;

  if (total <= 0) return null;
  return { stock, bond, cash, other, total };
};

/** Equity portion of an asset, after removing a fund's debt/cash sleeve. */
const getEquityValue = (
  asset: Asset,
  totalValue: number,
  fundData: any,
  topCategory: string,
) => {
  const isFund = topCategory === 'Mutual Funds' || topCategory === 'ETFs';

  if (isFund && fundData?.assetAllocation) {
    const allocation = normalizeFundAllocation(fundData.assetAllocation);
    if (allocation) {
      return totalValue * (allocation.stock / allocation.total);
    }
  }

  if (topCategory === 'Equities') return totalValue;

  if (isFund) {
    const description = `${asset.name || ''} ${fundData?.categoryName || ''}`.toLowerCase();
    if (/(debt|bond|liquid|fixed income|gilt|money market)/.test(description)) return 0;
    if (/(gold|silver|commodity|commodities)/.test(description)) return 0;
    return totalValue;
  }

  return 0;
};

/** Prefer an exchange-published cap bucket over a possibly bad market-cap value. */
const resolveDirectCap = (
  priceData: PriceData | undefined,
  currency: string | undefined,
  usdToInr: number,
  name: string,
): MarketCapCategory | null => {
  if (priceData?.capCategory && isMarketCapCategory(priceData.capCategory)) {
    return priceData.capCategory;
  }

  const fromValue = marketCapCategoryFromValue(priceData?.marketCap, currency, usdToInr);
  if (fromValue) return fromValue;

  const fromName = getCapCategory(name);
  return isMarketCapCategory(fromName) ? fromName : null;
};

/** Whether a fund invests outside the Indian equity market. */
const isGlobalFund = (asset: Asset, fundData: any): boolean => {
  const description = `${asset.name || ''} ${fundData?.categoryName || ''}`.toLowerCase();
  return /(global|international|off[- ]?shore|greater china|china|hong kong|world|us equity|nasdaq|s&p)/.test(description);
};

/** Best-effort sector label for a fund whose provider returned no sector data. */
const inferFundSector = (asset: Asset, fundData: any): string | null => {
  const description = `${asset.name || ''} ${fundData?.categoryName || ''}`.toLowerCase();
  if (/(debt|bond|liquid|fixed income|gilt|money market)/.test(description)) return null;
  if (isGlobalFund(asset, fundData)) return 'Global Equity';
  if (/(equity|index|flexi|multi|large|mid|small|elss|value|momentum|alpha|nifty|sensex|bees|etf)/.test(description)) {
    return 'Diversified Equity';
  }
  return null;
};

type CapBucket = MarketCapCategory | 'Global Equity' | 'Diversified Equity';

/**
 * Best-effort cap bucket for a fund. Funds whose mandate spans several cap
 * buckets (flexi, multi, large+mid) or that invest outside India must not be
 * forced into a single Indian cap bucket. They get a descriptive bucket
 * instead of the misleading "Other / Uncategorized".
 */
const resolveFundCap = (asset: Asset, fundData: any): CapBucket | null => {
  const category = getCapCategory(asset.name || asset.symbol, fundData?.categoryName);
  if (isMarketCapCategory(category)) return category;
  if (isGlobalFund(asset, fundData)) return 'Global Equity';

  const description = `${asset.name || ''} ${fundData?.categoryName || ''}`.toLowerCase();
  if (/(flexi|multi|large\s*&?\s*mid|large\s*midcap|mid\s*&?\s*large|diversified|balanced advantage|dynamic asset)/.test(description)) {
    return 'Diversified Equity';
  }
  return null;
};

/**
 * Convert provider market-cap weights into normalized buckets.
 *
 * Provider payloads include an "others" slice (unclassified holdings or cash).
 * Turning that into an "Other / Uncategorized" chart slice makes the portfolio
 * look far less classified than it is. Instead:
 *   - a fund with a known single cap folds "others" into that cap;
 *   - a flexi/global fund keeps "others" as its descriptive bucket;
 *   - when nothing is known, spread "others" proportionally over the reported
 *     caps so the chart still reconciles to the equity value.
 */
const resolveMarketCapWeights = (
  weights: Record<string, any> | null | undefined,
  fallbackCap: CapBucket | null,
): Array<{ cap: CapBucket; weight: number }> => {
  if (!weights) return [];

  const large = Number(weights.largeCap) || 0;
  const mid = Number(weights.midCap) || 0;
  const small = Number(weights.smallCap) || 0;
  const others = Number(weights.others) || 0;
  const knownTotal = large + mid + small;

  if (knownTotal > 0) {
    const allBuckets: Array<{ cap: CapBucket; raw: number }> = [
      { cap: 'Large Cap', raw: large },
      { cap: 'Mid Cap', raw: mid },
      { cap: 'Small Cap', raw: small },
    ];
    const buckets = allBuckets.filter((bucket) => bucket.raw > 0);

    if (others <= 0) {
      return buckets.map((bucket) => ({ cap: bucket.cap, weight: bucket.raw / knownTotal }));
    }

    if (fallbackCap && isMarketCapCategory(fallbackCap)) {
      // A single-cap fund's unclassified slice belongs to its own cap bucket.
      const existing = buckets.find((bucket) => bucket.cap === fallbackCap);
      if (existing) {
        existing.raw += others;
      } else {
        buckets.push({ cap: fallbackCap, raw: others });
      }
      const total = knownTotal + others;
      return buckets.map((bucket) => ({ cap: bucket.cap, weight: bucket.raw / total }));
    }

    if (fallbackCap === 'Global Equity') {
      // Indian cap weights are not meaningful for a global fund; keep the
      // unclassified slice in the descriptive global bucket.
      return [
        ...buckets.map((bucket) => ({ cap: bucket.cap, weight: bucket.raw / (knownTotal + others) })),
        { cap: fallbackCap, weight: others / (knownTotal + others) },
      ];
    }

    // Flexi/multi-cap or unknown mandate: spread the unclassified slice over
    // the reported caps so the chart stays within real cap buckets.
    return buckets.map((bucket) => ({ cap: bucket.cap, weight: bucket.raw / knownTotal }));
  }

  if (others > 0) {
    return [{ cap: fallbackCap || 'Diversified Equity', weight: 1 }];
  }

  return [];
};


export function usePortfolioCalculations({
  mergedAssets,
  assets,
  prices,
  fundHoldings,
  idealAllocation
}: UsePortfolioCalculationsParams) {
  const usdToInr = useMemo(() => prices['INR=X']?.regularMarketPrice || 83, [prices]);

  const isSmallCrypto = useMemo(() => (asset: Asset) => {
    const baseCat = normalizeCategory(asset.type);
    if (baseCat === 'Crypto') {
      const priceData = prices[asset.symbol];
      const hasPrice = priceData?.regularMarketPrice != null;
      const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
      
      let currentCurrency;
      if (asset.manualPrice !== undefined) {
        currentCurrency = resolveAssetCurrency(asset);
      } else if (hasPrice) {
        currentCurrency = priceData.currency || guessCurrency(asset.symbol);
        if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
      } else {
        currentCurrency = resolveAssetCurrency(asset);
      }
      
      const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
      const value = currentPrice * asset.quantity;
      if (value < 10) return true;
    }
    return false;
  }, [prices, usdToInr]);

  const calculations = useMemo(() => {
  const portfolioStats = mergedAssets.reduce((acc, asset) => {
    const category = normalizeCategory(asset.type);
    if (!acc.byCategory[category]) {
      acc.byCategory[category] = { quantity: 0, currentValue: 0, investedValue: 0, assetCount: 0 };
    }

    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = resolveAssetCurrency(asset);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = resolveAssetCurrency(asset);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    
    let assetCurrency = resolveAssetCurrency(asset);
    const entryPriceConverted = getConvertedPrice(asset.entryPrice, assetCurrency, usdToInr);
    
    const currentValue = currentPrice * asset.quantity;
    const investedValue = entryPriceConverted * asset.quantity;
    
    acc.currentValue += currentValue;
    acc.investedValue += investedValue;
    
    acc.byCategory[category].quantity += asset.quantity;
    acc.byCategory[category].currentValue += currentValue;
    acc.byCategory[category].investedValue += investedValue;
    acc.byCategory[category].assetCount += 1;

    if (isSmallCrypto(asset)) {
      acc.smallCryptoStats.quantity += asset.quantity;
      acc.smallCryptoStats.currentValue += currentValue;
      acc.smallCryptoStats.investedValue += investedValue;
      acc.smallCryptoStats.count += 1;
    }
    
    return acc;
  }, { currentValue: 0, investedValue: 0, byCategory: {} as Record<string, { quantity: number; currentValue: number; investedValue: number; assetCount: number; }>, smallCryptoStats: { quantity: 0, currentValue: 0, investedValue: 0, count: 0 } });

  const totalProfitLoss = portfolioStats.currentValue - portfolioStats.investedValue;
  const totalProfitLossPercent = portfolioStats.investedValue > 0 ? (totalProfitLoss / portfolioStats.investedValue) * 100 : 0;

  const allocationData = mergedAssets.reduce((acc: any[], asset) => {
    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = resolveAssetCurrency(asset);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = resolveAssetCurrency(asset);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    const value = currentPrice * asset.quantity;
    
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETFs') && fundHoldings[asset.symbol]?.assetAllocation) {
      const allocation = normalizeFundAllocation(fundHoldings[asset.symbol].assetAllocation);

      if (allocation) {
        const addValue = (cat: string, pct: number) => {
          if (pct <= 0) return;
          const val = value * (pct / allocation.total);
          const existing = acc.find(item => item.name.trim() === cat.trim());
          if (existing) {
            existing.value += val;
            existing.constituents = existing.constituents || [];
            existing.constituents.push({ name: asset.name, symbol: asset.symbol, value: val });
          } else {
            acc.push({ name: cat.trim(), value: val, constituents: [{ name: asset.name, symbol: asset.symbol, value: val }] });
          }
        };
        
        const stockPos = allocation.stock;
        const fundCap = resolveFundCap(asset, fundHoldings[asset.symbol]);
        const capWeights = resolveMarketCapWeights(
          fundHoldings[asset.symbol]?.marketCapWeightage,
          fundCap,
        );

        if (isGlobalFund(asset, fundHoldings[asset.symbol])) {
          addValue('Equities > Global Equity', stockPos);
        } else if (capWeights.length > 0) {
          capWeights.forEach(({ cap, weight }) => {
            if (cap === 'Global Equity') {
              addValue('Equities > Global Equity', stockPos * weight);
            } else if (cap === 'Diversified Equity') {
              addValue('Equities > Domestic Equity', stockPos * weight);
            } else {
              addValue(`Equities > Domestic Equity > ${cap}`, stockPos * weight);
            }
          });
        } else if (fundCap) {
          addValue(`Equities > Domestic Equity > ${fundCap}`, stockPos);
        } else {
          addValue('Equities > Domestic Equity', stockPos);
        }
        addValue('Fixed Income', allocation.bond);
        addValue('Cash', allocation.cash);
        addValue('Other', allocation.other);
        return acc;
      }
    }
    
    const isDomestic = (asset: any) => {
      if (asset.symbol.endsWith('.NS') || asset.symbol.endsWith('.BO')) return true;
      if (asset.exchange === 'NSE' || asset.exchange === 'BSE') return true;
      return false;
    };

    let finalCategory = topCategory;
    if (finalCategory === 'Equities') {
      if (isDomestic(asset)) {
        // Prefer the exchange's index-membership bucket over a raw market cap;
        // provider market-cap values occasionally use the wrong currency.
        const cap = resolveDirectCap(priceData, currentCurrency, usdToInr, asset.name || asset.symbol);
        if (isMarketCapCategory(cap)) {
          finalCategory = 'Equities > Domestic Equity > ' + cap;
        } else {
          finalCategory = 'Equities > Domestic Equity';
        }
      } else {
        finalCategory = 'Equities > Global Equity';
      }
    }
    
    if (finalCategory === 'Mutual Funds') {
      const catName = (fundHoldings[asset.symbol]?.categoryName || '').toLowerCase();
      if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
        finalCategory = 'Fixed Income';
      } else if (isGlobalFund(asset, fundHoldings[asset.symbol])) {
        finalCategory = 'Equities > Global Equity';
      } else {
        const cap = resolveFundCap(asset, fundHoldings[asset.symbol]);
        if (isMarketCapCategory(cap)) {
          finalCategory = 'Equities > Domestic Equity > ' + cap;
        } else {
          finalCategory = 'Equities > Domestic Equity';
        }
      }
    } else if (finalCategory === 'Commodities') {
      finalCategory = 'Commodities > ' + getCommoditySubCategory(asset);
    }

    const existingType = acc.find(item => item.name.trim() === finalCategory.trim());
    if (existingType) {
      existingType.value += value;
      existingType.constituents = existingType.constituents || [];
      existingType.constituents.push({ name: asset.name, symbol: asset.symbol, value: value });
    } else {
      acc.push({ name: finalCategory.trim(), value, constituents: [{ name: asset.name, symbol: asset.symbol, value: value }] });
    }
    return acc;
  }, []);

  const totalCurrentValue = allocationData.reduce((sum, item) => sum + item.value, 0);
  
  const consolidatedAllocation = Object.entries(idealAllocation).reduce((acc, [key, val]) => {
    const normalized = normalizeGroup(key);
    acc[normalized] = (acc[normalized] || 0) + val;
    return acc;
  }, {} as Record<string, number>);

  const allPathsSet = new Set<string>();
  [
    ...Object.keys(consolidatedAllocation),
    ...allocationData.map(item => normalizeGroup(item.name))
  ].forEach(cat => {
    const parts = cat.split(' > ');
    let currentPath = '';
    parts.forEach(part => {
      currentPath = currentPath ? `${currentPath} > ${part.trim()}` : part.trim();
      allPathsSet.add(currentPath);
    });
  });
  const allCategories = Array.from(allPathsSet);

  // Pre-calculate the effective ideal percentages (supporting relative sub-category percentages N-levels deep)
  const effectiveIdeal: Record<string, number> = {};
  const sortedCategories = [...allCategories].sort((a, b) => a.split('>').length - b.split('>').length);
  
  sortedCategories.forEach(categoryStr => {
    const parts = categoryStr.split(' > ');
    if (parts.length === 1) {
      effectiveIdeal[categoryStr] = consolidatedAllocation[categoryStr] || 0;
    } else {
      const parentPath = parts.slice(0, -1).join(' > ');
      const parentRawIdeal = consolidatedAllocation[parentPath] || 0;
      const parentEffective = effectiveIdeal[parentPath] || 0;
      const rawCurrentIdeal = consolidatedAllocation[categoryStr] || 0;
      
      if (parentRawIdeal > 0) {
        effectiveIdeal[categoryStr] = (rawCurrentIdeal / 100) * parentEffective;
      } else {
        effectiveIdeal[categoryStr] = rawCurrentIdeal;
      }
    }
  });

  // Build recursive N-level tree
  const nodeMap: Record<string, any> = {};

  // Initialize all nodes
  allCategories.forEach(categoryStr => {
    const parts = categoryStr.split(' > ');
    const localName = parts[parts.length - 1];
    
    const matchingItems = allocationData.filter(item => normalizeGroup(item.name) === categoryStr);
    const currentValue = matchingItems.reduce((sum, item) => sum + item.value, 0);
    const constituents = matchingItems.flatMap(item => item.constituents || []);
    const currentPercentage = totalCurrentValue > 0 ? (currentValue / totalCurrentValue) * 100 : 0;
    const idealPercentage = effectiveIdeal[categoryStr] || 0;
    
    nodeMap[categoryStr] = {
      category: localName,
      fullPath: categoryStr,
      currentValue,
      currentPercentage,
      idealPercentage,
      constituents,
      subCategories: []
    };
  });

  // Link parents and children, roll up values bottom-up
  const reversedCategories = [...allCategories].sort((a, b) => b.split('>').length - a.split('>').length);
  reversedCategories.forEach(categoryStr => {
    const node = nodeMap[categoryStr];
    const parts = categoryStr.split(' > ');
    
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join(' > ');
      if (nodeMap[parentPath]) {
        nodeMap[parentPath].subCategories.push(node);
        
        nodeMap[parentPath].currentValue += node.currentValue;
        nodeMap[parentPath].currentPercentage += node.currentPercentage;
        
        if (!(consolidatedAllocation[parentPath] > 0)) {
          nodeMap[parentPath].idealPercentage += node.idealPercentage;
        }
      }
    }
  });

  // Finalize diffs and extract root nodes
  const rootNodes: any[] = [];
  allCategories.forEach(categoryStr => {
    const node = nodeMap[categoryStr];
    node.diffPercentage = node.currentPercentage - node.idealPercentage;
    node.diffValue = (node.diffPercentage / 100) * totalCurrentValue;
    
    if (node.subCategories.length > 0) {
      node.subCategories.sort((a: any, b: any) => b.currentValue - a.currentValue);
    }
    
    if (categoryStr.split(' > ').length === 1) {
      rootNodes.push(node);
    }
  });

  const allocationAnalysisTemp = rootNodes.sort((a, b) => b.currentValue - a.currentValue);

  const allocationAnalysis = allocationAnalysisTemp;


  const underlyingExposure: Record<string, { 
    symbol: string, 
    name: string, 
    value: number, 
    type: string, 
    marketCap?: number, 
    currency?: string,
    marketCapCategory?: string
  }> = {};

  console.log(`Calculating exposure for ${assets.length} assets. fundHoldings keys:`, Object.keys(fundHoldings));

  assets.forEach(asset => {
    const priceData = prices[asset.symbol];
    const { currentCurrency, totalValue } = resolveAssetValue(asset, priceData, usdToInr);

    const fundData = fundHoldings[asset.symbol];
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    // Use the equity sleeve for funds so cash/debt is not attributed to the
    // underlying stocks. Debt funds with no equity still keep their holdings.
    const exposureBase = getEquityValue(asset, totalValue, fundData, topCategory) || totalValue;
    
    if (holdings && holdings.length > 0) {
      let accountedPercent = 0;
      let totalHoldingPercent = holdings.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0);
      let isPercentageScale = totalHoldingPercent > 1.5;

      holdings.forEach((h: any) => {
        const percentRaw = h.holdingPercent || 0;
        const percent = isPercentageScale ? percentRaw / 100 : percentRaw;
        accountedPercent += percent;
        const value = exposureBase * percent;
        
        if (underlyingExposure[h.symbol]) {
          underlyingExposure[h.symbol].value += value;
        } else {
          underlyingExposure[h.symbol] = {
            symbol: h.symbol,
            name: h.holdingName,
            value: value,
            type: 'EQUITY',
            marketCap: prices[h.symbol]?.marketCap,
            currency: prices[h.symbol]?.currency || 'INR',
            marketCapCategory: getCapCategory(h.holdingName) || undefined
          };
        }
      });
      
      const remainingPercent = Math.max(0, 1 - accountedPercent);
      if (remainingPercent > 0) {
        const remKey = `OTHER_${asset.symbol}`;
        underlyingExposure[remKey] = {
          symbol: remKey,
          name: `Other (${asset.name})`,
          value: exposureBase * remainingPercent,
          type: 'OTHER',
          marketCapCategory: getCapCategory(asset.name, fundData?.categoryName) || undefined
        };
      }
    } else {
      if (underlyingExposure[asset.symbol]) {
        underlyingExposure[asset.symbol].value += totalValue;
      } else {
        underlyingExposure[asset.symbol] = {
          symbol: asset.symbol,
          name: asset.name,
          value: totalValue,
          type: asset.type,
          marketCap: priceData?.marketCap,
          currency: currentCurrency,
          marketCapCategory: getCapCategory(asset.name, fundData?.categoryName) || undefined
        };
      }
    }
  });

  const marketCapAllocation: Record<string, { total: number, direct: number, indirect: number, constituents: { name: string, symbol: string, value: number, type: 'direct' | 'indirect', subHoldings?: {name: string, value: number}[], otherAllocations?: {name: string, value: number}[] }[] }> = {
    'Large Cap': { total: 0, direct: 0, indirect: 0, constituents: [] },
    'Mid Cap': { total: 0, direct: 0, indirect: 0, constituents: [] },
    'Small Cap': { total: 0, direct: 0, indirect: 0, constituents: [] },
    'Other / Uncategorized': { total: 0, direct: 0, indirect: 0, constituents: [] }
  };

  const addToMarketCap = (cap: string, value: number, isDirect: boolean, name: string, symbol: string, subHoldings?: {name: string, value: number}[], otherAllocations?: {name: string, value: number}[]) => {
    if (!marketCapAllocation[cap]) {
      marketCapAllocation[cap] = { total: 0, direct: 0, indirect: 0, constituents: [] };
    }
    marketCapAllocation[cap].total += value;
    if (isDirect) {
      marketCapAllocation[cap].direct += value;
    } else {
      marketCapAllocation[cap].indirect += value;
    }
    
    const existing = marketCapAllocation[cap].constituents.find(c => c.symbol === symbol);
    if (existing) {
      existing.value += value;
      if (subHoldings) {
        existing.subHoldings = [...(existing.subHoldings || []), ...subHoldings];
      }
      if (otherAllocations) {
        existing.otherAllocations = otherAllocations;
      }
    } else {
      marketCapAllocation[cap].constituents.push({ name, symbol, value, type: isDirect ? 'direct' : 'indirect', subHoldings, otherAllocations });
    }
  };

  assets.forEach(asset => {
    const priceData = prices[asset.symbol];
    const { currentCurrency, totalValue } = resolveAssetValue(asset, priceData, usdToInr);

    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    const fundData = fundHoldings[asset.symbol];
    const equityValue = getEquityValue(asset, totalValue, fundData, topCategory);

    if (equityValue <= 0) return;

    const isFund = topCategory === 'Mutual Funds' || topCategory === 'ETFs';
    const type = (asset.type || '').toUpperCase();
    const isDirect = !isFund && (type === 'EQUITY' || type === 'STOCK');
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    const mcapWeightage = fundData?.marketCapWeightage;
    const hasMcapWeights = Boolean(
      mcapWeightage &&
      (Number(mcapWeightage.largeCap) > 0 ||
        Number(mcapWeightage.midCap) > 0 ||
        Number(mcapWeightage.smallCap) > 0),
    );
    const nonEquity = Math.max(0, totalValue - equityValue);

    const fundCap = isFund ? (resolveFundCap(asset, fundData) || 'Diversified Equity') : null;
    const capWeights = hasMcapWeights
      ? resolveMarketCapWeights(mcapWeightage, fundCap)
      : [];

    if (capWeights.length > 0) {
      capWeights.forEach(({ cap, weight }) => {
        const capValue = equityValue * weight;
        if (capValue <= 0) return;

        const otherAllocations: { name: string; value: number }[] = capWeights
          .filter((other) => other.cap !== cap)
          .map((other) => ({ name: other.cap, value: equityValue * other.weight }))
          .filter((other) => other.value > 0);
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap(cap, capValue, false, asset.name, asset.symbol, undefined, otherAllocations);
      });
      return;
    }

    // Prefer the fund's own category when it names a single cap bucket. This
    // keeps a NASDAQ-100 or S&P-500 ETF out of "Other" even when its cached
    // holdings only cover the top ten names.
    const categoryCap = isFund && isMarketCapCategory(fundCap) ? fundCap : null;

    if (categoryCap) {
      const totalHoldingPercent = holdings.reduce(
        (sum: number, holding: any) => sum + (holding.holdingPercent || 0),
        0,
      );
      const isPercentageScale = totalHoldingPercent > 1.5;
      const subHoldings = holdings.length > 0
        ? holdings.map((holding: any) => ({
            name: holding.holdingName || holding.symbol,
            value: equityValue * (isPercentageScale
              ? (holding.holdingPercent || 0) / 100
              : (holding.holdingPercent || 0)),
          }))
        : undefined;

      const otherAllocations: { name: string; value: number }[] = [];
      if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });
      addToMarketCap(categoryCap, equityValue, false, asset.name, asset.symbol, subHoldings, otherAllocations);
      return;
    }

    if (holdings.length > 0) {
      const totalHoldingPercent = holdings.reduce(
        (sum: number, holding: any) => sum + (holding.holdingPercent || 0),
        0,
      );
      const isPercentageScale = totalHoldingPercent > 1.5;
      const fundCapExposure: Record<string, { total: number; holdings: { name: string; value: number }[] }> = {};

      holdings.forEach((holding: any) => {
        const percentRaw = holding.holdingPercent || 0;
        const percent = isPercentageScale ? percentRaw / 100 : percentRaw;
        const holdingValue = equityValue * percent;

        const holdingPriceData = prices[holding.symbol];
        const holdingCap = holdingPriceData?.capCategory && isMarketCapCategory(holdingPriceData.capCategory)
          ? holdingPriceData.capCategory
          : marketCapCategoryFromValue(
              holdingPriceData?.marketCap,
              holdingPriceData?.currency,
              usdToInr,
            );
        const nameCap = getCapCategory(holding.holdingName);
        const cap = holdingCap || (isMarketCapCategory(nameCap) ? nameCap : null);

        // Leave unknown holdings for the fund-level fallback below.
        if (!cap) return;

        if (!fundCapExposure[cap]) fundCapExposure[cap] = { total: 0, holdings: [] };
        fundCapExposure[cap].total += holdingValue;
        fundCapExposure[cap].holdings.push({
          name: holding.holdingName || holding.symbol,
          value: holdingValue,
        });
      });

      const rawMappedValue = Object.values(fundCapExposure).reduce((sum, data) => sum + data.total, 0);

      // A provider's top-10 list often covers only part of the fund. When no
      // individual holding is classifiable, use the fund's mandate instead of
      // an "Other / Uncategorized" slice.
      if (rawMappedValue <= 0) {
        const fallback = fundCap || 'Diversified Equity';
        const subHoldings = holdings.map((holding: any) => ({
          name: holding.holdingName || holding.symbol,
          value: equityValue * (isPercentageScale
            ? (holding.holdingPercent || 0) / 100
            : (holding.holdingPercent || 0)),
        }));
        const otherAllocations: { name: string; value: number }[] = [];
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap(fallback, equityValue, false, asset.name, asset.symbol, subHoldings, otherAllocations);
        return;
      }

      const scale = rawMappedValue > equityValue ? equityValue / rawMappedValue : 1;
      const mappedValue = rawMappedValue * scale;
      const unmappedEquity = Math.max(0, equityValue - mappedValue);

      Object.entries(fundCapExposure).forEach(([cap, data]) => {
        const share = unmappedEquity * (data.total / rawMappedValue);
        const otherAllocations = Object.entries(fundCapExposure)
          .filter(([otherCap]) => otherCap !== cap)
          .map(([otherCap, otherData]) => ({
            name: otherCap,
            value: otherData.total * scale + unmappedEquity * (otherData.total / rawMappedValue),
          }))
          .filter((other) => other.value > 0);
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap(
          cap,
          data.total * scale + share,
          false,
          asset.name,
          asset.symbol,
          data.holdings.map((holding) => ({ ...holding, value: holding.value * scale })),
          otherAllocations,
        );
      });
      return;
    }

    // Direct stock or fund with no holdings data.
    let cap: string = 'Other / Uncategorized';
    if (isDirect) {
      cap = resolveDirectCap(priceData, currentCurrency, usdToInr, asset.name) || 'Other / Uncategorized';
    } else if (isFund) {
      cap = fundCap || 'Diversified Equity';
    }
    addToMarketCap(cap, equityValue, isDirect, asset.name, asset.symbol);
  });

  const marketCapData = Object.entries(marketCapAllocation)
    .filter(([_, data]) => data.total > 0)
    .map(([name, data]) => ({ 
      name, 
      value: data.total,
      direct: data.direct,
      indirect: data.indirect,
      constituents: data.constituents.sort((a, b) => b.value - a.value)
    }));

  const sectorAllocation: Record<string, { total: number, direct: number, indirect: number, constituents: { name: string, symbol: string, value: number, type: 'direct' | 'indirect', otherAllocations?: {name: string, value: number}[] }[] }> = {};
  const sectorByMarketCap: Record<string, Record<string, number>> = {
    'Large Cap': {},
    'Mid Cap': {},
    'Small Cap': {},
    'Other / Uncategorized': {}
  };

  const addToSector = (sectorName: string, value: number, isDirect: boolean, name: string, symbol: string, otherAllocations?: {name: string, value: number}[]) => {
    if (!sectorAllocation[sectorName]) {
      sectorAllocation[sectorName] = { total: 0, direct: 0, indirect: 0, constituents: [] };
    }
    sectorAllocation[sectorName].total += value;
    if (isDirect) {
      sectorAllocation[sectorName].direct += value;
    } else {
      sectorAllocation[sectorName].indirect += value;
    }
    
    const existing = sectorAllocation[sectorName].constituents.find(c => c.symbol === symbol);
    if (existing) {
      existing.value += value;
      if (otherAllocations) {
        existing.otherAllocations = otherAllocations;
      }
    } else {
      sectorAllocation[sectorName].constituents.push({ name, symbol, value, type: isDirect ? 'direct' : 'indirect', otherAllocations });
    }
  };

  assets.forEach(asset => {
    const priceData = prices[asset.symbol];
    const { currentCurrency, totalValue } = resolveAssetValue(asset, priceData, usdToInr);

    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    const fundData = fundHoldings[asset.symbol];
    const equityValue = getEquityValue(asset, totalValue, fundData, topCategory);

    if (equityValue <= 0) return; // Only allocate equity to sectors

    const isFund = topCategory === 'Mutual Funds' || topCategory === 'ETFs';
    const type = (asset.type || '').toUpperCase();
    const isDirect = !isFund && (type === 'EQUITY' || type === 'STOCK');
    const nonEquity = Math.max(0, totalValue - equityValue);
    const sectors = isFund ? normalizeSectorWeightings(fundData?.sectorWeightings) : [];
    const sectorTotal = sectors.reduce((sum, sector) => sum + sector.percentage, 0);

    const fundCap = isFund ? (resolveFundCap(asset, fundData) || 'Diversified Equity') : null;
    const defaultCap = isDirect
      ? (resolveDirectCap(priceData, currentCurrency, usdToInr, asset.name) || 'Other / Uncategorized')
      : (fundCap || 'Other / Uncategorized');
    const capWeights = isFund
      ? resolveMarketCapWeights(fundData?.marketCapWeightage, fundCap)
      : [];

    const distributeSectorToCap = (sectorName: string, sectorValue: number) => {
      if (capWeights.length > 0) {
        capWeights.forEach(({ cap, weight }) => {
          if (weight <= 0) return;
          if (!sectorByMarketCap[cap]) sectorByMarketCap[cap] = {};
          sectorByMarketCap[cap][sectorName] =
            (sectorByMarketCap[cap][sectorName] || 0) + sectorValue * weight;
        });
      } else {
        if (!sectorByMarketCap[defaultCap]) sectorByMarketCap[defaultCap] = {};
        sectorByMarketCap[defaultCap][sectorName] =
          (sectorByMarketCap[defaultCap][sectorName] || 0) + sectorValue;
      }
    };

    if (sectors.length > 0 && sectorTotal > 0 && !asset.manualSector) {
      // Normalize to 100% of the equity sleeve. Upvaly's weights often sum to
      // the stock allocation (e.g. 94.9%) rather than 100%, while Yahoo's sum
      // to ~100%. Scaling to the sleeve prevents a phantom "Other" slice.
      const fullCoverage = sectorTotal >= 50;
      const scale = fullCoverage ? equityValue / sectorTotal : equityValue / 100;
      const coveredValue = sectors.reduce(
        (sum, sector) => sum + sector.percentage * scale,
        0,
      );

      sectors.forEach((sector) => {
        const value = sector.percentage * scale;
        if (value <= 0) return;

        const otherAllocations = sectors
          .filter((other) => other.sector !== sector.sector)
          .map((other) => ({ name: other.sector, value: other.percentage * scale }))
          .filter((other) => other.value > 0);
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToSector(sector.sector, value, false, asset.name, asset.symbol, otherAllocations);
        distributeSectorToCap(sector.sector, value);
      });

      const remainder = Math.max(0, equityValue - coveredValue);
      if (remainder > equityValue * 0.001) {
        const fallbackSector = inferFundSector(asset, fundData) || 'Diversified Equity';
        const otherAllocations = sectors.map((sector) => ({
          name: sector.sector,
          value: sector.percentage * scale,
        }));
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToSector(
          fallbackSector,
          remainder,
          false,
          `${asset.name} (unclassified equity)`,
          `${asset.symbol}-unclassified`,
          otherAllocations,
        );
        distributeSectorToCap(fallbackSector, remainder);
      }
      return;
    }

    const sectorName = asset.manualSector
      || (isFund ? inferFundSector(asset, fundData) : null)
      || priceData?.sector
      || 'Other / Uncategorized';

    addToSector(sectorName, equityValue, isDirect, asset.name, asset.symbol);
    distributeSectorToCap(sectorName, equityValue);
  });

  const sectorData = Object.entries(sectorAllocation)
    .filter(([_, data]) => data.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => ({ 
      name, 
      value: data.total,
      direct: data.direct,
      indirect: data.indirect,
      constituents: data.constituents
    }));

  const fundAllocation: Record<string, { total: number, constituents: { name: string, symbol: string, value: number, subHoldings?: {name: string, value: number}[] }[] }> = {};

  assets.forEach(asset => {
    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = resolveAssetCurrency(asset);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = resolveAssetCurrency(asset);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    const totalValue = currentPrice * asset.quantity;

    if (asset.type === 'MUTUALFUND' || asset.type === 'ETF') {
      if (!fundAllocation[asset.name]) {
        fundAllocation[asset.name] = { total: 0, constituents: [] };
      }
      fundAllocation[asset.name].total += totalValue;
      
      const fundData = fundHoldings[asset.symbol];
      console.log(`DEBUG: fundData for ${asset.symbol}:`, fundData);
      
      // Determine if holdingPercent is a fraction (0-1) or percentage (0-100)
      const totalHoldingPercent = fundData?.holdings?.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0) || 0;
      const isPercentageScale = totalHoldingPercent > 1.5; // Heuristic: if sum > 1.5, it's likely 0-100 scale

      const subHoldings = fundData?.holdings?.map((h: any) => {
        const percent = h.holdingPercent || 0;
        const normalizedPercent = isPercentageScale ? percent : percent * 100;
        const val = totalValue * normalizedPercent / 100;
        console.log(`DEBUG: Holding ${h.holdingName || h.symbol}: percent=${percent}, normalizedPercent=${normalizedPercent}, totalValue=${totalValue}, val=${val}`);
        return {
          name: h.holdingName || h.symbol,
          value: val
        };
      }) || [];
      console.log(`DEBUG: subHoldings for ${asset.symbol}:`, subHoldings);

      fundAllocation[asset.name].constituents.push({ 
        name: asset.name, 
        symbol: asset.symbol, 
        value: totalValue,
        subHoldings
      });
    }
  });

  const fundData = Object.entries(fundAllocation)
    .filter(([_, data]) => data.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => ({ 
      name, 
      value: data.total,
      constituents: data.constituents.map(c => ({
        name: c.name,
        symbol: c.symbol,
        value: c.value,
        subHoldings: c.subHoldings
      }))
    }));

  const treemapData = [
    {
      name: 'Portfolio',
      children: Object.entries(sectorByMarketCap).map(([cap, sectors]) => ({
        name: cap,
        children: Object.entries(sectors).map(([sector, value]) => ({
          name: sector,
          value: value
        })).filter(s => s.value > 0)
      })).filter(c => c.children && c.children.length > 0)
    }
  ];

  const stackedBarData = Object.entries(sectorByMarketCap).map(([cap, sectors]) => {
    const data: any = { name: cap };
    Object.entries(sectors).forEach(([sector, value]) => {
      data[sector] = value;
    });
    return data;
  }).filter(d => Object.keys(d).length > 1);

  const allSectors = Array.from(new Set(Object.values(sectorByMarketCap).flatMap(s => Object.keys(s))));
  console.log("DEBUG sectorByMarketCap:", JSON.stringify(sectorByMarketCap));
  console.log("DEBUG treemapData:", JSON.stringify(treemapData));
  console.log("DEBUG stackedBarData:", JSON.stringify(stackedBarData));
    
  // Check for discrepancies to ensure charts sum to exact Total Portfolio Value
  const totalAllocationValue = allocationData.reduce((sum, item) => sum + item.value, 0);
  const allocationDiscrepancy = portfolioStats.currentValue - totalAllocationValue;
  if (Math.abs(allocationDiscrepancy) > 1) {
    allocationData.push({ name: 'Uncategorized / Discrepancy', value: Math.max(0, allocationDiscrepancy) });
  }

  const topUnderlying = Object.values(underlyingExposure)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

    return {
      portfolioStats,
      totalProfitLoss,
      totalProfitLossPercent,
      allocationData,
      totalCurrentValue,
      allocationAnalysis,
      underlyingExposure,
      marketCapAllocation,
      sectorAllocation,
      fundAllocation,
      treemapData,
      stackedBarData,
      allSectors,
      topUnderlying,
      marketCapData,
      sectorData,
      fundData,
      allCategories,
      consolidatedAllocation,
      totalAllocationValue
    };
  }, [mergedAssets, assets, prices, fundHoldings, idealAllocation, usdToInr, isSmallCrypto]);

  const CustomXAxisTick = useMemo(() => {
    return (props: any) => {
      const { x, y, payload } = props;
      if (!payload || !payload.value) return null;
      const capData = calculations.stackedBarData.find(d => d.name === payload.value);
      const capTotal = capData ? Object.entries(capData).reduce((sum, [key, val]) => key !== 'name' ? sum + (val as number) : sum, 0) : 0;
      const percent = calculations.totalAllocationValue > 0 ? ((capTotal / calculations.totalAllocationValue) * 100).toFixed(1) : '0.0';

      return React.createElement('g', { transform: `translate(${x},${y})` },
        React.createElement('text', { x: 0, y: 0, dy: 16, textAnchor: 'middle', fill: '#6b7280', fontSize: 12, fontWeight: 600 }, payload.value),
        React.createElement('text', { x: 0, y: 0, dy: 32, textAnchor: 'middle', fill: '#9ca3af', fontSize: 11, fontWeight: 500 }, `${formatCompact(capTotal)} (${percent}%)`)
      );
    };
  }, [calculations.stackedBarData, calculations.totalAllocationValue]);

  return {
    usdToInr,
    isSmallCrypto,
    ...calculations,
    CustomXAxisTick
  };
}
