/** @jest-environment node */

import type { Asset, PriceData } from '../types';
import {
  accountExposure,
  currencyExposure,
  currencyFor,
  holdingExposure,
  liquidPercentage,
  liquidityExposure,
  liquidityFor,
  topHoldingConcentration,
} from '../exposure';

const assets: Asset[] = [
  {
    id: 'hdfc',
    symbol: 'HDFCBANK.NS',
    name: 'HDFC Bank',
    quantity: 10,
    entryPrice: 100,
    currency: 'INR',
    type: 'STOCK',
  },
  {
    id: 'btc',
    symbol: 'BTC-USD',
    name: 'Bitcoin',
    quantity: 1,
    entryPrice: 30000,
    currency: 'USD',
    type: 'CRYPTO',
  },
  {
    id: 'cash',
    symbol: 'CASH-INR',
    name: 'Operating cash',
    quantity: 1,
    entryPrice: 50000,
    currency: 'INR',
    type: 'CASH',
  },
  {
    id: 'fund',
    symbol: 'FUNDX',
    name: 'Retirement fund',
    quantity: 100,
    entryPrice: 90,
    currency: 'INR',
    type: 'MUTUALFUND',
    manualLiquidity: 'Monthly',
    account: 'Retirement',
  },
  {
    id: 'gold',
    symbol: 'GOLD',
    name: 'Physical gold',
    quantity: 1,
    entryPrice: 6000,
    currency: 'INR',
    type: 'GOLD',
  },
];

const prices: Record<string, PriceData> = {
  'HDFCBANK.NS': {
    symbol: 'HDFCBANK.NS',
    shortName: 'HDFC Bank',
    regularMarketPrice: 200,
    currency: 'INR',
  },
  'BTC-USD': {
    symbol: 'BTC-USD',
    shortName: 'Bitcoin',
    regularMarketPrice: 40000,
    currency: 'USD',
  },
  FUNDX: {
    symbol: 'FUNDX',
    shortName: 'Retirement fund',
    regularMarketPrice: 100,
    currency: 'INR',
  },
};

const holdings = holdingExposure(assets, prices, 80);

describe('holding exposure', () => {
  it('values holdings in paise and sorts by value', () => {
    expect(holdings).toHaveLength(5);
    expect(holdings[0].symbol).toBe('BTC-USD');
    expect(holdings[0].value).toBe(320_000_000);
    expect(
      holdings.reduce((sum, holding) => sum + holding.percentage, 0),
    ).toBeCloseTo(100, 6);
  });

  it('resolves quote currencies and manual liquidity overrides', () => {
    const btc = assets.find((asset) => asset.id === 'btc');
    const fund = assets.find((asset) => asset.id === 'fund');
    const stock = assets.find((asset) => asset.id === 'hdfc');
    expect(btc && currencyFor(btc, prices)).toBe('USD');
    expect(fund && liquidityFor(fund)).toBe('Monthly');
    expect(stock && liquidityFor(stock)).toBe('Daily');
    expect(holdings.find((holding) => holding.id === 'fund')?.account).toBe(
      'Retirement',
    );
    expect(holdings.find((holding) => holding.id === 'hdfc')?.account).toBe(
      'Primary',
    );
  });

  it('prefers an explicit INR ticker over bad saved currency metadata', () => {
    const silver: Asset = {
      id: 'silver',
      symbol: 'SILVER-INR-GRAM',
      name: 'Physical Silver (Per Gram)',
      quantity: 6.2885,
      entryPrice: 159.26,
      currency: 'USD',
      type: 'COMMODITY',
    };

    expect(currencyFor(silver, {})).toBe('INR');
  });

  it('computes the share of daily and weekly liquid assets', () => {
    // Everything except the monthly fund is daily or weekly liquid.
    const total = 320_000_000 + 200_000 + 5_000_000 + 1_000_000 + 600_000;
    expect(liquidPercentage(holdings)).toBeCloseTo(
      ((total - 1_000_000) / total) * 100,
      6,
    );
  });

  it('buckets currency, liquidity and account exposure', () => {
    const currencies = currencyExposure(holdings);
    const usd = currencies.find((bucket) => bucket.key === 'USD');
    expect(usd?.value).toBe(320_000_000);
    expect(usd?.percentage).toBeCloseTo((320_000_000 / 326_800_000) * 100, 4);

    const liquidity = liquidityExposure(holdings);
    expect(liquidity.map((bucket) => bucket.key).sort()).toEqual([
      'Daily',
      'Monthly',
      'Weekly',
    ]);

    const accounts = accountExposure(holdings);
    expect(accounts.find((bucket) => bucket.key === 'Retirement')?.value).toBe(
      1_000_000,
    );
    expect(accounts.find((bucket) => bucket.key === 'Primary')?.value).toBe(
      325_800_000,
    );
  });

  it('identifies the largest concentration', () => {
    expect(topHoldingConcentration(holdings)?.symbol).toBe('BTC-USD');
    expect(topHoldingConcentration([])).toBeNull();
  });

  it('flattens group containers before valuing', () => {
    const grouped: Asset[] = [
      {
        id: 'group',
        symbol: 'GROUP',
        name: 'Group',
        quantity: 0,
        entryPrice: 0,
        currency: 'INR',
        type: 'GROUP',
        isGroup: true,
        subItems: [
          {
            id: 'leaf',
            symbol: 'LEAF',
            name: 'Leaf',
            quantity: 2,
            entryPrice: 50,
            currency: 'INR',
            type: 'STOCK',
          },
        ],
      },
    ];
    const rows = holdingExposure(grouped, {}, 80);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(10_000);
  });
});
