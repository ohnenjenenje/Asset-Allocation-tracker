import type {
  FundAssetAllocation,
  FundData,
  FundMarketCapWeightage,
  FundSectorWeighting,
} from './types';

const hasPositiveSectorWeights = (
  sectors: FundSectorWeighting[] | null | undefined,
): sectors is FundSectorWeighting[] =>
  Array.isArray(sectors) &&
  sectors.some((sector) => Boolean(sector?.sector) && Number(sector.percentage) > 0);

const hasPositiveAllocation = (
  allocation: FundAssetAllocation | null | undefined,
): allocation is FundAssetAllocation =>
  allocation != null && Object.values(allocation).some((value) => Number(value) > 0);

const hasPositiveCapWeights = (
  weights: FundMarketCapWeightage | null | undefined,
): weights is FundMarketCapWeightage =>
  weights != null &&
  (['largeCap', 'midCap', 'smallCap', 'others'] as const).some(
    (key) => Number(weights[key]) > 0,
  );

/** Compare sector lists on the same percentage scale (fractions vs percent). */
const sectorCoverage = (sectors: FundSectorWeighting[]): number => {
  const total = sectors.reduce(
    (sum, sector) => sum + (Number(sector.percentage) || 0),
    0,
  );
  return total > 0 && total <= 1.5 ? total * 100 : total;
};

/**
 * Providers are inconsistent: the same fund can come back from Upvaly with
 * full composition and cap weights, then from the Yahoo fallback with only a
 * top-10 list and no cap weights. Never let the poorer response replace the
 * richer cached one — otherwise funds fall back to their mandate bucket (e.g.
 * a large+mid index fund shows up as "Diversified Equity").
 *
 * Mirrors the web hook's merge so both apps classify the same portfolio the
 * same way.
 */
export function mergeFundData(
  existing?: FundData | null,
  fresh?: FundData | null,
): FundData {
  const current = existing ?? {};
  const next = fresh ?? {};

  const existingHoldings = current.holdings ?? [];
  const freshHoldings = next.holdings ?? [];
  const holdings =
    freshHoldings.length >= existingHoldings.length ? freshHoldings : existingHoldings;

  const freshSectors = hasPositiveSectorWeights(next.sectorWeightings)
    ? next.sectorWeightings
    : null;
  const existingSectors = hasPositiveSectorWeights(current.sectorWeightings)
    ? current.sectorWeightings
    : null;
  // Keep whichever provider covers more of the fund. A fallback can return a
  // valid but sparse sector split; replacing a fuller cached split with it
  // would make the residual show up as an unclassified slice.
  const sectorWeightings =
    freshSectors &&
    (!existingSectors ||
      sectorCoverage(freshSectors) >= sectorCoverage(existingSectors))
      ? freshSectors
      : (existingSectors ?? []);

  const assetAllocation = hasPositiveAllocation(next.assetAllocation)
    ? next.assetAllocation
    : hasPositiveAllocation(current.assetAllocation)
      ? current.assetAllocation
      : null;

  const marketCapWeightage = hasPositiveCapWeights(next.marketCapWeightage)
    ? next.marketCapWeightage
    : hasPositiveCapWeights(current.marketCapWeightage)
      ? current.marketCapWeightage
      : null;

  return {
    ...current,
    ...next,
    holdings,
    sectorWeightings,
    assetAllocation,
    marketCapWeightage,
    symbol: next.symbol || current.symbol,
    source: next.source || current.source || null,
    categoryName: next.categoryName || current.categoryName || null,
    lastUpdated: next.lastUpdated ?? current.lastUpdated,
    lookthrough: next.lookthrough ?? current.lookthrough ?? null,
    note: next.note ?? current.note ?? null,
    debug: next.debug ?? current.debug,
  };
}
