/** @jest-environment node */

import { normalizeSectorWeightings } from '../normalize';

describe('normalizeSectorWeightings', () => {
  it('folds provider aliases into one canonical sector', () => {
    expect(
      normalizeSectorWeightings([
        { sector: 'Financials', percentage: 30 },
        { sector: 'Financial Services', percentage: 10 },
        { sector: 'Information Technology', percentage: 7.5 },
        { sector: 'Health Care', percentage: 5 },
      ]),
    ).toEqual([
      { sector: 'Financial Services', percentage: 40 },
      { sector: 'Technology', percentage: 7.5 },
      { sector: 'Healthcare', percentage: 5 },
    ]);
  });

  it('converts keyed fraction payloads to canonical percentages', () => {
    expect(
      normalizeSectorWeightings([
        { financials: 0.3, information_technology: 0.2, consumer_discretionary: 0.1 },
      ]),
    ).toEqual([
      { sector: 'Financial Services', percentage: 30 },
      { sector: 'Technology', percentage: 20 },
      { sector: 'Consumer Cyclical', percentage: 10 },
    ]);
  });

  it('drops invalid entries instead of creating phantom slices', () => {
    expect(
      normalizeSectorWeightings([
        { sector: 'Technology', percentage: 10 },
        { sector: '', percentage: 5 },
        { sector: 'Energy', percentage: null },
        { sector: 'Utilities', percentage: -1 },
      ]),
    ).toEqual([{ sector: 'Technology', percentage: 10 }]);
  });
});
