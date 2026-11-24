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

describe('crypto position consolidation', () => {
  const bitcoinPrice: Record<string, PriceData> = {
    'BTC-USD': {
      symbol: 'BTC-USD',
      shortName: 'Bitcoin',
      regularMarketPrice: 75_000,
      currency: 'USD',
    },
  };

  it('rolls the same coin across venues into one display position', () => {
    const manual = asset({
      id: 'btc-manual',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      type: 'CRYPTO',
      currency: 'USD',
      quantity: 0.5,
      entryPrice: 60_000,
    });
    const binance = asset({
      id: 'binance-btc',
      symbol: 'BTC-USD',
      name: 'BTC',
      type: 'CRYPTO',
      currency: 'USD',
      quantity: 0.25,
      entryPrice: 70_000,
      exchange: 'Binance',
      costBasisKnown: false,
    });
    const coindcx = asset({
      id: 'coindcx-btc',
      symbol: 'BTC-USD',
      name: 'BTC',
      type: 'CRYPTO',
      currency: 'USD',
      quantity: 0.25,
      entryPrice: 80_000,
      exchange: 'CoinDCX',
      costBasisKnown: false,
    });

    const summary = summarize([manual, binance, coindcx], bitcoinPrice, 84);

    expect(summary.assetCount).toBe(3);
    expect(summary.positionCount).toBe(1);
    expect(summary.holdings).toHaveLength(3);

    const position = summary.positions[0];
    expect(position.lotCount).toBe(3);
    expect(position.lots).toHaveLength(3);
    expect(position.asset.name).toBe('Bitcoin');
    expect(position.asset.symbol).toBe('BTC');
    expect(position.asset.quantity).toBe(1);
    expect(position.currentValue).toBe(Math.round(75_000 * 84 * 100));
    expect(position.costBasisIncomplete).toBe(true);
    // Only the manual lot has a real cost basis: 60,000 USD x 84.
    expect(position.averageCostPaise).toBe(60_000 * 84 * 100);
    expect(summary.topHoldings[0].positionKey).toBe('crypto:BTC');
  });

  it('averages known lots without diluting them with exchange placeholders', () => {
    const first = asset({
      id: 'btc-1',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      type: 'CRYPTO',
      currency: 'USD',
      quantity: 1,
      entryPrice: 30_000,
    });
    const second = asset({
      id: 'btc-2',
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      type: 'CRYPTO',
      currency: 'USD',
      quantity: 1,
      entryPrice: 50_000,
    });
    const prices: Record<string, PriceData> = {
      'BTC-USD': {
        symbol: 'BTC-USD',
        shortName: 'Bitcoin',
        regularMarketPrice: 60_000,
        currency: 'USD',
      },
    };

    const summary = summarize([first, second], prices, 84);
    const position = summary.positions[0];

    expect(position.lotCount).toBe(2);
    expect(position.costBasisIncomplete).toBe(false);
    // (30,000 + 50,000) / 2 = 40,000 USD, converted to INR paise.
    expect(position.averageCostPaise).toBe(40_000 * 84 * 100);
    expect(position.pnlPercent).toBeCloseTo(50, 6);
  });

  it('flags a lone exchange lot as having no usable cost basis', () => {
    const exchange = asset({
      id: 'binance-eth',
      symbol: 'ETH-USD',
      name: 'ETH',
      type: 'CRYPTO',
      currency: 'USD',
      quantity: 2,
      entryPrice: 3_000,
      exchange: 'Binance',
      costBasisKnown: false,
    });
    const prices: Record<string, PriceData> = {
      'ETH-USD': {
        symbol: 'ETH-USD',
        shortName: 'Ethereum',
        regularMarketPrice: 3_000,
        currency: 'USD',
      },
    };

    const summary = summarize([exchange], prices, 84);
    const position = summary.positions[0];

    expect(position.lotCount).toBe(1);
    expect(position.costBasisIncomplete).toBe(true);
    expect(position.averageCostPaise).toBeNull();
    expect(position.asset.name).toBe('Ethereum');
  });
});
