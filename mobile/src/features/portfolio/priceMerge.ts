import type { PriceData } from './types';

/**
 * Combine live exchange tickers with `/api/price` results.
 *
 * Exchange balances arrive with their own venue price. The price API may only
 * have a cached sheet value for the same symbol (for example, an altcoin that
 * CoinGecko's static map does not cover), and that cached value must not
 * replace a live exchange ticker.
 */
export function mergePriceSources(
  exchangePrices: Record<string, PriceData>,
  apiPrices: Record<string, PriceData> | undefined,
): Record<string, PriceData> {
  const merged: Record<string, PriceData> = { ...exchangePrices };

  for (const [symbol, quote] of Object.entries(apiPrices ?? {})) {
    const exchangeQuote = merged[symbol];
    if (exchangeQuote && !exchangeQuote.stale && quote.stale) continue;
    merged[symbol] = quote;
  }

  return merged;
}
