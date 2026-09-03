import { Asset, PriceData } from './types';
import { GBP_TO_INR_APPROX, USDINR_FALLBACK } from './constants';

export const guessCurrency = (symbol: string) => {
  if (!symbol || typeof symbol !== 'string') return 'INR';
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.NS') || upper.endsWith('.BO')) return 'INR';
  if (upper.endsWith('.L')) return 'GBp';
  if (upper.includes('-INR')) return 'INR'; // Explicitly catch GOLD-INR-GRAM, SILVER-INR-GRAM, CASH-INR
  if (upper.includes('-USD')) return 'USD'; // Explicit crypto USD
  if (upper.includes('-')) return 'USD'; // Other crypto usually USD
  // Default to INR instead of USD when adding asset
  return 'INR';
};

export const getConvertedPrice = (price: number, currency: string, usdToInr: number) => {
  if (currency === 'USD') return price * usdToInr;
  if (currency === 'GBp') return (price / 100) * GBP_TO_INR_APPROX;
  return price;
};

// SRP: centralize price+currence resolution (was copy-pasted 3+ times in usePortfolioCalculations & Dashboard)
export const resolveCurrentPrice = (
  asset: Asset,
  prices: Record<string, PriceData>,
  usdToInr: number,
): { currentPrice: number; currentPriceRaw: number; currentCurrency: string } => {
  const priceData = prices[asset.symbol];
  const hasPrice = priceData?.regularMarketPrice != null;
  const currentPriceRaw =
    asset.manualPrice !== undefined ? asset.manualPrice : hasPrice ? priceData.regularMarketPrice : asset.entryPrice;

  let currentCurrency: string;
  if (asset.manualPrice !== undefined) {
    currentCurrency = asset.currency || guessCurrency(asset.symbol);
  } else if (hasPrice) {
    currentCurrency = priceData.currency || guessCurrency(asset.symbol);
    if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
  } else {
    currentCurrency = asset.currency || guessCurrency(asset.symbol);
  }

  return { currentPrice: getConvertedPrice(currentPriceRaw as number, currentCurrency, usdToInr), currentPriceRaw: currentPriceRaw as number, currentCurrency };
};

// Helper for market-cap category from price data (DIP: hides threshold constants)
export const getMarketCapCategory = (marketCap?: number, currency?: string, usdToInr: number = USDINR_FALLBACK): string | null => {
  if (!marketCap) return null;
  const capInUsd = currency === 'INR' ? marketCap / usdToInr : marketCap;
  if (capInUsd >= 10_000_000_000) return 'Large Cap';
  if (capInUsd >= 2_000_000_000) return 'Mid Cap';
  return 'Small Cap';
};

export const normalizeCategory = (category?: string) => {
  if (!category) return 'Unknown';
  if (category.includes('>')) return category;
  const upper = category.toUpperCase().trim();
  if (upper === 'EQUITY' || upper === 'STOCK') return 'Equities';
  if (upper === 'DOMESTIC EQUITY' || upper === 'GLOBAL EQUITY') return upper.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  if (upper === 'MUTUALFUND') return 'Mutual Funds';
  if (upper === 'ETF') return 'ETFs';
  if (upper === 'CRYPTOCURRENCY' || upper === 'CRYPTO') return 'Crypto';
  if (upper === 'DEBT' || upper === 'FIXED INCOME' || upper === 'BOND' || upper === 'BONDS') return 'Fixed Income';
  if (upper.includes('CASH')) return 'Cash';
  if (upper === 'GOLD' || upper === 'SILVER' || upper === 'COMMODITY' || upper === 'COMMODITIES') return 'Commodities';
  return category;
};

export const getCommoditySubCategory = (asset: { name: string; symbol: string }) => {
  const name = (asset.name || '').toLowerCase();
  const symbol = (asset.symbol || '').toLowerCase();
  if (name.includes('gold') || symbol.includes('gold')) return 'Gold';
  if (name.includes('silver') || symbol.includes('silver')) return 'Silver';
  return 'Other Commodities';
};

export const getCapCategory = (name: string, categoryName?: string) => {
  const lowerName = (name || '').toLowerCase();
  const lowerCat = (categoryName || '').toLowerCase();
  if (lowerName.includes('small') || lowerCat.includes('small')) return 'Small Cap';
  if (lowerName.includes('mid') || lowerCat.includes('mid')) return 'Mid Cap';
  
  if (
    lowerName.includes('large') || lowerCat.includes('large') || 
    lowerName.includes('bluechip') || lowerCat.includes('bluechip') || 
    lowerName.includes('nifty 50') || lowerName.includes('nifty50') ||
    lowerName.includes('sensex') || lowerName.includes('nifty bees') || 
    lowerName.includes('alphaetf') || lowerName.includes('alpha 50') ||
    lowerName.includes('nifty 100') || lowerName.includes('next 50')
  ) return 'Large Cap';
  
  if (
    lowerName.includes('flexi') || lowerCat.includes('flexi') ||
    lowerName.includes('nifty 200') || lowerName.includes('nifty 500') ||
    lowerName.includes('alpha 30') || lowerName.includes('momentum') ||
    lowerName.includes('value') || lowerName.includes('factor')
  ) return 'Flexi Cap';
  
  if (lowerName.includes('multi') || lowerCat.includes('multi')) return 'Multi Cap';
  if (lowerName.includes('elss') || lowerCat.includes('elss') || lowerName.includes('tax') || lowerCat.includes('tax')) return 'ELSS';
  
  return null;
};

const KNOWN_CASINGS: Record<string, string> = {
  'equities': 'Equities',
  'domestic equity': 'Domestic Equity',
  'global equity': 'Global Equity',
  'fixed income': 'Fixed Income',
  'cash': 'Cash',
  'commodities': 'Commodities',
  'gold': 'Gold',
  'silver': 'Silver',
  'crypto': 'Crypto',
  'large cap': 'Large Cap',
  'mid cap': 'Mid Cap',
  'small cap': 'Small Cap',
  'mutual funds': 'Mutual Funds',
  'etfs': 'ETFs',
  'other / uncategorized': 'Other / Uncategorized'
};

export const normalizeGroup = (cat: string) => {
  if (!cat) return '';
  return cat.split('>').map(part => {
    const trimmed = part.trim();
    return KNOWN_CASINGS[trimmed.toLowerCase()] || trimmed;
  }).join(' > ');
};

export const formatCompact = (val: number) => {
  if (val === undefined || val === null) return '₹0';
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
  return `₹${val.toFixed(0)}`;
};

export const getBaseCryptoSymbol = (symbol: string) => {
  if (typeof symbol === 'string' && symbol.includes('-')) {
    const parts = symbol.split('-');
    if (['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD'].includes(parts[parts.length - 1])) {
      return parts.slice(0, -1).join('-');
    }
  }
  return symbol;
};

export const isSameCrypto = (symbol1: string, symbol2: string, type1: string, type2?: string) => {
  const isCrypto1 = type1 === 'CRYPTOCURRENCY' || type1 === 'CRYPTO';
  const isCrypto2 = type2 === 'CRYPTOCURRENCY' || type2 === 'CRYPTO' || (!type2 && (symbol2.includes('-USD') || symbol2.includes('-INR')));
  
  if (!isCrypto1 && !isCrypto2) return false;
  
  const base1 = getBaseCryptoSymbol(symbol1);
  const base2 = getBaseCryptoSymbol(symbol2);
  
  return base1 === base2 && base1 !== symbol1 && base2 !== symbol2;
};
