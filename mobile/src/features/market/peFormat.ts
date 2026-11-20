import type { IndiaIndexHistory, IndiaPeSource } from './indiaPe';
import type { PeZone } from './peSignal';

/** Shared display formatting for the P/E cards and detail screens. */

export function formatPe(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function ordinalPercentile(value: number): string {
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

export function peZoneLabel(zone: PeZone): string {
  switch (zone) {
    case 'cheap':
      return 'Cheap';
    case 'expensive':
      return 'Expensive';
    case 'fair':
      return 'Fair';
    default:
      return 'No history';
  }
}

export function formatAsOf(value: string | null): string {
  if (!value) return 'date unavailable';
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

function formatMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleDateString('en-IN', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return value;
  }
}

/** "Nov 2021 – Oct 2026", or a dash when the window is incomplete. */
export function formatHistoryWindow(history: IndiaIndexHistory | null): string {
  if (!history?.start || !history.end) return '—';
  return `${formatMonth(history.start)} – ${formatMonth(history.end)}`;
}

/** "Cheaper than 75% of the last 60 months" style context. */
export function historyComparison(history: IndiaIndexHistory | null): string | null {
  if (!history || history.percentile == null) return null;

  const percentile = history.percentile;
  const share = Math.round(percentile <= 50 ? 100 - percentile : percentile);
  const direction = percentile <= 50 ? 'Cheaper' : 'More expensive';
  return `${direction} than ${share}% of the last ${history.sampleMonths} months`;
}

export function currentSourceLabel(source: IndiaPeSource | null): string {
  switch (source) {
    case 'nse':
      return 'NSE close';
    case 'downstox':
      return 'Downstox fallback';
    case 'nifty-indices':
      return 'Nifty Indices';
    default:
      return '—';
  }
}

export function historySourceLabel(source: 'nse' | 'downstox' | null): string {
  switch (source) {
    case 'nse':
      return 'NSE month-end archive';
    case 'downstox':
      return 'Downstox monthly';
    default:
      return '—';
  }
}
