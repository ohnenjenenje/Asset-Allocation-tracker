/** @jest-environment node */

import type { IndiaIndexValuation } from '../indiaPe';
import {
  countAtCutoff,
  filterSectorIndices,
  sortSectorIndices,
  summarizePeZones,
} from '../sectorView';

function index(
  key: string,
  name: string,
  category: IndiaIndexValuation['category'],
  percentile: number | null,
  pe = 20,
  medianPe: number | null = 25,
): IndiaIndexValuation {
  return {
    key,
    name,
    category,
    featured: false,
    pe,
    pb: null,
    dividendYield: null,
    earningsYield: null,
    history:
      percentile == null
        ? null
        : {
            sampleMonths: 60,
            medianPe,
            percentile,
            start: '2021-11',
            end: '2026-10',
          },
    historySource: percentile == null ? null : 'nse',
    currentSource: 'nse',
  };
}

const rows: IndiaIndexValuation[] = [
  index('nifty50', 'Nifty 50', 'broad', 25, 20.78, 21.86),
  index('niftyIt', 'Nifty IT', 'sector', 3, 18.79, 26.7),
  index('niftyBank', 'Nifty Bank', 'sector', 50, 13.94, 15.59),
  index('niftyRealty', 'Nifty Realty', 'sector', 25, 30, 35),
  index('niftyEnergy', 'Nifty Energy', 'thematic', 80, 15, 13),
  index('niftyNew', 'Nifty New', 'sector', null, 22, null),
];

describe('filterSectorIndices', () => {
  it('separates the 43-index sector universe from broad benchmarks', () => {
    const sector = filterSectorIndices(rows, {
      category: 'sector',
      zone: 'all',
      query: '',
    });
    expect(sector.map((row) => row.key)).toEqual([
      'niftyIt',
      'niftyBank',
      'niftyRealty',
      'niftyEnergy',
      'niftyNew',
    ]);
  });

  it('can show broad benchmarks on their own', () => {
    const broad = filterSectorIndices(rows, {
      category: 'broad',
      zone: 'all',
      query: '',
    });
    expect(broad.map((row) => row.key)).toEqual(['nifty50']);
  });

  it('filters by zone and search together', () => {
    const cheap = filterSectorIndices(rows, {
      category: 'all',
      zone: 'cheap',
      query: '',
    });
    expect(cheap.map((row) => row.key)).toEqual([
      'nifty50',
      'niftyIt',
      'niftyRealty',
    ]);

    const searched = filterSectorIndices(rows, {
      category: 'all',
      zone: 'all',
      query: 'bank',
    });
    expect(searched.map((row) => row.key)).toEqual(['niftyBank']);
  });
});

describe('summarizePeZones', () => {
  it('counts the inclusive zones', () => {
    expect(summarizePeZones(rows)).toEqual({
      total: 6,
      buyZone: 3,
      neutral: 1,
      expensive: 1,
      noSignal: 1,
    });
  });

  it('counts only the exact 25th percentile cutoff', () => {
    expect(countAtCutoff(rows)).toBe(2);
  });
});

describe('sortSectorIndices', () => {
  it('sorts cheapest percentile first and puts no-history rows last', () => {
    expect(sortSectorIndices(rows, 'percentile').map((row) => row.key)).toEqual([
      'niftyIt',
      'nifty50',
      'niftyRealty',
      'niftyBank',
      'niftyEnergy',
      'niftyNew',
    ]);
  });

  it('sorts the largest discount to median first', () => {
    expect(sortSectorIndices(rows, 'discount').map((row) => row.key)).toEqual([
      'niftyIt',
      'niftyRealty',
      'niftyBank',
      'nifty50',
      'niftyEnergy',
      'niftyNew',
    ]);
  });

  it('sorts alphabetically when requested', () => {
    expect(sortSectorIndices(rows, 'name').map((row) => row.name)).toEqual([
      'Nifty 50',
      'Nifty Bank',
      'Nifty Energy',
      'Nifty IT',
      'Nifty New',
      'Nifty Realty',
    ]);
  });
});
