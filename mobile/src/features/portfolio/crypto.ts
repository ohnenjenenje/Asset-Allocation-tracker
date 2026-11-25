import type { Asset, CryptoSubtype } from './types';

/**
 * Crypto is the one sleeve where the same economic asset can arrive from many
 * venues. Institutions aggregate exposure by coin, but keep the individual
 * lots for cost basis and tax reporting. These helpers provide the canonical
 * coin identity used by both the allocation tree and the consolidated holdings
 * view.
 *
 * Exchange syncs can bring in hundreds of small balances, so classification is
 * automatic: BTC/ETH, known stablecoins and known memecoins get their own
 * sleeve, and every other coin falls back to Other Crypto. An explicit subtype
 * or a user-defined coin sleeve always wins.
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
  'USDE',
  'USDS',
  'FRAX',
  'LUSD',
  'GHO',
  'CRVUSD',
  'SUSD',
  'EURC',
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
  USDE: 'Ethena USDe',
  USDS: 'Sky Dollar',
  FRAX: 'Frax',
  LUSD: 'Liquity USD',
  GHO: 'GHO',
  CRVUSD: 'Curve USD',
  SUSD: 'Synthetix USD',
  EURC: 'Euro Coin',
};

/**
 * Well-known meme coins, kept intentionally conservative. Anything missing
 * still ends up in Other Crypto automatically, and an explicit subtype can
 * override this list.
 */
const MEMECOIN_BASES = new Set([
  'DOGE',
  'SHIB',
  'PEPE',
  'FLOKI',
  'BONK',
  'WIF',
  'BOME',
  'MOG',
  'BRETT',
  'POPCAT',
  'TURBO',
  'NEIRO',
  'SLERF',
  'MYRO',
  'WEN',
  'PENGU',
  'FARTCOIN',
  'PNUT',
  'TRUMP',
  'MELANIA',
  'CHILLGUY',
  'MOODENG',
  'BABYDOGE',
  'SAFEMOON',
  'AKITA',
  'SAMO',
  'MEW',
  'PONKE',
  'DEGEN',
  'MUMU',
  'BILLY',
  'GIGA',
  'TROLL',
  'LADYS',
]);

/** Exchange contracts sometimes prefix meme coins with 1000 or 1M. */
function memecoinBase(base: string): string {
  if (base.startsWith('1000')) return base.slice(4);
  if (base.startsWith('1M')) return base.slice(2);
  return base;
}

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

/**
 * Subtype inferred from the symbol alone: BTC, ETH, known stablecoins and
 * known memecoins. Every other coin returns null and falls back to Other
 * Crypto at the allocation layer.
 */
export function cryptoSubtypeFromSymbol(symbol: string): CryptoSubtype | null {
  const base = cryptoBaseSymbol(symbol);
  if (base === 'BTC') return 'Bitcoin';
  if (base === 'ETH') return 'Ethereum';
  if (STABLECOIN_BASES.has(base)) return 'Stablecoins';
  if (MEMECOIN_BASES.has(base) || MEMECOIN_BASES.has(memecoinBase(base))) {
    return 'Memecoins';
  }
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
 * inference. Assets without any of those fall back to Other Crypto when they
 * are allocated.
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

function normaliseSleeveLabel(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Allocation path for a crypto asset.
 *
 * Order of preference:
 * 1. A canonical subtype (explicit, legacy path, or symbol inference).
 * 2. A custom category path already stored on the asset.
 * 3. A coin-specific sleeve the user created under Crypto (`Crypto > XRP`),
 *    matched by base symbol or coin name. This lets a new venue lot land in
 *    the same sleeve without being tagged individually.
 * 4. Other Crypto as the automatic catch-all, so exchange dust never needs
 *    to be tagged by hand.
 */
export function cryptoAllocationPath(
  asset: Pick<
    Asset,
    'symbol' | 'name' | 'type' | 'categoryPath' | 'cryptoSubtype'
  >,
  options: { sleeveLabels?: readonly string[] } = {},
): string | null {
  if (!isCryptoAsset(asset)) return null;

  const subtype = cryptoSubtypeForAsset(asset);
  if (subtype) return `Crypto > ${subtype}`;

  const existing = asset.categoryPath?.join(' > ').trim();
  if (existing && existing.toLowerCase() !== 'crypto') return existing;

  // Canonical sleeve labels are already handled above. Only user-defined
  // coin sleeves take part in this match, so a stray asset name like
  // "Bitcoin" cannot pull a wrapped token into the canonical Bitcoin sleeve.
  const customSleeves = (options.sleeveLabels ?? []).filter(
    (label) => normalizeCryptoSubtype(label) === null,
  );
  const base = normaliseSleeveLabel(cryptoBaseSymbol(asset.symbol));
  const name = normaliseSleeveLabel(asset.name);
  const sleeve =
    customSleeves.find((label) => normaliseSleeveLabel(label) === base) ??
    customSleeves.find((label) => normaliseSleeveLabel(label) === name);
  if (sleeve) return `Crypto > ${sleeve.trim()}`;

  return 'Crypto > Other Crypto';
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
