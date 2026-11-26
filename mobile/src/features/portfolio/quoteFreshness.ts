import { formatRelativeTime } from '@/src/lib/format/time';

/** One symbol whose latest price came from a cached fallback. */
export interface StaleQuote {
  symbol: string;
  name: string;
  /** Asset to open from the banner, when the symbol belongs to a holding. */
  assetId: string | null;
  /** Timestamp of the cached value, when the source kept one. */
  asOf: number | null;
}

export function oldestStaleQuoteAsOf(
  quotes: readonly StaleQuote[],
): number | null {
  let oldest: number | null = null;
  for (const quote of quotes) {
    if (typeof quote.asOf !== 'number' || quote.asOf <= 0) continue;
    if (oldest == null || quote.asOf < oldest) oldest = quote.asOf;
  }
  return oldest;
}

/**
 * Banner copy that names what is actually cached. The previous wording only
 * reported a count, which left the reader to hunt through the holdings list for
 * the stale symbol.
 */
export function describeStaleQuotes(
  quotes: readonly StaleQuote[],
  now: number = Date.now(),
): string {
  if (quotes.length === 0) {
    return 'Some prices are using cached values because live quotes were unavailable.';
  }

  const named = quotes.slice(0, 2).map((quote) => quote.name);
  const first = named[0] ?? 'A holding';
  const extra = quotes.length - named.length;
  const subject =
    quotes.length === 1
      ? first
      : extra > 0
        ? `${first} and ${extra + 1} other holdings`
        : `${first} and ${named[1] ?? 'another holding'}`;
  const verb = quotes.length === 1 ? 'is' : 'are';
  const object = quotes.length === 1 ? 'a cached price' : 'cached prices';
  const oldest = oldestStaleQuoteAsOf(quotes);
  const age = oldest == null ? '' : formatRelativeTime(oldest, now);
  const because =
    quotes.length === 1
      ? 'a live quote was unavailable'
      : 'live quotes were unavailable';

  return `${subject} ${verb} using ${object}${
    age ? ` from ${age}` : ''
  } because ${because}.`;
}
