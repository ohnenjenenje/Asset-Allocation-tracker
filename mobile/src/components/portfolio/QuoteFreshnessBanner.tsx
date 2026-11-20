import { Banner } from '@/src/components/ui/Banner';
import { formatRelativeTime } from '@/src/lib/format/time';

interface QuoteFreshnessBannerProps {
  staleQuoteCount: number;
  exchangeIsCached: boolean;
  exchangeLastSyncedAt: number | null;
  onRefresh?: () => void;
}

/**
 * Surfaces data that is explicitly cached rather than pretending it is live.
 * Normal market closures are handled per-row with an "as of" label instead, so
 * a quote that is merely old is not treated as a failure.
 */
export function QuoteFreshnessBanner({
  staleQuoteCount,
  exchangeIsCached,
  exchangeLastSyncedAt,
  onRefresh,
}: QuoteFreshnessBannerProps) {
  if (exchangeIsCached) {
    const age = exchangeLastSyncedAt ? formatRelativeTime(exchangeLastSyncedAt) : '';
    return (
      <Banner
        tone="warning"
        icon="clock"
        message={`Crypto balances are using cached exchange data${age ? ` from ${age}` : ''}. Refresh to fetch the latest balances.`}
        actionLabel={onRefresh ? 'Refresh' : undefined}
        onAction={onRefresh}
      />
    );
  }

  if (staleQuoteCount > 0) {
    return (
      <Banner
        tone="warning"
        icon="clock"
        message={`${staleQuoteCount} ${staleQuoteCount === 1 ? 'price is' : 'prices are'} using a cached value because a live quote was unavailable.`}
        actionLabel={onRefresh ? 'Refresh' : undefined}
        onAction={onRefresh}
      />
    );
  }

  return null;
}
