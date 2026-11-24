import { STABLECOIN_BASES } from './crypto';
import type {
  Asset,
  FundSectorWeighting,
  MarketCapCategory,
  PriceData,
} from './types';

export const CATEGORY_COLORS = [
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
] as const;

/** Type guard for the three cap buckets used by the exposure analytics. */
export function isMarketCapCategory(value: unknown): value is MarketCapCategory {
  return value === 'Large Cap' || value === 'Mid Cap' || value === 'Small Cap';
}

/**
 * Providers use different taxonomies for the same sector: Tickertape says
 * "Financials" / "Information Technology", Upvaly says "Financial Services" /
 * "Technology". Without folding aliases the sector chart shows parallel slices
 * for the same exposure.
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

export function canonicalSectorLabel(label: string): string {
  const trimmed = (label || '').trim();
  if (!trimmed) return '';
  return SECTOR_ALIASES[trimmed.toLowerCase()] || trimmed;
}

/**
 * Normalize the two sector payload shapes into canonical percentage weights:
 *   - arrays: `{ sector: "Financials", percentage: 39.5 }`
 *   - keyed:  `{ financials: 0.395 }`
 * Fractions are scaled to percentages, aliases are folded together, and
 * invalid entries are dropped so they cannot become phantom "Other" slices.
 */
export function normalizeSectorWeightings(raw: unknown): FundSectorWeighting[] {
  if (!Array.isArray(raw)) return [];

  const explicit: FundSectorWeighting[] = [];
  const keyed: FundSectorWeighting[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;

    if (typeof (entry as FundSectorWeighting).sector === 'string') {
      const sector = canonicalSectorLabel((entry as FundSectorWeighting).sector);
      const percentage = Number((entry as FundSectorWeighting).percentage);
      if (sector && Number.isFinite(percentage) && percentage > 0) {
        explicit.push({ sector, percentage });
      }
      continue;
    }

    for (const [key, value] of Object.entries(entry)) {
      const weight = Number(value);
      const sector = canonicalSectorLabel(
        key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
      );
      if (!sector || !Number.isFinite(weight) || weight <= 0) continue;
      keyed.push({ sector, percentage: weight });
    }
  }

  // Fractions total near 1; percentages total near 100.
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
}

export function guessCurrency(symbol: string): string {
  if (!symbol) return 'INR';
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.NS') || upper.endsWith('.BO')) return 'INR';
  if (upper.endsWith('.L')) return 'GBp';
  if (upper.includes('-INR')) return 'INR';
  if (upper.includes('-USD')) return 'USD';
  if (upper.includes('-')) return 'USD';
  return 'INR';
}

/**
 * Currency encoded in the ticker itself. Unlike `guessCurrency`, this returns
 * null when the symbol has no explicit marker, so a US stock without a suffix
 * is not silently treated as INR.
 */
export function explicitCurrencyFromSymbol(symbol: string): string | null {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.NS') || upper.endsWith('.BO') || upper.includes('-INR')) return 'INR';
  if (upper.endsWith('.L')) return 'GBp';
  if (upper.includes('-USD')) return 'USD';
  return null;
}

/**
 * Ticker markers that are authoritative for the instrument's currency.
 * `-USD` is deliberately excluded: Indian crypto trackers commonly store the
 * cost basis for BTC-USD / ETH-USD in INR, so a saved INR currency must win.
 */
export function authoritativeCurrencyFromSymbol(
  symbol: string,
): 'INR' | 'GBp' | null {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  if (upper.endsWith('.NS') || upper.endsWith('.BO') || upper.includes('-INR')) {
    return 'INR';
  }
  if (upper.endsWith('.L')) return 'GBp';
  return null;
}

/**
 * Currency for the saved cost basis (`entryPrice`). A ticker such as
 * SILVER-INR-GRAM overrides stale metadata, but a saved currency is trusted
 * over the `-USD` quote convention so INR-cost crypto is not converted twice.
 */
export function resolveAssetCurrency(asset: {
  symbol: string;
  currency?: string | null;
}): string {
  return (
    authoritativeCurrencyFromSymbol(asset.symbol) ||
    asset.currency ||
    explicitCurrencyFromSymbol(asset.symbol) ||
    guessCurrency(asset.symbol)
  );
}

