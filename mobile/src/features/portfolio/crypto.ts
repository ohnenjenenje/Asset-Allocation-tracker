import type { Asset, CryptoSubtype } from './types';

/**
 * Crypto is the one sleeve where the same economic asset can arrive from many
 * venues. Institutions aggregate exposure by coin, but keep the individual
 * lots for cost basis and tax reporting. These helpers provide the canonical
 * coin identity used by both the allocation tree and the consolidated holdings
 * view.
 *
 * Unknown coins deliberately return no subtype: they stay directly under
 * `Crypto` instead of being guessed into Memecoins or Other Crypto.
 */
export const CRYPTO_SUBTYPES: readonly CryptoSubtype[] = [
  'Bitcoin',
  'Ethereum',
  'Stablecoins',
  'Memecoins',
  'Other Crypto',
];

/** Kept in one place so exchange normalisation and subtype inference agree. */
export const STABLECOIN_BASES = new Set([
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

const STABLECOIN_NAMES: Record<string, string> = {
  USDT: 'Tether',
  USDC: 'USD Coin',
  BUSD: 'Binance USD',
  FDUSD: 'First Digital USD',
  TUSD: 'TrueUSD',
  DAI: 'Dai',
  USDP: 'Pax Dollar',
  PYUSD: 'PayPal USD',
  USDD: 'USDD',
  GUSD: 'Gemini Dollar',
};

const FIAT_BASES = new Set(['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);

/** Quotes that can follow a separator, such as `ETH-BTC` or `BTC/USDT`. */
const SEPARATED_QUOTES = new Set([...FIAT_BASES, ...STABLECOIN_BASES, 'BTC', 'ETH']);

/** Quotes that are commonly concatenated, such as `BTCUSDT`. */
const CONCATENATED_QUOTES = [...FIAT_BASES, ...STABLECOIN_BASES].sort(
  (a, b) => b.length - a.length,
);

/**
 * Reduce a venue-specific crypto symbol to the coin itself.
 *
 * `BTC`, `BTC-USD`, `BTC-INR`, `BTC/USDT`, `ETH-BTC` and `BTCUSDT` all resolve
 * to their base coin. Wrapped or derivative tickers are intentionally left
 * alone (`WBTC` stays `WBTC`) because they are not the same instrument.
 */
export function cryptoBaseSymbol(symbol: string): string {
  const normalized = String(symbol ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!normalized) return '';

  if (SEPARATED_QUOTES.has(normalized)) return normalized;

  const parts = normalized.split(/[/\-_]/).filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (SEPARATED_QUOTES.has(last)) return parts.slice(0, -1).join('-');
  }

  for (const quote of CONCATENATED_QUOTES) {
    if (normalized.length <= quote.length) continue;
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, -quote.length);
    if (base.length >= 2 && /^[A-Z0-9]+$/.test(base)) return base;
  }

  return normalized;
}

/** Subtype inferred from the symbol alone. Never guesses a meme coin. */
export function cryptoSubtypeFromSymbol(symbol: string): CryptoSubtype | null {
  const base = cryptoBaseSymbol(symbol);
  if (base === 'BTC') return 'Bitcoin';
  if (base === 'ETH') return 'Ethereum';
  if (STABLECOIN_BASES.has(base)) return 'Stablecoins';
  return null;
}

export function normalizeCryptoSubtype(
  value?: string | null,
): CryptoSubtype | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'bitcoin' || normalized === 'btc') return 'Bitcoin';
  if (normalized === 'ethereum' || normalized === 'eth') return 'Ethereum';
  if (normalized === 'stablecoin' || normalized === 'stablecoins') {
    return 'Stablecoins';
  }
  if (normalized === 'memecoin' || normalized === 'memecoins') return 'Memecoins';
  if (normalized === 'other crypto') return 'Other Crypto';
  return null;
}

/**
 * Explicit subtype wins, then the legacy `categoryPath[1]` label, then symbol
 * inference. Assets without any of those stay directly under `Crypto`.
 */
export function cryptoSubtypeForAsset(
  asset: Pick<Asset, 'symbol' | 'cryptoSubtype' | 'categoryPath'>,
): CryptoSubtype | null {
  const explicit = normalizeCryptoSubtype(asset.cryptoSubtype);
  if (explicit) return explicit;

  const legacy = normalizeCryptoSubtype(asset.categoryPath?.[1]);
  if (legacy) return legacy;

  return cryptoSubtypeFromSymbol(asset.symbol);
}

export function isCryptoAsset(
  asset: Pick<Asset, 'type' | 'categoryPath' | 'symbol'>,
): boolean {
  const top = String(asset.categoryPath?.[0] ?? asset.type ?? '')
    .trim()
    .toUpperCase();
  return top === 'CRYPTO' || top === 'CRYPTOCURRENCY';
}

export function isCryptoAllocationPath(path: string): boolean {
  const normalized = String(path ?? '').trim().toLowerCase();
  return normalized === 'crypto' || normalized.startsWith('crypto > ');
}

/**
 * Allocation path for a crypto asset. Canonical subtypes are used when known;
 * an existing custom crypto path is preserved when there is no subtype.
 */
export function cryptoAllocationPath(
  asset: Pick<Asset, 'symbol' | 'type' | 'categoryPath' | 'cryptoSubtype'>,
): string | null {
  if (!isCryptoAsset(asset)) return null;

  const subtype = cryptoSubtypeForAsset(asset);
  if (subtype) return `Crypto > ${subtype}`;

  const existing = asset.categoryPath?.join(' > ').trim();
  if (existing && existing.toLowerCase() !== 'crypto') return existing;
  return 'Crypto';
}

/** Stable display name for a consolidated coin position. */
export function cryptoDisplayName(base: string, fallback?: string): string {
  const symbol = cryptoBaseSymbol(base);
  if (symbol === 'BTC') return 'Bitcoin';
  if (symbol === 'ETH') return 'Ethereum';
  const stablecoin = STABLECOIN_NAMES[symbol];
  if (stablecoin) return stablecoin;
  const name = String(fallback ?? '').trim();
  if (name && name.toUpperCase() !== symbol) return name;
  return symbol || 'Crypto';
}

/**
 * True when the stored entry price is a real cost basis. Exchange balance
 * snapshots set `costBasisKnown: false` because their `entryPrice` is only the
 * first-seen market price, not what the investor paid.
 */
export function hasKnownCostBasis(
  asset: Pick<Asset, 'costBasisKnown' | 'entryPrice'>,
): boolean {
  if (typeof asset.costBasisKnown === 'boolean') return asset.costBasisKnown;
  return Number(asset.entryPrice) > 0;
}

export function cryptoPositionKey(asset: Pick<Asset, 'symbol'>): string {
  return `crypto:${cryptoBaseSymbol(asset.symbol)}`;
}
