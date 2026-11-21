import { Banner } from '@/src/components/ui/Banner';
import type { ExchangeSyncIssue } from '@/src/features/portfolio/queries';
import { formatRelativeTime } from '@/src/lib/format/time';

interface QuoteFreshnessBannerProps {
  staleQuoteCount: number;
  exchangeIsCached: boolean;
  exchangeLastSyncedAt: number | null;
  exchangeIssues?: ExchangeSyncIssue[];
  onRefresh?: () => void;
}

function friendlyExchangeError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('api key expired') || lower.includes('invalid credentials')) {
    return 'API key expired or rejected — generate new keys.';
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
  exchangeIsCached,
  exchangeLastSyncedAt,
  exchangeIssues,
  onRefresh,
}: QuoteFreshnessBannerProps) {
  const issueText = issueSummary(exchangeIssues);

  if (exchangeIsCached) {
    const age = exchangeLastSyncedAt ? formatRelativeTime(exchangeLastSyncedAt) : '';
    return (
      <Banner
        tone="warning"
        icon="clock"
        message={
          issueText
            ? `Crypto balances are cached${age ? ` from ${age}` : ''}. Refresh failed — ${issueText}`
            : `Crypto balances are using cached exchange data${age ? ` from ${age}` : ''}. Refresh to fetch the latest balances.`
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
