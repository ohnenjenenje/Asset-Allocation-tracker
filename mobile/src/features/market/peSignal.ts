/**
 * A P/E only means something against a baseline. The card compares each index
 * with its own last 60 monthly readings and uses quartiles, which is less
 * arbitrary than a fixed "good P/E" threshold across indices and eras.
 */
export type PeZone = 'cheap' | 'fair' | 'expensive' | 'unknown';

export const PE_CHEAP_BELOW = 25;
export const PE_EXPENSIVE_ABOVE = 75;

export function classifyPePercentile(percentile: number | null): PeZone {
  if (percentile == null || !Number.isFinite(percentile)) return 'unknown';
  if (percentile < PE_CHEAP_BELOW) return 'cheap';
  if (percentile > PE_EXPENSIVE_ABOVE) return 'expensive';
  return 'fair';
}
