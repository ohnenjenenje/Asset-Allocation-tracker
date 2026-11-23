/**
 * Money is handled in integer paise internally to avoid floating-point drift.
 * Formatting happens only at the presentation edge.
 */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrExactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percent1Formatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fallbackINR(value: number, exact: boolean): string {
  const fixed = exact ? value.toFixed(2) : Math.round(value).toString();
  return `₹${fixed}`;
}

/** Full rupee value from paise. */
export function formatINR(paise: number, opts: { exact?: boolean } = {}): string {
  const rupees = (Number.isFinite(paise) ? paise : 0) / 100;
  try {
    return opts.exact ? inrExactFormatter.format(rupees) : inrFormatter.format(rupees);
  } catch {
    return fallbackINR(rupees, Boolean(opts.exact));
  }
}

/** Indian compact notation: ₹1.24 Cr / ₹4.50 L. */
export function formatCompactINR(paise: number): string {
  const rupees = paise / 100;
  const absolute = Math.abs(rupees);
  if (absolute >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`;
  if (absolute >= 1e5) return `₹${(rupees / 1e5).toFixed(2)} L`;
  return formatINR(paise);
}

export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return '0';
  try {
    return numberFormatter.format(quantity);
  } catch {
    return quantity.toFixed(2);
  }
}

export function formatPercent(
  value: number,
  opts: { signed?: boolean; precision?: 1 | 2 } = {},
): string {
  const precision = opts.precision ?? 2;
  if (!Number.isFinite(value)) return precision === 1 ? '0.0%' : '0.00%';
  const formatter = precision === 1 ? percent1Formatter : percentFormatter;
  const formatted = formatter.format(Math.abs(value));
  if (opts.signed) return `${value >= 0 ? '+' : '-'}${formatted}%`;
  return `${formatted}%`;
}

/** Drift is expressed in percentage points, one decimal is enough for bands. */
export function formatDriftPp(value: number, opts: { signed?: boolean } = {}): string {
  if (!Number.isFinite(value)) return '0.0 pp';
  const magnitude = Math.abs(value).toFixed(1);
  if (opts.signed) return `${value >= 0 ? '+' : '-'}${magnitude} pp`;
  return `${magnitude} pp`;
}

export function formatSignedINR(paise: number): string {
  return `${paise >= 0 ? '+' : '-'}${formatINR(Math.abs(paise))}`;
}

/**
 * Tickertape reports market cap in millions of INR. 10 million = 1 crore.
 * Values are formatted the way Indian investors read them.
 */
export function formatMarketCap(millions: number | undefined): string {
  if (!millions || !Number.isFinite(millions)) return '—';
  const crores = millions / 10;
  if (crores >= 100_000) return `₹${(crores / 100_000).toFixed(2)} L Cr`;
  if (crores >= 1_000) return `₹${(crores / 1_000).toFixed(1)}K Cr`;
  return `₹${crores.toFixed(0)} Cr`;
}