export function normalizeCategory(category?: string): string {
  if (!category) return 'Other';
  if (category.includes('>')) return category;
  const upper = category.toUpperCase().trim();
  if (upper === 'EQUITY' || upper === 'STOCK') return 'Equities';
  if (upper === 'MUTUALFUND') return 'Mutual Funds';
  if (upper === 'ETF') return 'ETFs';
  if (upper === 'CRYPTOCURRENCY' || upper === 'CRYPTO') return 'Crypto';
  if (upper === 'DEBT' || upper === 'FIXED INCOME' || upper === 'BOND' || upper === 'BONDS')
    return 'Fixed Income';
  if (upper.includes('CASH')) return 'Cash';
  if (upper === 'GOLD' || upper === 'SILVER' || upper === 'COMMODITY' || upper === 'COMMODITIES')
    return 'Commodities';
  return category;
}

/** Convert an asset price to INR using the FX rate supplied by the caller. */
export function toINR(price: number, currency: string, usdToInr: number): number {
  if (currency === 'USD') return price * usdToInr;
  if (currency === 'GBp') return (price / 100) * 105;
  return price;
}

const KNOWN_CASINGS: Record<string, string> = {
  equities: 'Equities',
  'domestic equity': 'Domestic Equity',
  'global equity': 'Global Equity',
  'fixed income': 'Fixed Income',
  cash: 'Cash',
  commodities: 'Commodities',
  gold: 'Gold',
  silver: 'Silver',
  crypto: 'Crypto',
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  stablecoins: 'Stablecoins',
  memecoins: 'Memecoins',
  'other crypto': 'Other Crypto',
  'large cap': 'Large Cap',
  'mid cap': 'Mid Cap',
  'small cap': 'Small Cap',
  diversified: 'Diversified',
  'mutual funds': 'Mutual Funds',
  etfs: 'ETFs',
  'other / uncategorized': 'Other / Uncategorized',
  other: 'Other',
};

/** Normalize the casing of each segment in an allocation path. */
export function normalizeGroup(category: string): string {
  if (!category) return '';
  return category
    .split('>')
    .map((part) => {
      const trimmed = part.trim();
      return KNOWN_CASINGS[trimmed.toLowerCase()] ?? trimmed;
    })
    .join(' > ');
}

/**
 * Normalize exchange balances to the same symbol/currency convention as saved
 * crypto (`BTC-USD`), merge them with manually added holdings, and treat fiat
 * INR balances as cash and stablecoins at their peg.
 */
export function normalizeExchangeAsset(
  raw: Asset & { currentPrice?: number },
  exchangeName: string,
): Asset {
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
  const exchange = raw.exchange || exchangeName;

  return {
    ...raw,
    id: raw.id || `${exchange.toLowerCase()}-${base}`,
    symbol: isInr ? 'INR' : `${base}-USD`,
    name: raw.name || base,
    quantity: Number(raw.quantity) || 0,
    type: isInr ? 'CASH' : 'CRYPTO',
    currency: isInr ? 'INR' : 'USD',
    currentPrice,
    // Exchange APIs do not expose cost basis; keep P&L neutral but mark the
    // lot so consolidation never presents this placeholder as a real average.
    entryPrice: Number(raw.entryPrice) > 0 ? Number(raw.entryPrice) : currentPrice,
    costBasisKnown:
      raw.costBasisKnown === true || isInr || isStablecoin,
    exchange,
  };
}

export interface CachedExchangeData {
  assets: Asset[];
  prices: Record<string, PriceData>;
  lastSynced: number;
}

/** Read the web dashboard's exchange cache from the portfolio snapshot. */
export function readCachedExchange(
  cached: Record<string, { lastSynced?: number; assets?: Asset[] }> | undefined,
): CachedExchangeData {
  const assets: Asset[] = [];
  const prices: Record<string, PriceData> = {};
  let lastSynced = 0;

  for (const [exchangeName, entry] of Object.entries(cached ?? {})) {
    if (!entry || !Array.isArray(entry.assets)) continue;
    const syncedAt = Number(entry.lastSynced) || 0;
    lastSynced = Math.max(lastSynced, syncedAt);

    for (const raw of entry.assets) {
      const asset = normalizeExchangeAsset(raw, exchangeName);
      assets.push(asset);
      if (asset.currentPrice && asset.currentPrice > 0) {
        prices[asset.symbol] = {
          symbol: asset.symbol,
          regularMarketPrice: asset.currentPrice,
          currency: asset.currency,
          shortName: asset.name,
          source: `${exchangeName} (cached)`,
          lastUpdated: syncedAt,
          asOf: syncedAt || null,
          stale: true,
        };
      }
    }
  }

  return { assets, prices, lastSynced };
}

export function getCommoditySubCategory(asset: { name: string; symbol: string }): string {
  const name = (asset.name || '').toLowerCase();
  const symbol = (asset.symbol || '').toLowerCase();
  if (name.includes('gold') || symbol.includes('gold')) return 'Gold';
  if (name.includes('silver') || symbol.includes('silver')) return 'Silver';
  return 'Other Commodities';
}

