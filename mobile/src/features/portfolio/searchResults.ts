import { guessCurrency } from './normalize';
import type { AssetType } from './schema';

/**
 * Pure mapping for `/api/search` results. Keeping this separate from the query
 * hook lets the search UI stay small and makes the quote-type rules testable.
 */

export interface AssetSearchResult {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  source?: string;
}

export interface AssetSearchSelection {
  name: string;
  symbol: string;
  type: AssetType;
  currency: 'INR' | 'USD';
}

export const ASSET_SEARCH_LIMIT = 8;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Accepts the raw API array, drops malformed rows and deduplicates symbols. */
export function normalizeSearchResults(payload: unknown): AssetSearchResult[] {
  if (!Array.isArray(payload)) return [];

  const seen = new Set<string>();
  const results: AssetSearchResult[] = [];

  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const symbol = asString(raw.symbol);
    if (!symbol) continue;

    const key = symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      symbol,
      shortname: asString(raw.shortname),
      longname: asString(raw.longname),
      quoteType: asString(raw.quoteType),
      source: asString(raw.source),
    });

    if (results.length >= ASSET_SEARCH_LIMIT) break;
  }

  return results;
}

function assetTypeFor(symbol: string, quoteType: string): AssetType {
  if (symbol === 'GOLD-INR-GRAM' || symbol === 'GC=F') return 'GOLD';
  if (symbol === 'SILVER-INR-GRAM' || symbol === 'SI=F') return 'SILVER';
  if (symbol === 'CASH-INR') return 'CASH';

  if (quoteType.includes('MUTUAL')) return 'MUTUALFUND';
  if (quoteType === 'ETF') return 'ETF';
  if (quoteType.includes('CRYPTO')) return 'CRYPTO';
  if (quoteType.includes('CASH')) return 'CASH';
  if (
    quoteType.includes('BOND') ||
    quoteType.includes('DEBT') ||
    quoteType.includes('FIXED')
  ) {
    return 'DEBT';
  }
  if (quoteType.includes('COMMODITY')) {
    return symbol.includes('SILVER') ? 'SILVER' : 'GOLD';
  }
  return 'STOCK';
}

/**
 * Turns one search hit into the values the asset form needs. The app only
 * supports INR and USD entry currencies, so other quote currencies fall back to
 * INR rather than silently changing the portfolio's base currency.
 */
export function mapSearchResult(result: AssetSearchResult): AssetSearchSelection {
  const symbol = result.symbol.trim().toUpperCase();
  const quoteType = (result.quoteType ?? '').toUpperCase();
  const name = (result.shortname || result.longname || symbol).trim();
  const guessed = guessCurrency(symbol);
  const currency: 'INR' | 'USD' =
    guessed === 'USD' || symbol.endsWith('=F') || symbol.endsWith('=X') ? 'USD' : 'INR';

  return {
    name,
    symbol,
    type: assetTypeFor(symbol, quoteType),
    currency,
  };
}

/** The API is only queried once the user has typed something meaningful. */
export function isAssetSearchReady(query: string): boolean {
  return query.trim().length >= 2;
}
