import type { IndiaIndexValuation } from './indiaPe';
import { discountToMedian } from './peMetrics';
import { classifyPePercentile, type PeZone } from './peSignal';

/**
 * Pure view-model helpers for the sector detail screen. Keeping the filtering,
 * sorting and counts here makes them testable and keeps the screen focused on
 * presentation.
 */

export type SectorCategoryFilter = 'sector' | 'broad' | 'all';
export type SectorZoneFilter = 'all' | PeZone;
export type SectorSort = 'percentile' | 'discount' | 'name';

export interface PeZoneCounts {
  total: number;
  buyZone: number;
  neutral: number;
  expensive: number;
  noSignal: number;
}

export const SECTOR_CATEGORY_OPTIONS: readonly {
  value: SectorCategoryFilter;
  label: string;
}[] = [
  { value: 'sector', label: 'Sector & thematic' },
  { value: 'broad', label: 'Broad' },
  { value: 'all', label: 'All' },
];

export const SECTOR_ZONE_OPTIONS: readonly {
  value: SectorZoneFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'cheap', label: 'Buy zone' },
  { value: 'fair', label: 'Neutral' },
  { value: 'expensive', label: 'Expensive' },
  { value: 'unknown', label: 'No signal' },
];

export const SECTOR_SORT_OPTIONS: readonly {
  value: SectorSort;
  label: string;
}[] = [
  { value: 'percentile', label: 'Cheapest' },
  { value: 'discount', label: 'Discount' },
  { value: 'name', label: 'Name' },
];

export function matchesSectorCategory(
  index: IndiaIndexValuation,
  filter: SectorCategoryFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'broad') return index.category === 'broad';
  return index.category === 'sector' || index.category === 'thematic';
}

export function matchesSectorQuery(index: IndiaIndexValuation, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return index.name.toLowerCase().includes(needle);
}

export function matchesSectorZone(
  index: IndiaIndexValuation,
  filter: SectorZoneFilter,
): boolean {
  if (filter === 'all') return true;
  return classifyPePercentile(index.history?.percentile ?? null) === filter;
}

export function filterSectorIndices(
  indices: IndiaIndexValuation[],
  options: {
    category: SectorCategoryFilter;
    zone: SectorZoneFilter;
    query: string;
  },
): IndiaIndexValuation[] {
  return indices.filter(
    (index) =>
      matchesSectorCategory(index, options.category) &&
      matchesSectorQuery(index, options.query) &&
      matchesSectorZone(index, options.zone),
  );
}

/** Universe rows before the zone filter, used to count each zone chip. */
export function sectorUniverse(
  indices: IndiaIndexValuation[],
  category: SectorCategoryFilter,
  query: string,
): IndiaIndexValuation[] {
  return indices.filter(
    (index) =>
      matchesSectorCategory(index, category) && matchesSectorQuery(index, query),
  );
}

export function summarizePeZones(indices: IndiaIndexValuation[]): PeZoneCounts {
  const counts: PeZoneCounts = {
    total: indices.length,
    buyZone: 0,
    neutral: 0,
    expensive: 0,
    noSignal: 0,
  };

  for (const index of indices) {
    const zone = classifyPePercentile(index.history?.percentile ?? null);
    if (zone === 'cheap') counts.buyZone += 1;
    else if (zone === 'expensive') counts.expensive += 1;
    else if (zone === 'fair') counts.neutral += 1;
    else counts.noSignal += 1;
  }

  return counts;
}

export function countAtCutoff(indices: IndiaIndexValuation[]): number {
  return indices.filter((index) => index.history?.percentile === 25).length;
}

function compareNames(a: IndiaIndexValuation, b: IndiaIndexValuation): number {
  return a.name.localeCompare(b.name);
}

/**
 * Cheapest percentile first, then the largest discount to the five-year median,
 * then alphabetical. Indices without enough history always sort last because
 * they have no rank to compare.
 */
export function sortSectorIndices(
  indices: IndiaIndexValuation[],
  sort: SectorSort,
): IndiaIndexValuation[] {
  return [...indices].sort((a, b) => {
    if (sort === 'name') return compareNames(a, b);

    if (sort === 'discount') {
      const aDiscount = discountToMedian(a.pe, a.history?.medianPe ?? null);
      const bDiscount = discountToMedian(b.pe, b.history?.medianPe ?? null);
      if (aDiscount == null && bDiscount == null) return compareNames(a, b);
      if (aDiscount == null) return 1;
      if (bDiscount == null) return -1;
      if (aDiscount !== bDiscount) return aDiscount - bDiscount;
      return compareNames(a, b);
    }

    const aPercentile = a.history?.percentile ?? null;
    const bPercentile = b.history?.percentile ?? null;
    if (aPercentile == null && bPercentile == null) return compareNames(a, b);
    if (aPercentile == null) return 1;
    if (bPercentile == null) return -1;
    if (aPercentile !== bPercentile) return aPercentile - bPercentile;
    return compareNames(a, b);
  });
}
