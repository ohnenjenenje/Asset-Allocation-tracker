/**
 * A P/E only means something against a baseline. The card compares each index
 * with its own last 60 monthly readings and uses quartiles, which is less
 * arbitrary than a fixed "good P/E" threshold across indices and eras.
 *
 * Quartile membership is inclusive. Q1 is the value at or below which 25% of
 * observations fall, so an index exactly at the 25th percentile is in the
 * bottom quartile. The same applies at the 75th percentile. The UI labels these
 * exact readings as "at cutoff" so the boundary case is not mistaken for a
 * high-conviction signal.
 */
export type PeZone = 'cheap' | 'fair' | 'expensive' | 'unknown';

export const PE_CHEAP_AT_OR_BELOW = 25;
export const PE_EXPENSIVE_AT_OR_ABOVE = 75;

export function classifyPePercentile(percentile: number | null): PeZone {
  if (percentile == null || !Number.isFinite(percentile)) return 'unknown';
  if (percentile <= PE_CHEAP_AT_OR_BELOW) return 'cheap';
  if (percentile >= PE_EXPENSIVE_AT_OR_ABOVE) return 'expensive';
  return 'fair';
}

/** True only for the exact quartile cutoffs, not for rounded display values. */
export function isPeAtBoundary(percentile: number | null): boolean {
  return percentile === PE_CHEAP_AT_OR_BELOW || percentile === PE_EXPENSIVE_AT_OR_ABOVE;
}

/** Short annotation for the exact 25th / 75th percentile case. */
export function peBoundaryLabel(percentile: number | null): string | null {
  if (percentile === PE_CHEAP_AT_OR_BELOW) {
    return 'At the 25th percentile buy cutoff';
  }
  if (percentile === PE_EXPENSIVE_AT_OR_ABOVE) {
    return 'At the 75th percentile expensive cutoff';
  }
  return null;
}
