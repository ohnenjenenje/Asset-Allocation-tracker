import { Banner } from '@/src/components/ui/Banner';
import type { ExchangeSyncIssue } from '@/src/features/portfolio/queries';
import {
  describeStaleQuotes,
  type StaleQuote,
} from '@/src/features/portfolio/quoteFreshness';
import { formatRelativeTime } from '@/src/lib/format/time';

interface QuoteFreshnessBannerProps {
  staleQuoteCount: number;
  /** Cached symbols, so the banner can name the holding instead of counting. */
  staleQuotes?: readonly StaleQuote[];
  exchangeIsCached: boolean;
  /** Exchanges whose balances came from the cache, e.g. `['CoinDCX']`. */
  cachedExchangeNames?: string[];
  exchangeLastSyncedAt: number | null;
  exchangeIssues?: ExchangeSyncIssue[];
  onRefresh?: () => void;
  /** Opens the single cached holding from the banner. */
  onOpenStale?: (quote: StaleQuote) => void;
}

function friendlyExchangeError(message: string): string {
  const lower = message.toLowerCase();
  const ip = message.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0];
  if (ip && (lower.includes('invalid credentials') || lower.includes('api key'))) {
    return `API key rejected — bind server IP ${ip} to the key.`;
  }
  if (lower.includes('api key expired') || lower.includes('invalid credentials')) {
    return 'API key expired or rejected — bind the server IP when creating a new key.';
  }
  if (lower.includes('invalid character') || lower.includes('malformed')) {
    return 'API key format is invalid on the server.';
  }
  return message.length > 120 ? `${message.slice(0, 117)}…` : message;
}

function issueSummary(issues: ExchangeSyncIssue[] | undefined): string {
  return (issues ?? [])
    .map((issue) => `${issue.name}: ${friendlyExchangeError(issue.message)}`)
    .join(' · ');
}

/**
 * Surfaces data that is explicitly cached rather than pretending it is live.
 * Normal market closures are handled per-row with an "as of" label instead, so
 * a quote that is merely old is not treated as a failure.
 */
export function QuoteFreshnessBanner({
  staleQuoteCount,
  staleQuotes,
  exchangeIsCached,
  cachedExchangeNames,
  exchangeLastSyncedAt,
  exchangeIssues,
  onRefresh,
  onOpenStale,
}: QuoteFreshnessBannerProps) {
  const issueText = issueSummary(exchangeIssues);

  if (exchangeIsCached) {
    const age = exchangeLastSyncedAt ? formatRelativeTime(exchangeLastSyncedAt) : '';
    // Name the exchange(s) that actually fell back so a CoinDCX failure does
    // not make live Binance balances look cached.
    const cachedLabel =
      cachedExchangeNames && cachedExchangeNames.length > 0
        ? cachedExchangeNames.join(' and ')
        : 'Crypto';
    return (
      <Banner
        tone="warning"
        icon="clock"
        message={
          issueText
            ? `${cachedLabel} balances are cached${age ? ` from ${age}` : ''}. Refresh failed — ${issueText}`
            : `${cachedLabel} balances are using cached exchange data${age ? ` from ${age}` : ''}. Refresh to fetch the latest balances.`
        }
        actionLabel={onRefresh ? 'Refresh' : undefined}
        onAction={onRefresh}
      />
    );
  }

  if (issueText) {
    return (
      <Banner
        tone="error"
        icon="alert-triangle"
        message={`Crypto balances could not be refreshed — ${issueText}`}
        actionLabel={onRefresh ? 'Retry' : undefined}
        onAction={onRefresh}
      />
    );
  }

  if (staleQuoteCount > 0) {
    const cached = staleQuotes ?? [];
    const single = cached.length === 1 ? cached[0] : null;
    const openable = single?.assetId && onOpenStale ? single : null;

    return (
      <Banner
        tone="warning"
        icon="clock"
        message={
          cached.length > 0
            ? describeStaleQuotes(cached)
            : `${staleQuoteCount} ${
                staleQuoteCount === 1 ? 'price is' : 'prices are'
              } using a cached value because a live quote was unavailable.`
        }
        actionLabel={
          openable ? 'View holding' : onRefresh ? 'Refresh' : undefined
        }
        onAction={
          openable ? () => onOpenStale?.(openable) : onRefresh
        }
      />
    );
  }

  return null;
}
