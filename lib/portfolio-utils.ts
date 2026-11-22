import { Asset } from './types';

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
  if (currency === 'GBp') return (price / 100) * 105; // Approx GBP to INR
  return price;
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
  const combined = `${lowerName} ${lowerCat}`;

  // A large+mid blend is not a single cap bucket. Let the caller fall back to
  // the fund's actual market-cap weights or a generic equity category.
  if (/large\s*&?\s*mid|large\s*midcap|mid\s*&?\s*large/.test(combined)) return null;

  if (lowerName.includes('small') || lowerCat.includes('small')) return 'Small Cap';
  if (lowerName.includes('mid') || lowerCat.includes('mid')) return 'Mid Cap';
  
  if (
    lowerName.includes('large') || lowerCat.includes('large') || 
    lowerName.includes('bluechip') || lowerCat.includes('bluechip') || 
    lowerName.includes('nifty 50') || lowerName.includes('nifty50') ||
    lowerName.includes('sensex') || lowerName.includes('nifty bees') || 
    lowerName.includes('alphaetf') || lowerName.includes('alpha 50') ||
    lowerName.includes('nifty 100') || lowerName.includes('next 50') ||
    lowerName.includes('nasdaq') || lowerName.includes('s&p') ||
    lowerName.includes('s&p 500') || lowerName.includes('s&p500')
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

export type MarketCapCategory = 'Large Cap' | 'Mid Cap' | 'Small Cap';

export const isMarketCapCategory = (value: unknown): value is MarketCapCategory =>
  value === 'Large Cap' || value === 'Mid Cap' || value === 'Small Cap';

/**
 * Indian market-cap buckets use the same USD thresholds as the rest of the
 * app. `capCategory` is preferred when a provider publishes an authoritative
 * index classification, because provider market-cap values occasionally come
 * back in the wrong currency (Google Finance does this for HDFCBANK).
 */
export const marketCapCategoryFromValue = (
  marketCap?: number | null,
  currency?: string | null,
  usdToInr = 83,
): MarketCapCategory | null => {
  if (marketCap == null || !Number.isFinite(marketCap) || marketCap <= 0) return null;
  const capInUsd = currency === 'INR' ? marketCap / usdToInr : marketCap;
  if (capInUsd >= 10_000_000_000) return 'Large Cap';
  if (capInUsd >= 2_000_000_000) return 'Mid Cap';
  return 'Small Cap';
};

const YAHOO_SECTOR_LABELS: Record<string, string> = {
  technology: 'Technology',
  communication_services: 'Communication Services',
  consumer_cyclical: 'Consumer Cyclical',
  consumer_defensive: 'Consumer Defensive',
  basic_materials: 'Basic Materials',
  financial_services: 'Financial Services',
  realestate: 'Real Estate',
  real_estate: 'Real Estate',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
};

/**
 * Providers use different taxonomies: Yahoo/GICS says "Financial Services"
 * and "Consumer Cyclical", while Upvaly/Morningstar says "Financials" and
 * "Consumer Discretionary". Without this alias table the same sector appears
 * twice in the Insights charts.
 */
const SECTOR_ALIASES: Record<string, string> = {
  financial: 'Financial Services',
  financials: 'Financial Services',
  'financial services': 'Financial Services',
  'information technology': 'Technology',
  technology: 'Technology',
  'technology services': 'Technology',
  'electronic technology': 'Technology',
  'consumer discretionary': 'Consumer Cyclical',
  'consumer cyclical': 'Consumer Cyclical',
  'consumer staples': 'Consumer Defensive',
  'consumer defensive': 'Consumer Defensive',
  'consumer non-durables': 'Consumer Defensive',
  'consumer durables': 'Consumer Cyclical',
  materials: 'Basic Materials',
  'basic materials': 'Basic Materials',
  'process industries': 'Basic Materials',
  'non-energy minerals': 'Basic Materials',
  'health care': 'Healthcare',
  healthcare: 'Healthcare',
  'health technology': 'Healthcare',
  'aerospace & defense': 'Industrials',
  'aerospace and defense': 'Industrials',
  industrials: 'Industrials',
  'producer manufacturing': 'Industrials',
  'commercial services': 'Industrials',
  'industrial services': 'Industrials',
  transportation: 'Industrials',
  'communication services': 'Communication Services',
  'telecommunication services': 'Communication Services',
  telecom: 'Communication Services',
  energy: 'Energy',
  'energy minerals': 'Energy',
  utilities: 'Utilities',
  'real estate': 'Real Estate',
};

const canonicalSectorLabel = (label: string): string => {
  const trimmed = label.trim();
  if (!trimmed) return '';
  return SECTOR_ALIASES[trimmed.toLowerCase()] || trimmed;
};

const sectorLabel = (key: string) =>
  canonicalSectorLabel(
    YAHOO_SECTOR_LABELS[key.toLowerCase()] ||
      key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
  );

/**
 * Sector weights arrive in two shapes:
 *   - Upvaly: `{ sector: "Financial Services", percentage: 35.27 }`
 *   - Yahoo:  `{ financial_services: 0.3527 }`
 *
 * Yahoo values are fractions; Upvaly values are percentages. Normalize both to
 * percentages and merge duplicate sector labels. Invalid cached entries such as
 * `{ percentage: null }` are dropped so they cannot become a phantom "Other"
 * slice.
 */
export const normalizeSectorWeightings = (
  raw: unknown,
): { sector: string; percentage: number }[] => {
  if (!Array.isArray(raw)) return [];

  const explicit: { sector: string; percentage: number }[] = [];
  const keyed: { sector: string; percentage: number }[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;

    if (typeof (entry as any).sector === 'string' && (entry as any).sector.trim()) {
      const percentage = Number((entry as any).percentage);
      if (Number.isFinite(percentage) && percentage > 0) {
        explicit.push({
          sector: canonicalSectorLabel((entry as any).sector),
          percentage,
        });
      }
      continue;
    }

    for (const [key, value] of Object.entries(entry)) {
      const weight = Number(value);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      keyed.push({ sector: sectorLabel(key), percentage: weight });
    }
  }

  // A provider that sends fractions will have a total near 1. A provider that
  // sends percentages will have a total near 100.
  const explicitSum = explicit.reduce((sum, item) => sum + item.percentage, 0);
  const keyedSum = keyed.reduce((sum, item) => sum + item.percentage, 0);
  const explicitScale = explicitSum > 0 && explicitSum <= 1.5 ? 100 : 1;
  const keyedScale = keyedSum > 0 && keyedSum <= 1.5 ? 100 : 1;

  const merged = new Map<string, number>();
  for (const item of explicit) {
    merged.set(item.sector, (merged.get(item.sector) || 0) + item.percentage * explicitScale);
  }
  for (const item of keyed) {
    merged.set(item.sector, (merged.get(item.sector) || 0) + item.percentage * keyedScale);
  }

  return Array.from(merged.entries())
    .map(([sector, percentage]) => ({
      sector,
      percentage: Number(percentage.toFixed(2)),
    }))
    .filter((item) => item.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);
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

const STABLECOIN_BASES = new Set([
  'USDT',
  'USDC',
  'BUSD',
  'FDUSD',
  'TUSD',
  'DAI',
  'USDP',
  'PYUSD',
  'USDD',
  'GUSD',
]);

export type ExchangeAssetInput = Partial<Asset> & {
  currentPrice?: number;
  exchange?: string;
};

/**
 * Exchange integrations historically emitted pairs such as `BTC/USDT` and
 * `USDT/USDT`. Normalize those to the same `-USD` convention used by manually
 * saved crypto so the two sources merge into one holding and share price keys.
 *
 * Fiat balances (CoinDCX INR) are cash, not crypto. Stablecoins are quoted at
 * their peg because markets such as `USDT/USDT` do not exist.
 */
export function normalizeExchangeAsset(raw: ExchangeAssetInput, exchangeName?: string): Asset {
  const rawSymbol = typeof raw.symbol === 'string' ? raw.symbol : '';
  const base = (rawSymbol.split(/[\/-]/)[0] || raw.name || '').toUpperCase();
  const isInr = base === 'INR';
  const isStablecoin = STABLECOIN_BASES.has(base);
  const reportedPrice = Number(raw.currentPrice);
  const currentPrice = isInr || isStablecoin
    ? 1
    : Number.isFinite(reportedPrice) && reportedPrice > 0
      ? reportedPrice
      : 0;
  const exchange = raw.exchange || exchangeName || 'Exchange';

  return {
    ...raw,
    id: raw.id || `${exchange.toLowerCase()}-${base}`,
    symbol: isInr ? 'INR' : `${base}-USD`,
    name: raw.name || base,
    quantity: Number(raw.quantity) || 0,
    type: isInr ? 'CASH' : 'CRYPTO',
    currency: isInr ? 'INR' : 'USD',
    currentPrice,
    // Exchanges do not provide cost basis. Using the first-seen price keeps
    // P&L neutral instead of reporting the entire value as profit.
    entryPrice: Number(raw.entryPrice) > 0 ? Number(raw.entryPrice) : currentPrice,
    exchange,
  };
}

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
