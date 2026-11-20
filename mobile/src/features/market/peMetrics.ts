/**
 * Secondary valuation context. Percentiles remain the classifier; these
 * metrics answer "how far from the five-year median?" and "how does this index
 * trade relative to the broad market?" without changing the signal.
 */

/** Percentage difference from the five-year median P/E. Negative = cheaper. */
export function discountToMedian(
  pe: number | null,
  medianPe: number | null,
): number | null {
  if (
    pe == null ||
    medianPe == null ||
    !Number.isFinite(pe) ||
    !Number.isFinite(medianPe) ||
    medianPe <= 0
  ) {
    return null;
  }
  return (pe / medianPe - 1) * 100;
}

/** Index P/E divided by a benchmark P/E, e.g. 0.95 means a 5% discount. */
export function relativePe(
  pe: number | null,
  benchmarkPe: number | null,
): number | null {
  if (
    pe == null ||
    benchmarkPe == null ||
    !Number.isFinite(pe) ||
    !Number.isFinite(benchmarkPe) ||
    benchmarkPe <= 0
  ) {
    return null;
  }
  return pe / benchmarkPe;
}

/** Human-readable position versus the median, e.g. "12% below median". */
export function describeMedianPosition(discount: number | null): string | null {
  if (discount == null || !Number.isFinite(discount)) return null;
  if (Math.abs(discount) < 0.05) return 'At the 5-year median';
  const magnitude = Math.abs(discount);
  const formatted = magnitude < 10 ? magnitude.toFixed(1) : Math.round(magnitude).toString();
  return discount < 0 ? `${formatted}% below median` : `${formatted}% above median`;
}

/** Compact relative-P/E label, e.g. "0.95x Nifty 50". */
export function formatRelativePe(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}x`;
}
