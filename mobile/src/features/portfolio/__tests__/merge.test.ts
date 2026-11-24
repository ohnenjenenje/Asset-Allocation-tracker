/** @jest-environment node */

import { mergeFundData } from '../merge';
import type { FundData } from '../types';

const existing: FundData = {
  symbol: 'MF_149343',
  source: 'Upvaly FinAPI',
  categoryName: 'Index Funds',
  lastUpdated: 1_700_000_000_000,
  holdings: Array.from({ length: 200 }, (_, index) => ({
    symbol: `H${index}`,
    holdingName: `Holding ${index}`,
    holdingPercent: 0.001,
  })),
  sectorWeightings: [{ sector: 'Financial Services', percentage: 29.64 }],
  assetAllocation: {
    stockPosition: 99.94,
    bondPosition: 0,
    cashPosition: 0.06,
    otherPosition: 0,
    preferredPosition: 0,
    convertiblePosition: 0,
  },
  marketCapWeightage: {
    largeCap: 49.09,
    midCap: 48.68,
    smallCap: 1.39,
    others: 0.84,
  },
};

describe('mergeFundData', () => {
  it('keeps richer cached cap weights when the fallback response omits them', () => {
    const fresh: FundData = {
      symbol: 'MF_149343',
      source: 'Yahoo Finance',
      categoryName: null,
      holdings: Array.from({ length: 10 }, (_, index) => ({
        symbol: `F${index}`,
        holdingName: `Fresh ${index}`,
        holdingPercent: 0.04,
      })),
      sectorWeightings: [{ sector: 'Financial Services', percentage: 100 }],
      assetAllocation: {
        stockPosition: 99.94,
        bondPosition: 0,
        cashPosition: 0.06,
        otherPosition: 0,
        preferredPosition: 0,
        convertiblePosition: 0,
      },
      marketCapWeightage: null,
    };

    const merged = mergeFundData(existing, fresh);

    expect(merged.marketCapWeightage).toEqual(existing.marketCapWeightage);
    expect(merged.holdings).toHaveLength(200);
    expect(merged.sectorWeightings).toEqual(fresh.sectorWeightings);
    expect(merged.categoryName).toBe('Index Funds');
    expect(merged.lastUpdated).toBe(existing.lastUpdated);
  });

  it('does not wipe cached look-through with an empty response', () => {
    const merged = mergeFundData(existing, {
      symbol: 'MF_149343',
      holdings: [],
      sectorWeightings: [],
      assetAllocation: null,
      marketCapWeightage: null,
    });

    expect(merged.holdings).toHaveLength(200);
    expect(merged.sectorWeightings).toEqual(existing.sectorWeightings);
    expect(merged.assetAllocation).toEqual(existing.assetAllocation);
    expect(merged.marketCapWeightage).toEqual(existing.marketCapWeightage);
    expect(merged.source).toBe('Upvaly FinAPI');
  });

  it('adopts richer cap weights from the fresh response', () => {
    const fresh: FundData = {
      ...existing,
      source: 'Upvaly FinAPI',
      marketCapWeightage: {
        largeCap: 60,
        midCap: 30,
        smallCap: 5,
        others: 5,
      },
    };

    const merged = mergeFundData(
      { ...existing, marketCapWeightage: null },
      fresh,
    );

    expect(merged.marketCapWeightage).toEqual(fresh.marketCapWeightage);
  });

  it('keeps fuller cached sectors when the fallback only covers a fragment', () => {
    const cached: FundData = {
      ...existing,
      sectorWeightings: [
        { sector: 'Financial Services', percentage: 29.64 },
        { sector: 'Industrials', percentage: 13.12 },
        { sector: 'Consumer Cyclical', percentage: 11.62 },
        { sector: 'Basic Materials', percentage: 8.38 },
        { sector: 'Technology', percentage: 7.96 },
        { sector: 'Healthcare', percentage: 7.42 },
        { sector: 'Energy', percentage: 6.09 },
        { sector: 'Consumer Defensive', percentage: 5.71 },
        { sector: 'Utilities', percentage: 4.14 },
        { sector: 'Communication Services', percentage: 4.04 },
        { sector: 'Real Estate', percentage: 1.58 },
      ],
    };

    const merged = mergeFundData(cached, {
      ...cached,
      sectorWeightings: [{ sector: 'Financial Services', percentage: 30 }],
    });

    expect(merged.sectorWeightings).toEqual(cached.sectorWeightings);
  });

  it('adopts fuller fresh sectors when they cover more of the fund', () => {
    const fresh: FundData = {
      ...existing,
      sectorWeightings: [
        { sector: 'Financial Services', percentage: 60 },
        { sector: 'Technology', percentage: 40 },
      ],
    };

    const merged = mergeFundData(existing, fresh);

    expect(merged.sectorWeightings).toEqual(fresh.sectorWeightings);
  });
});
