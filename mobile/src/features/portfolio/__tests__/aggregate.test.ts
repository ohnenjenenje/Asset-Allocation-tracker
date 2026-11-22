/** @jest-environment node */

import { summarize } from '../aggregate';
import type { Asset, PriceData } from '../types';

const asset = (
  overrides: Partial<Asset> & Pick<Asset, 'id' | 'symbol' | 'name'>,
): Asset => ({
  quantity: 1,
  entryPrice: 100,
  currency: 'INR',
  type: 'STOCK',
  ...overrides,
});

describe('summarize currency handling', () => {
  it('keeps an INR cost basis for BTC-USD while valuing the USD quote', () => {
    const bitcoin = asset({
      id: 'btc',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      type: 'CRYPTOCURRENCY',
      quantity: 0.0003,
      entryPrice: 6_477_734.833,
      currency: 'INR',
    });
    const prices: Record<string, PriceData> = {
      'BTC-USD': {
        symbol: 'BTC-USD',
        shortName: 'Bitcoin',
        regularMarketPrice: 59_552.17,
        currency: 'USD',
      },
    };

    const summary = summarize([bitcoin], prices, 92.68);

    expect(summary.investedValue).toBe(194_332);
    expect(summary.currentValue).toBe(
      Math.round(0.0003 * 59_552.17 * 92.68 * 100),
    );
    expect(summary.pnl).toBe(summary.currentValue - summary.investedValue);
  });

  it('still repairs a stale USD cost basis on an explicit -INR ticker', () => {
    const silver = asset({
      id: 'silver',
      symbol: 'SILVER-INR-GRAM',
      name: 'Physical Silver (Per Gram)',
      type: 'COMMODITY',
      quantity: 6.2885,
      entryPrice: 159.26,
      currency: 'USD',
    });

    const summary = summarize([silver], {}, 92.68);

    expect(summary.investedValue).toBe(100_151);
    expect(summary.currentValue).toBe(100_151);
  });
});
