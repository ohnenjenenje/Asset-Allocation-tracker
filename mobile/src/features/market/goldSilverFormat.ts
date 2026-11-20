import type { CrossCheckStatus, GoldSilverData } from './goldSilver';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export function formatUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return usdFormatter.format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function crossCheckView(status: CrossCheckStatus): {
  label: string;
  tone: 'positive' | 'warning' | 'neutral';
} {
  switch (status) {
    case 'match':
      return { label: 'Match', tone: 'positive' };
    case 'mismatch':
      return { label: 'Differs', tone: 'warning' };
    case 'stale':
      return { label: 'Stale', tone: 'warning' };
    default:
      return { label: 'No check', tone: 'neutral' };
  }
}

export function goldSilverSourceLabel(source: GoldSilverData['primarySource']): string {
  return source === 'xaus' ? 'xaus.com spot' : 'COMEX futures via Yahoo';
}

export function goldSilverCheckSourceLabel(source: GoldSilverData['primarySource']): string {
  return source === 'xaus' ? 'Yahoo' : 'xaus.com';
}

/** Full timestamp for the feed comparison table. */
export function formatQuoteTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}
