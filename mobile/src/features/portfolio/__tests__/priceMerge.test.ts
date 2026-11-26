import { mergePriceSources } from '../priceMerge';
import type { PriceData } from '../types';

function quote(overrides: Partial<PriceData> = {}): PriceData {
  return {
    symbol: 'XAI-USD',
    regularMarketPrice: 0.0054,
    currency: 'USD',
    shortName: 'XAI',
    asOf: 1_700_000_000_000,
    stale: false,
    ...overrides,
  };
}

describe('mergePriceSources', () => {
  it('keeps a live exchange ticker over a stale API fallback', () => {
    const merged = mergePriceSources(
      { 'XAI-USD': quote() },
      { 'XAI-USD': quote({ regularMarketPrice: 0.004, stale: true }) },
    );

    expect(merged['XAI-USD'].regularMarketPrice).toBe(0.0054);
    expect(merged['XAI-USD'].stale).toBe(false);
  });

  it('lets a live API quote replace the exchange value', () => {
    const merged = mergePriceSources(
      { 'XAI-USD': quote() },
      { 'XAI-USD': quote({ regularMarketPrice: 0.0056 }) },
    );

    expect(merged['XAI-USD'].regularMarketPrice).toBe(0.0056);
  });

  it('keeps a stale API quote when the exchange has no ticker', () => {
    const merged = mergePriceSources({}, {
      'XAI-USD': quote({ regularMarketPrice: 0.004, stale: true }),
    });

    expect(merged['XAI-USD'].regularMarketPrice).toBe(0.004);
    expect(merged['XAI-USD'].stale).toBe(true);
  });

  it('lets a live API quote replace a cached exchange value', () => {
    const merged = mergePriceSources(
      { 'XAI-USD': quote({ stale: true }) },
      { 'XAI-USD': quote({ regularMarketPrice: 0.0056 }) },
    );

    expect(merged['XAI-USD'].regularMarketPrice).toBe(0.0056);
    expect(merged['XAI-USD'].stale).toBe(false);
  });
});
