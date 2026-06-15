import React, { useMemo } from 'react';
import { Asset, PriceData } from '@/lib/types';
import { normalizeCategory, getCommoditySubCategory, guessCurrency, getConvertedPrice, getCapCategory, normalizeGroup, formatCompact } from '@/lib/portfolio-utils';

interface UsePortfolioCalculationsParams {
  mergedAssets: Asset[];
  assets: Asset[];
  prices: Record<string, PriceData>;
  fundHoldings: Record<string, any>;
  idealAllocation: Record<string, number>;
}

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
        currentCurrency = asset.currency || guessCurrency(asset.symbol);
      } else if (hasPrice) {
        currentCurrency = priceData.currency || guessCurrency(asset.symbol);
        if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
      } else {
        currentCurrency = asset.currency || guessCurrency(asset.symbol);
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
      acc.byCategory[category] = { quantity: 0, currentValue: 0, investedValue: 0 };
    }

    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    
    let assetCurrency = asset.currency || guessCurrency(asset.symbol);
    const entryPriceConverted = getConvertedPrice(asset.entryPrice, assetCurrency, usdToInr);
    
    const currentValue = currentPrice * asset.quantity;
    const investedValue = entryPriceConverted * asset.quantity;
    
    acc.currentValue += currentValue;
    acc.investedValue += investedValue;
    
    acc.byCategory[category].quantity += asset.quantity;
    acc.byCategory[category].currentValue += currentValue;
    acc.byCategory[category].investedValue += investedValue;

    if (isSmallCrypto(asset)) {
      acc.smallCryptoStats.quantity += asset.quantity;
      acc.smallCryptoStats.currentValue += currentValue;
      acc.smallCryptoStats.investedValue += investedValue;
    }
    
    return acc;
  }, { currentValue: 0, investedValue: 0, byCategory: {} as Record<string, { quantity: number; currentValue: number; investedValue: number; }>, smallCryptoStats: { quantity: 0, currentValue: 0, investedValue: 0 } });

  const totalProfitLoss = portfolioStats.currentValue - portfolioStats.investedValue;
  const totalProfitLossPercent = portfolioStats.investedValue > 0 ? (totalProfitLoss / portfolioStats.investedValue) * 100 : 0;

  const allocationData = mergedAssets.reduce((acc: any[], asset) => {
    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    const value = currentPrice * asset.quantity;
    
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETF') && fundHoldings[asset.symbol]?.assetAllocation) {
      const alloc = fundHoldings[asset.symbol].assetAllocation;
      const totalAlloc = (alloc.stockPosition || 0) + (alloc.bondPosition || 0) + (alloc.cashPosition || 0) + (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0);
      
      if (totalAlloc > 0) {
        const addValue = (cat: string, pct: number) => {
          if (pct <= 0) return;
          const normalizedPct = pct / totalAlloc;
          const val = value * normalizedPct;
          const existing = acc.find(item => item.name.trim() === cat.trim());
          if (existing) {
            existing.value += val;
            existing.constituents = existing.constituents || [];
            existing.constituents.push({ name: asset.name, symbol: asset.symbol, value: val });
          } else {
            acc.push({ name: cat.trim(), value: val, constituents: [{ name: asset.name, symbol: asset.symbol, value: val }] });
          }
        };
        
        addValue('Equities', alloc.stockPosition || 0);
        addValue('Fixed Income', alloc.bondPosition || 0);
        addValue('Cash', alloc.cashPosition || 0);
        addValue('Other', (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0));
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
      finalCategory = isDomestic(asset) ? 'Domestic Equity' : 'Global Equity';
    }
    
    if (finalCategory === 'Mutual Funds') {
      const catName = (fundHoldings[asset.symbol]?.categoryName || '').toLowerCase();
      if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
        finalCategory = 'Fixed Income';
      } else {
        const assetName = (asset.name || '').toLowerCase();
        const isGlobalFund = assetName.includes('off-shore') || assetName.includes('china') || assetName.includes('global') || assetName.includes('international');
        finalCategory = isGlobalFund ? 'Global Equity' : 'Domestic Equity';
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

  const allCategories = Array.from(new Set([
    ...Object.keys(consolidatedAllocation),
    ...allocationData.map(item => normalizeGroup(item.name))
  ]));

  // Pre-calculate the effective ideal percentages (supporting relative sub-category percentages)
  const effectiveIdeal: Record<string, number> = {};
  allCategories.forEach(categoryStr => {
    const [parentName, subName] = categoryStr.includes(' > ') ? categoryStr.split(' > ') : [categoryStr, null];
    
    if (subName) {
      const parentRawIdeal = consolidatedAllocation[parentName] || 0;
      const rawCurrentIdeal = consolidatedAllocation[categoryStr] || 0;
      if (parentRawIdeal > 0) {
        effectiveIdeal[categoryStr] = (rawCurrentIdeal / 100) * parentRawIdeal;
      } else {
        effectiveIdeal[categoryStr] = rawCurrentIdeal;
      }
    } else {
      effectiveIdeal[categoryStr] = consolidatedAllocation[categoryStr] || 0;
    }
  });

  // Group categories to handle sub-categories (e.g., 'Commodities > Gold')
  const groupedAnalysis: Record<string, any> = {};
  
  allCategories.forEach(categoryStr => {
    const [parentName, subName] = categoryStr.includes(' > ') ? categoryStr.split(' > ') : [categoryStr, null];
    
    if (!groupedAnalysis[parentName]) {
      groupedAnalysis[parentName] = {
        category: parentName,
        currentValue: 0,
        currentPercentage: 0,
        idealPercentage: consolidatedAllocation[parentName] || 0,
        diffPercentage: 0,
        diffValue: 0,
        constituents: [],
        subCategories: [],
        isParent: true,
      };
    }
    
    const matchingItems = allocationData.filter(item => normalizeGroup(item.name) === categoryStr);
    const currentValue = matchingItems.reduce((sum, item) => sum + item.value, 0);
    const currentConstituents = matchingItems.flatMap(item => item.constituents || []);
    
    const currentPercentage = totalCurrentValue > 0 ? (currentValue / totalCurrentValue) * 100 : 0;
    const idealPercentage = effectiveIdeal[categoryStr] || 0;
    
    if (subName) {
      // It's a sub-category
      groupedAnalysis[parentName].subCategories.push({
        category: subName,
        currentValue,
        currentPercentage,
        idealPercentage,
        diffPercentage: currentPercentage - idealPercentage,
        diffValue: ((currentPercentage - idealPercentage) / 100) * totalCurrentValue,
        constituents: currentConstituents
      });
      // Add to parent totals
      groupedAnalysis[parentName].currentValue += currentValue;
      groupedAnalysis[parentName].currentPercentage += currentPercentage;
      
      // If parent didn't have an explicit ideal percentage, accumulate from children
      if (!(consolidatedAllocation[parentName] > 0)) {
        groupedAnalysis[parentName].idealPercentage += idealPercentage;
      }
    } else {
      // It's a parent category (or a standalone category without >)
      groupedAnalysis[parentName].currentValue += currentValue;
      groupedAnalysis[parentName].currentPercentage += currentPercentage;
      
      if (currentConstituents.length > 0) {
        groupedAnalysis[parentName].constituents.push(...currentConstituents);
      }
    }
  });

  // Convert map to sorted array
  const allocationAnalysisTemp = Object.values(groupedAnalysis).map(item => {
    item.diffPercentage = item.currentPercentage - item.idealPercentage;
    item.diffValue = (item.diffPercentage / 100) * totalCurrentValue;
    return item;
  }).sort((a, b) => b.currentValue - a.currentValue);


  const domesticEquity = allocationAnalysisTemp.find(a => a.category === 'Domestic Equity');
  const globalEquity = allocationAnalysisTemp.find(a => a.category === 'Global Equity');
  
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
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    const totalValue = currentPrice * asset.quantity;

    const fundData = fundHoldings[asset.symbol];
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    
    if (holdings && holdings.length > 0) {
      let accountedPercent = 0;
      let totalHoldingPercent = holdings.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0);
      let isPercentageScale = totalHoldingPercent > 1.5;

      holdings.forEach((h: any) => {
        const percentRaw = h.holdingPercent || 0;
        const percent = isPercentageScale ? percentRaw / 100 : percentRaw;
        accountedPercent += percent;
        const value = totalValue * percent;
        
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
          value: totalValue * remainingPercent,
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
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    const totalValue = currentPrice * asset.quantity;

    // 1. Determine the Equity portion of this asset (matching Asset Allocation logic)
    let equityValue = 0;
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    const fundData = fundHoldings[asset.symbol];
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETF') && fundData?.assetAllocation) {
      const alloc = fundData.assetAllocation;
      const totalAlloc = (alloc.stockPosition || 0) + (alloc.bondPosition || 0) + (alloc.cashPosition || 0) + (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0);
      if (totalAlloc > 0) {
        equityValue = totalValue * ((alloc.stockPosition || 0) / totalAlloc);
      }
    } else {
      let finalCategory = topCategory;
      if (finalCategory === 'Mutual Funds') {
        const catName = (fundData?.categoryName || '').toLowerCase();
        if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
          finalCategory = 'Fixed Income';
        } else {
          finalCategory = 'Equities';
        }
      }
      if (finalCategory === 'Equities') {
        equityValue = totalValue;
      }
    }

    if (equityValue <= 0) return;

    // 2. Distribute the Equity value across Market Caps
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    
    if (holdings && holdings.length > 0) {
      let mappedHoldingsValue = 0;
      let totalHoldingPercent = holdings.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0);
      let isPercentageScale = totalHoldingPercent > 1.5;

      const fundCapExposure: Record<string, { total: number, holdings: {name: string, value: number}[] }> = {};

      holdings.forEach((h: any) => {
        const percentRaw = h.holdingPercent || 0;
        const percent = isPercentageScale ? percentRaw / 100 : percentRaw;
        const holdingValue = totalValue * percent;
        
        // Only map equity holdings
        const hPriceData = prices[h.symbol];
        let cap = 'Other / Uncategorized';
        if (hPriceData?.marketCap) {
          const hCurrency = hPriceData.currency || 'INR';
          const capInUsd = hCurrency === 'INR' ? hPriceData.marketCap / usdToInr : hPriceData.marketCap;
          if (capInUsd >= 10_000_000_000) cap = 'Large Cap';
          else if (capInUsd >= 2_000_000_000) cap = 'Mid Cap';
          else cap = 'Small Cap';
        } else {
          const cat = getCapCategory(h.holdingName);
          if (cat) cap = cat;
        }

        if (!fundCapExposure[cap]) fundCapExposure[cap] = { total: 0, holdings: [] };
        fundCapExposure[cap].total += holdingValue;
        fundCapExposure[cap].holdings.push({ name: h.holdingName || h.symbol, value: holdingValue });
        
        mappedHoldingsValue += holdingValue;
      });

      const nonEquity = totalValue - equityValue;

      Object.entries(fundCapExposure).forEach(([cap, data]) => {
        const otherAllocations: {name: string, value: number}[] = [];
        Object.entries(fundCapExposure).forEach(([otherCap, otherData]) => {
          if (otherCap !== cap && otherData.total > 0) {
            otherAllocations.push({ name: otherCap, value: otherData.total });
          }
        });
        const unmappedEquity = Math.max(0, equityValue - mappedHoldingsValue);
        if (unmappedEquity > 0) otherAllocations.push({ name: 'Unmapped Equity', value: unmappedEquity });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap(cap, data.total, false, asset.name, asset.symbol, data.holdings, otherAllocations);
      });

      // Any remaining equity value that wasn't mapped via holdings goes to Uncategorized
      const unmappedEquity = Math.max(0, equityValue - mappedHoldingsValue);
      if (unmappedEquity > 0) {
        const otherAllocations: {name: string, value: number}[] = [];
        Object.entries(fundCapExposure).forEach(([otherCap, otherData]) => {
          if (otherData.total > 0) otherAllocations.push({ name: otherCap, value: otherData.total });
        });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap('Other / Uncategorized', unmappedEquity, false, `Unmapped Equity (${asset.name})`, `${asset.symbol}-unmapped`, undefined, otherAllocations);
      }
    } else {
      // Direct stock or fund with no holdings data
      let cap = 'Other / Uncategorized';
      const type = (asset.type || '').toUpperCase();
      const isDirect = type === 'EQUITY' || type === 'STOCK';
      
      if (priceData?.marketCap) {
        const capInUsd = currentCurrency === 'INR' ? priceData.marketCap / usdToInr : priceData.marketCap;
        if (capInUsd >= 10_000_000_000) cap = 'Large Cap';
        else if (capInUsd >= 2_000_000_000) cap = 'Mid Cap';
        else cap = 'Small Cap';
      } else {
        const cat = getCapCategory(asset.name, fundData?.categoryName);
        if (cat) cap = cat;
      }
      addToMarketCap(cap, equityValue, isDirect, asset.name, asset.symbol);
    }
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
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
    
    let currentCurrency;
    if (asset.manualPrice !== undefined) {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
    const totalValue = currentPrice * asset.quantity;

    // 1. Determine the Equity portion of this asset
    let equityValue = 0;
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    const fundData = fundHoldings[asset.symbol];
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETF') && fundData?.assetAllocation) {
      const alloc = fundData.assetAllocation;
      const totalAlloc = (alloc.stockPosition || 0) + (alloc.bondPosition || 0) + (alloc.cashPosition || 0) + (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0);
      if (totalAlloc > 0) {
        equityValue = totalValue * ((alloc.stockPosition || 0) / totalAlloc);
      }
    } else {
      let finalCategory = topCategory;
      if (finalCategory === 'Mutual Funds') {
        const catName = (fundData?.categoryName || '').toLowerCase();
        if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
          finalCategory = 'Fixed Income';
        } else {
          finalCategory = 'Equities';
        }
      }
      if (finalCategory === 'Equities') {
        equityValue = totalValue;
      }
    }

    if (equityValue <= 0) return; // Only allocate equity to sectors

    const sectors = fundData?.sectorWeightings || [];
    
    // Determine cap category for this asset
    let cap = 'Other / Uncategorized';
    const type = (asset.type || '').toUpperCase();
    if (type === 'EQUITY' || type === 'STOCK') {
       if (priceData?.marketCap) {
         const capInUsd = priceData.currency === 'INR' ? priceData.marketCap / usdToInr : priceData.marketCap;
         if (capInUsd >= 10_000_000_000) cap = 'Large Cap';
         else if (capInUsd >= 2_000_000_000) cap = 'Mid Cap';
         else cap = 'Small Cap';
       } else {
         cap = getCapCategory(asset.name) || 'Other / Uncategorized';
       }
    } else if (type === 'MUTUALFUND' || type === 'ETF') {
       cap = getCapCategory(asset.name, fundData?.categoryName) || 'Other / Uncategorized';
    }

    let defaultCap = 'Other / Uncategorized';
    if (type === 'EQUITY' || type === 'STOCK') {
       if (priceData?.marketCap) {
         const capInUsd = currentCurrency === 'INR' ? priceData.marketCap / usdToInr : priceData.marketCap;
         if (capInUsd >= 10_000_000_000) defaultCap = 'Large Cap';
         else if (capInUsd >= 2_000_000_000) defaultCap = 'Mid Cap';
         else defaultCap = 'Small Cap';
       } else {
         defaultCap = getCapCategory(asset.name) || 'Other / Uncategorized';
       }
    } else {
       defaultCap = getCapCategory(asset.name, fundData?.categoryName) || 'Other / Uncategorized';
    }

    const distributeSectorToCap = (sName: string, sValue: number) => {
      const mcap = fundData?.marketCapWeightage;
      const isLikelyETF = type === 'ETF' || (asset.name || '').toLowerCase().includes('etf') || (asset.name || '').toLowerCase().includes('bees') || (asset.symbol || '').toLowerCase().includes('bees') || (asset.symbol || '').toLowerCase().includes('alpha');
      const isDirectLoc = (type === 'EQUITY' || type === 'STOCK') && !isLikelyETF;

      if (!isDirectLoc && mcap && (Number(mcap.largeCap) > 0 || Number(mcap.midCap) > 0 || Number(mcap.smallCap) > 0)) {
        const large = Number(mcap.largeCap) || 0;
        const mid = Number(mcap.midCap) || 0;
        const small = Number(mcap.smallCap) || 0;
        const others = Number(mcap.others) || 0;
        const totalWeight = large + mid + small + others;
        
        const add = (c: string, weight: number) => {
          if (weight <= 0) return;
          if (!sectorByMarketCap[c]) sectorByMarketCap[c] = {};
          sectorByMarketCap[c][sName] = (sectorByMarketCap[c][sName] || 0) + sValue * (weight / totalWeight);
        };
        add('Large Cap', large);
        add('Mid Cap', mid);
        add('Small Cap', small);
        add('Other / Uncategorized', others);
      } else {
        if (!sectorByMarketCap[defaultCap]) sectorByMarketCap[defaultCap] = {};
        sectorByMarketCap[defaultCap][sName] = (sectorByMarketCap[defaultCap][sName] || 0) + sValue;
      }
    };

    if (sectors.length > 0 && !asset.manualSector) {
      let mappedSectorValue = 0;
      sectors.forEach((s: any) => {
        mappedSectorValue += equityValue * ((s.percentage || 0) / 100);
      });
      
      const unmappedSector = Math.max(0, equityValue - mappedSectorValue);
      const nonEquity = totalValue - equityValue;

      sectors.forEach((s: any) => {
        const sectorName = s.sector || 'Other';
        const percent = (s.percentage || 0) / 100;
        const val = equityValue * percent;

        const otherAllocations: {name: string, value: number}[] = [];
        sectors.forEach((otherS: any) => {
          const otherSectorName = otherS.sector || 'Other';
          if (otherSectorName !== sectorName) {
            const otherVal = equityValue * ((otherS.percentage || 0) / 100);
            if (otherVal > 0) otherAllocations.push({ name: otherSectorName, value: otherVal });
          }
        });
        if (unmappedSector > 0) otherAllocations.push({ name: 'Unmapped Equity', value: unmappedSector });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToSector(sectorName, val, false, asset.name, asset.symbol, otherAllocations);
        distributeSectorToCap(sectorName, val);
      });

      if (unmappedSector > 0) {
        const sectorName = 'Other / Uncategorized';
        const otherAllocations: {name: string, value: number}[] = [];
        sectors.forEach((otherS: any) => {
          const otherVal = equityValue * ((otherS.percentage || 0) / 100);
          if (otherVal > 0) otherAllocations.push({ name: otherS.sector || 'Other', value: otherVal });
        });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToSector(sectorName, unmappedSector, false, `Unmapped Equity (${asset.name})`, `${asset.symbol}-unmapped`, otherAllocations);
        distributeSectorToCap(sectorName, unmappedSector);
      }
    } else {
      const sectorName = asset.manualSector || prices[asset.symbol]?.sector || 'Other / Uncategorized';
      const isLikelyETF = type === 'ETF' || (asset.name || '').toLowerCase().includes('etf') || (asset.name || '').toLowerCase().includes('bees') || (asset.symbol || '').toLowerCase().includes('bees') || (asset.symbol || '').toLowerCase().includes('alpha');
      const isDirectLoc = (type === 'EQUITY' || type === 'STOCK') && !isLikelyETF;
      addToSector(sectorName, equityValue, isDirectLoc, asset.name, asset.symbol);
      distributeSectorToCap(sectorName, equityValue);
    }
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
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    } else if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
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
