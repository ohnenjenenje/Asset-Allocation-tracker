/** @jest-environment node */

import { analyzePortfolio } from '../analytics';
import type { Asset, FundData, PriceData } from '../types';

const asset = (
  overrides: Partial<Asset> & Pick<Asset, 'id' | 'symbol' | 'name'>,
): Asset => ({
  quantity: 1,
  entryPrice: 100,
  currency: 'INR',
  type: 'STOCK',
  ...overrides,
});

const quote = (overrides: Partial<PriceData> & Pick<PriceData, 'symbol'>): PriceData => ({
  regularMarketPrice: 100,
  currency: 'INR',
  shortName: overrides.symbol,
  ...overrides,
});

function analyze(
  assets: Asset[],
  prices: Record<string, PriceData>,
  fundHoldings: Record<string, FundData> = {},
) {
  return analyzePortfolio({
    assets,
    prices,
    fundHoldings,
    idealAllocation: {},
    usdToInr: 84,
  });
}

const fundAllocation = {
  stockPosition: 100,
  bondPosition: 0,
  cashPosition: 0,
  otherPosition: 0,
  preferredPosition: 0,
  convertiblePosition: 0,
};

describe('market-cap exposure', () => {
  it('uses NSE capCategory instead of a unit-mangled provider market cap', () => {
    const hdfc = asset({
      id: 'hdfc',
      symbol: 'HDFCBANK.NS',
      name: 'HDFC Bank Ltd',
      quantity: 9,
      entryPrice: 751.98,
    });
    const prices = {
      'HDFCBANK.NS': quote({
        symbol: 'HDFCBANK.NS',
        regularMarketPrice: 846,
        marketCap: 141_827_537_434, // provider value ~100x too small
        capCategory: 'Large Cap',
        sector: 'Financial Services',
      }),
    };

    const result = analyze([hdfc], prices);

    const large = result.marketCap.find((slice) => slice.name === 'Large Cap');
    expect(large?.constituents.map((item) => item.symbol)).toContain('HDFCBANK.NS');
    expect(result.marketCap.find((slice) => slice.name === 'Small Cap')).toBeUndefined();

    const largeRow = result.capRows.find((row) => row.cap === 'Large Cap');
    expect(largeRow?.sectors).toContainEqual({
      sector: 'Financial Services',
      value: 9 * 846 * 100,
    });
    const smallRow = result.capRows.find((row) => row.cap === 'Small Cap');
    expect(smallRow).toBeUndefined();
  });

  it('falls back to marketCap thresholds for non-Indian stocks', () => {
    const stock = asset({
      id: 'acme',
      symbol: 'ACME',
      name: 'Acme Corp',
      currency: 'USD',
      type: 'STOCK',
    });
    const prices = {
      ACME: quote({
        symbol: 'ACME',
        currency: 'USD',
        marketCap: 3_000_000_000,
        sector: 'Technology',
      }),
    };

    const result = analyze([stock], prices);

    expect(
      result.marketCap.find((slice) => slice.name === 'Mid Cap')?.constituents[0]?.symbol,
    ).toBe('ACME');
  });

  it('treats London pence market caps as pence, not pounds', () => {
    const stock = asset({
      id: 'uk',
      symbol: 'ACME.L',
      name: 'Acme UK',
      currency: 'GBp',
      type: 'STOCK',
    });
    const prices = {
      'ACME.L': quote({
        symbol: 'ACME.L',
        currency: 'GBp',
        marketCap: 100_000_000_000, // £1B, not £100B
        sector: 'Industrials',
      }),
    };

    const result = analyze([stock], prices);

    expect(
      result.marketCap.find((slice) => slice.name === 'Small Cap')?.constituents[0]?.symbol,
    ).toBe('ACME.L');
  });

  it('prefers capCategory on fund look-through holdings', () => {
    const fund = asset({
      id: 'fund',
      symbol: 'FUNDX',
      name: 'Diversified Equity Fund',
      type: 'MUTUALFUND',
      quantity: 10,
      entryPrice: 90,
    });
    const prices = {
      FUNDX: quote({ symbol: 'FUNDX', regularMarketPrice: 100 }),
      'HDFCBANK.NS': quote({
        symbol: 'HDFCBANK.NS',
        marketCap: 141_827_537_434,
        capCategory: 'Large Cap',
        sector: 'Financial Services',
      }),
      'TCS.NS': quote({
        symbol: 'TCS.NS',
        marketCap: 8_594_227_250_000,
        capCategory: 'Large Cap',
        sector: 'Technology',
      }),
    };
    const fundHoldings: Record<string, FundData> = {
      FUNDX: {
        assetAllocation: fundAllocation,
        holdings: [
          { symbol: 'HDFCBANK.NS', holdingName: 'HDFC Bank', holdingPercent: 0.5 },
          { symbol: 'TCS.NS', holdingName: 'Tata Consultancy Services', holdingPercent: 0.5 },
        ],
      },
    };

    const result = analyze([fund], prices, fundHoldings);

    const large = result.marketCap.find((slice) => slice.name === 'Large Cap');
    expect(large?.constituents[0]?.symbol).toBe('FUNDX');
    expect(large?.value).toBe(10 * 100 * 100);
    expect(result.marketCap.find((slice) => slice.name === 'Small Cap')).toBeUndefined();
  });

  it('classifies an S&P 500 / NASDAQ fund by its mandate when holdings lack quotes', () => {
    const fund = asset({
      id: 'qqqm',
      symbol: 'QQQM',
      name: 'Invesco NASDAQ 100 ETF',
      type: 'ETF',
      currency: 'USD',
      quantity: 1,
      entryPrice: 297.1,
    });
    const prices = {
      QQQM: quote({ symbol: 'QQQM', currency: 'USD', regularMarketPrice: 300 }),
    };
    const fundHoldings: Record<string, FundData> = {
      QQQM: {
        assetAllocation: fundAllocation,
        holdings: [
          { symbol: 'AAPL', holdingName: 'Apple Inc', holdingPercent: 0.08 },
          { symbol: 'NVDA', holdingName: 'NVIDIA Corp', holdingPercent: 0.08 },
        ],
      },
    };

    const result = analyze([fund], prices, fundHoldings);

    expect(
      result.marketCap.find((slice) => slice.name === 'Large Cap')?.constituents[0]?.symbol,
    ).toBe('QQQM');
    expect(result.marketCap.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();
  });

  it('does not force a large+mid blend fund into a single cap bucket', () => {
    const fund = asset({
      id: 'blend',
      symbol: 'BLENDX',
      name: 'Edelweiss NIFTY Large Midcap 250 Index Fund',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 15,
    });
    const prices = {
      BLENDX: quote({ symbol: 'BLENDX', regularMarketPrice: 18 }),
    };
    const fundHoldings: Record<string, FundData> = {
      BLENDX: {
        assetAllocation: fundAllocation,
        marketCapWeightage: {
          largeCap: 49,
          midCap: 49,
          smallCap: 2,
          others: 0,
        },
      },
    };

    const result = analyze([fund], prices, fundHoldings);

    const large = result.marketCap.find((slice) => slice.name === 'Large Cap');
    const mid = result.marketCap.find((slice) => slice.name === 'Mid Cap');
    expect(large?.value).toBeGreaterThan(0);
    expect(mid?.value).toBeGreaterThan(0);
    expect(large?.value).toBe(mid?.value);
  });
});