/**
 * Classify fund/stock names into a cap style. `null` means the name does not
 * reveal a cap band, so the caller should use reported market-cap data instead.
 */
export function getCapCategory(
  name: string,
  categoryName?: string | null,
): string | null {
  const lowerName = (name || '').toLowerCase();
  const lowerCat = (categoryName || '').toLowerCase();
  const combined = `${lowerName} ${lowerCat}`;

  // A large+mid blend is not a single cap bucket. Let the caller fall back to
  // the fund's actual market-cap weights instead of forcing it into Large Cap.
  if (/large\s*&?\s*mid|large\s*midcap|mid\s*&?\s*large/.test(combined)) return null;

  if (lowerName.includes('small') || lowerCat.includes('small')) return 'Small Cap';
  if (lowerName.includes('mid') || lowerCat.includes('mid')) return 'Mid Cap';

  if (
    lowerName.includes('large') ||
    lowerCat.includes('large') ||
    lowerName.includes('bluechip') ||
    lowerCat.includes('bluechip') ||
    lowerName.includes('nifty 50') ||
    lowerName.includes('nifty50') ||
    lowerName.includes('sensex') ||
    lowerName.includes('nifty bees') ||
    lowerName.includes('alphaetf') ||
    lowerName.includes('alpha 50') ||
    lowerName.includes('nifty 100') ||
    lowerName.includes('next 50') ||
    lowerName.includes('nasdaq') ||
    lowerName.includes('s&p')
  ) {
    return 'Large Cap';
  }

  if (
    lowerName.includes('flexi') ||
    lowerCat.includes('flexi') ||
    lowerName.includes('nifty 200') ||
    lowerName.includes('nifty 500') ||
    lowerName.includes('alpha 30') ||
    lowerName.includes('momentum') ||
    lowerName.includes('value') ||
    lowerName.includes('factor')
  ) {
    return 'Flexi Cap';
  }

  if (lowerName.includes('multi') || lowerCat.includes('multi')) return 'Multi Cap';
  if (
    lowerName.includes('elss') ||
    lowerCat.includes('elss') ||
    lowerName.includes('tax') ||
    lowerCat.includes('tax')
  ) {
    return 'ELSS';
  }

  return null;
}

/** ETFs frequently use names that do not contain the literal word "ETF". */
export function isLikelyEtf(asset: Pick<Asset, 'type' | 'name' | 'symbol'>): boolean {
  const type = (asset.type || '').toUpperCase();
  const name = (asset.name || '').toLowerCase();
  const symbol = (asset.symbol || '').toLowerCase();
  return (
    type === 'ETF' ||
    name.includes('etf') ||
    name.includes('bees') ||
    symbol.includes('bees') ||
    symbol === 'alpha.ns' ||
    symbol === 'alpha.bo'
  );
}

/** Assets whose underlying portfolio can be looked through. */
export function isFundAsset(asset: Asset): boolean {
  const type = (asset.type || '').toUpperCase();
  return type === 'MUTUALFUND' || type === 'ETF' || isLikelyEtf(asset);
}

export function isDomesticEquity(asset: Pick<Asset, 'symbol' | 'exchange'>): boolean {
  const symbol = (asset.symbol || '').toUpperCase();
  return (
    symbol.endsWith('.NS') ||
    symbol.endsWith('.BO') ||
    asset.exchange === 'NSE' ||
    asset.exchange === 'BSE'
  );
}

export function isDebtFund(categoryName?: string | null, name?: string | null): boolean {
  const text = `${categoryName ?? ''} ${name ?? ''}`.toLowerCase();
  return ['debt', 'bond', 'liquid', 'fixed', 'gilt', 'money market'].some((keyword) =>
    text.includes(keyword),
  );
}

export function isGlobalFund(categoryName?: string | null, name?: string | null): boolean {
  const text = `${categoryName ?? ''} ${name ?? ''}`.toLowerCase();
  return [
    'off-shore',
    'offshore',
    'china',
    'global',
    'international',
    'nasdaq',
    's&p',
    'us equity',
    'world',
    'hong kong',
    'developed markets',
    'emerging markets',
  ].some((keyword) => text.includes(keyword));
}

/** Gold/silver/commodity ETFs and funds are not equity exposure. */
export function isCommodityFund(categoryName?: string | null, name?: string | null): boolean {
  const text = `${categoryName ?? ''} ${name ?? ''}`.toLowerCase();
  return /\bgold\b|\bsilver\b|\bcommodit(y|ies)\b|precious metals?/.test(text);
}
