export const formatInr = (val: number, maxFractionDigits = 0): string =>
  `₹${val.toLocaleString('en-IN', { maximumFractionDigits: maxFractionDigits })}`;

export const formatCompact = (val: number): string => {
  if (val >= 1e7) return `₹${(val / 1e7).toFixed(2)} Cr`;
  if (val >= 1e5) return `₹${(val / 1e5).toFixed(2)} L`;
  if (val >= 1e3) return `₹${(val / 1e3).toFixed(1)}K`;
  return `₹${val.toFixed(0)}`;
};

export const formatSignedInr = (val: number, maxFractionDigits = 2): string =>
  `${val >= 0 ? '+' : '−'}₹${Math.abs(val).toLocaleString('en-IN', { maximumFractionDigits: maxFractionDigits })}`;

export const formatPercent = (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
