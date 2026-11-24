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

    const large = result.marketCap.find((slice) => slice.name === 'Large Cap');
    expect(large?.constituents[0]?.symbol).toBe('QQQM');
    expect(large?.regions).toEqual({ domestic: 0, global: 300 * 84 * 100 });
    expect(result.marketCap.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();

    const global = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Global Equity');
    expect(global?.subCategories.map((node) => node.fullPath)).toEqual([
      'Equities > Global Equity > Large Cap',
    ]);
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

  it('classifies a global fund by mandate when the provider has no weights', () => {
    const fund = asset({
      id: 'china',
      symbol: 'MF_140243',
      name: 'Edelweiss Greater China Equity Off-shore Fund - Direct Plan - Growth',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      MF_140243: quote({ symbol: 'MF_140243', regularMarketPrice: 10 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_140243: {
        assetAllocation: fundAllocation,
        holdings: [
          { symbol: 'JPM Greater China I2 acc USD', holdingName: 'JPM Greater China I2 acc USD', holdingPercent: 0.54 },
        ],
        sectorWeightings: [],
        marketCapWeightage: null,
      },
    };

    const result = analyze([fund], prices, fundHoldings);

    expect(result.marketCap.find((slice) => slice.name === 'Global Equity')?.value).toBe(
      100 * 10 * 100,
    );
    expect(result.marketCap.find((slice) => slice.name === 'Global Equity')?.regions).toEqual({
      domestic: 0,
      global: 100 * 10 * 100,
    });
    expect(result.sectors.find((slice) => slice.name === 'Unclassified Equity')?.value).toBe(
      100 * 10 * 100,
    );
    expect(result.marketCap.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();
    expect(result.sectors.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();

    const global = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Global Equity');
    expect(global?.subCategories.map((node) => node.fullPath)).toEqual([
      'Equities > Global Equity > Diversified',
    ]);
    expect(global?.currentValue).toBe(100 * 10 * 100);
  });

  it('uses Yahoo sector weights for a global fund without cap weights', () => {
    const fund = asset({
      id: 'china-sectors',
      symbol: 'MF_140243',
      name: 'Edelweiss Greater China Equity Off-shore Fund - Direct Plan - Growth',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      MF_140243: quote({ symbol: 'MF_140243', regularMarketPrice: 10 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_140243: {
        assetAllocation: fundAllocation,
        holdings: [
          {
            symbol: 'JPM Greater China I2 acc USD',
            holdingName: 'JPM Greater China I2 acc USD',
            holdingPercent: 0.5395,
          },
        ],
        sectorWeightings: [
          { sector: 'Technology', percentage: 47.64 },
          { sector: 'Financial Services', percentage: 14.87 },
          { sector: 'Consumer Cyclical', percentage: 12.2 },
          { sector: 'Communication Services', percentage: 10.77 },
          { sector: 'Industrials', percentage: 8.53 },
          { sector: 'Healthcare', percentage: 2.03 },
          { sector: 'Basic Materials', percentage: 1.91 },
          { sector: 'Consumer Defensive', percentage: 1.4 },
          { sector: 'Real Estate', percentage: 0.63 },
        ],
        marketCapWeightage: null,
      },
    };

    const result = analyze([fund], prices, fundHoldings);
    const equityValue = 100 * 10 * 100;

    expect(result.marketCap.find((slice) => slice.name === 'Global Equity')?.value).toBe(
      equityValue,
    );
    const technology = result.sectors.find((slice) => slice.name === 'Technology')?.value ?? 0;
    expect(technology).toBeGreaterThan(equityValue * 0.476);
    expect(technology).toBeLessThan(equityValue * 0.477);
    expect(result.sectors.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(
      equityValue,
      0,
    );
    expect(result.sectors.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();
    expect(result.sectors.find((slice) => slice.name === 'Unclassified Equity')).toBeUndefined();
  });

  it('folds provider "others" into known caps instead of charting Other', () => {
    const fund = asset({
      id: 'axis-small',
      symbol: 'MF_125354',
      name: 'Axis Small Cap Fund - Direct Plan - Growth',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 50,
    });
    const prices = {
      MF_125354: quote({ symbol: 'MF_125354', regularMarketPrice: 50 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_125354: {
        assetAllocation: fundAllocation,
        marketCapWeightage: {
          largeCap: 5.37,
          midCap: 13.25,
          smallCap: 66.01,
          others: 15.37,
        },
      },
    };

    const result = analyze([fund], prices, fundHoldings);
    const equityValue = 100 * 50 * 100;

    expect(
      result.marketCap.find((slice) => slice.name === 'Other / Uncategorized'),
    ).toBeUndefined();
    expect(result.marketCap.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(
      equityValue,
      0,
    );
    const small = result.marketCap.find((slice) => slice.name === 'Small Cap');
    expect(small?.value).toBeCloseTo(equityValue * 0.8138, 0);
    expect(small?.regions?.global).toBe(0);
    expect(small?.regions?.domestic).toBeCloseTo(equityValue * 0.8138, 0);

    const domestic = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Domestic Equity');
    expect(domestic?.subCategories.map((node) => node.fullPath)).toEqual(
      expect.arrayContaining(['Equities > Domestic Equity > Small Cap']),
    );
  });

  it('scales partial sector weights to the equity sleeve', () => {
    const fund = asset({
      id: 'flexi',
      symbol: 'MF_118955',
      name: 'HDFC Flexi Cap Fund - Growth Option - Direct Plan',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 20,
    });
    const prices = {
      MF_118955: quote({ symbol: 'MF_118955', regularMarketPrice: 20 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_118955: {
        assetAllocation: fundAllocation,
        sectorWeightings: [
          { sector: 'Financial Services', percentage: 36.04 },
          { sector: 'Consumer Cyclical', percentage: 16.74 },
          { sector: 'Healthcare', percentage: 11.15 },
          { sector: 'Technology', percentage: 10.04 },
          { sector: 'Industrials', percentage: 8.91 },
          { sector: 'Energy', percentage: 7.12 },
          { sector: 'Consumer Defensive', percentage: 4.9 },
        ],
        marketCapWeightage: {
          largeCap: 75.37,
          midCap: 9.54,
          smallCap: 9.35,
          others: 5.74,
        },
      },
    };

    const result = analyze([fund], prices, fundHoldings);
    const equityValue = 100 * 20 * 100;

    expect(result.sectors.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();
    expect(result.sectors.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(
      equityValue,
      0,
    );
  });

  it('gives a blend fund with only sector data a descriptive cap bucket', () => {
    const fund = asset({
      id: 'blend2',
      symbol: 'MF_149343',
      name: 'Edelweiss NIFTY Large Midcap 250 - Direct Growth',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      MF_149343: quote({ symbol: 'MF_149343', regularMarketPrice: 10 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_149343: {
        assetAllocation: fundAllocation,
        sectorWeightings: [{ sector: 'Financial Services', percentage: 99.7 }],
        marketCapWeightage: null,
      },
    };

    const result = analyze([fund], prices, fundHoldings);

    const diversified = result.marketCap.find((slice) => slice.name === 'Diversified Equity');
    expect(diversified?.value).toBe(100 * 10 * 100);
    expect(diversified?.regions).toEqual({ domestic: 100 * 10 * 100, global: 0 });
    expect(result.marketCap.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();
    expect(result.capRows.find((row) => row.cap === 'Diversified Equity')?.total).toBe(
      100 * 10 * 100,
    );

    const domestic = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Domestic Equity');
    expect(domestic?.subCategories.map((node) => node.fullPath)).toEqual([
      'Equities > Domestic Equity > Diversified',
    ]);
  });

  it('folds provider sector aliases into one canonical slice', () => {
    const fund = asset({
      id: 'nifty-bees',
      symbol: 'MF_140084',
      name: 'Nippon India ETF Nifty 50 BeES',
      type: 'ETF',
      quantity: 10,
      entryPrice: 200,
    });
    const prices = {
      MF_140084: quote({ symbol: 'MF_140084', regularMarketPrice: 200 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_140084: {
        assetAllocation: fundAllocation,
        sectorWeightings: [
          { sector: 'Financials', percentage: 39.5 },
          { sector: 'Information Technology', percentage: 7.6 },
          { sector: 'Consumer Discretionary', percentage: 8 },
          { sector: 'Materials', percentage: 7.3 },
          { sector: 'Consumer Staples', percentage: 5.4 },
          { sector: 'Health Care', percentage: 4.6 },
          { sector: 'Aerospace & Defense', percentage: 1.2 },
          { sector: 'Energy', percentage: 8.4 },
          { sector: 'Industrials', percentage: 8.1 },
          { sector: 'Communication Services', percentage: 7.6 },
          { sector: 'Utilities', percentage: 2.2 },
        ],
      },
    };

    const result = analyze([fund], prices, fundHoldings);
    const equityValue = 10 * 200 * 100;
    const names = result.sectors.map((slice) => slice.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'Financial Services',
        'Technology',
        'Consumer Cyclical',
        'Basic Materials',
        'Consumer Defensive',
        'Healthcare',
        'Industrials',
      ]),
    );
    for (const raw of [
      'Financials',
      'Information Technology',
      'Consumer Discretionary',
      'Materials',
      'Consumer Staples',
      'Health Care',
      'Aerospace & Defense',
    ]) {
      expect(names).not.toContain(raw);
    }
    const financialServices = result.sectors.find(
      (slice) => slice.name === 'Financial Services',
    )?.value;
    expect(financialServices).toBeGreaterThan(equityValue * 0.394);
    expect(financialServices).toBeLessThan(equityValue * 0.396);
  });

  it('canonicalizes direct quote sector aliases', () => {
    const stock = asset({
      id: 'hdfc',
      symbol: 'HDFCBANK.NS',
      name: 'HDFC Bank Ltd',
      type: 'EQUITY',
      quantity: 10,
      entryPrice: 800,
    });
    const prices = {
      'HDFCBANK.NS': quote({
        symbol: 'HDFCBANK.NS',
        regularMarketPrice: 800,
        capCategory: 'Large Cap',
        sector: 'Financials',
      }),
    };

    const result = analyze([stock], prices);

    expect(result.sectors.find((slice) => slice.name === 'Financial Services')?.value).toBe(
      10 * 800 * 100,
    );
    expect(result.sectors.find((slice) => slice.name === 'Financials')).toBeUndefined();
  });

  it('keeps provider size weights inside Global Equity', () => {
    const fund = asset({
      id: 'global-weights',
      symbol: 'MF_GLOBAL',
      name: 'Global Equity Opportunities Fund',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      MF_GLOBAL: quote({ symbol: 'MF_GLOBAL', regularMarketPrice: 10 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_GLOBAL: {
        assetAllocation: fundAllocation,
        marketCapWeightage: { largeCap: 60, midCap: 30, smallCap: 10, others: 0 },
      },
    };

    const result = analyze([fund], prices, fundHoldings);
    const equityValue = 100 * 10 * 100;

    expect(result.marketCap.find((slice) => slice.name === 'Large Cap')?.regions).toEqual({
      domestic: 0,
      global: equityValue * 0.6,
    });
    expect(result.marketCap.find((slice) => slice.name === 'Mid Cap')?.regions).toEqual({
      domestic: 0,
      global: equityValue * 0.3,
    });
    expect(result.marketCap.find((slice) => slice.name === 'Small Cap')?.regions).toEqual({
      domestic: 0,
      global: equityValue * 0.1,
    });
    expect(result.marketCap.find((slice) => slice.name === 'Global Equity')).toBeUndefined();

    const global = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Global Equity');
    expect(global?.subCategories.map((node) => node.fullPath)).toEqual(
      expect.arrayContaining([
        'Equities > Global Equity > Large Cap',
        'Equities > Global Equity > Mid Cap',
        'Equities > Global Equity > Small Cap',
      ]),
    );
    const domestic = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Domestic Equity');
    expect(domestic).toBeUndefined();
  });

  it('keeps provider "others" as Global – Diversified when no size mandate exists', () => {
    const fund = asset({
      id: 'global-others',
      symbol: 'MF_GLOBAL_OTHERS',
      name: 'Global Equity Opportunities Fund',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      MF_GLOBAL_OTHERS: quote({ symbol: 'MF_GLOBAL_OTHERS', regularMarketPrice: 10 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_GLOBAL_OTHERS: {
        assetAllocation: fundAllocation,
        marketCapWeightage: { largeCap: 50, midCap: 20, smallCap: 10, others: 20 },
      },
    };

    const result = analyze([fund], prices, fundHoldings);
    const equityValue = 100 * 10 * 100;

    const diversified = result.marketCap.find((slice) => slice.name === 'Global Equity');
    expect(diversified?.value).toBeCloseTo(equityValue * 0.2, 0);
    expect(diversified?.regions).toEqual({ domestic: 0, global: equityValue * 0.2 });
    expect(result.marketCap.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(
      equityValue,
      0,
    );
    expect(result.marketCap.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();

    const global = result.allocationAnalysis
      .find((node) => node.fullPath === 'Equities')
      ?.subCategories.find((node) => node.fullPath === 'Equities > Global Equity');
    expect(global?.subCategories.map((node) => node.fullPath)).toEqual(
      expect.arrayContaining(['Equities > Global Equity > Diversified']),
    );
  });

  it('does not extrapolate from a holdings sample below the 5% guard', () => {
    const fund = asset({
      id: 'tiny-sample',
      symbol: 'MF_TINY',
      name: 'ABC Equity Fund',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      MF_TINY: quote({ symbol: 'MF_TINY', regularMarketPrice: 10 }),
      'TINYCO.NS': quote({
        symbol: 'TINYCO.NS',
        capCategory: 'Large Cap',
        sector: 'Technology',
      }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_TINY: {
        assetAllocation: fundAllocation,
        holdings: [
          { symbol: 'TINYCO.NS', holdingName: 'Tiny Co', holdingPercent: 0.01 },
          { symbol: 'UNKNOWN', holdingName: 'Unknown Holding', holdingPercent: 0.99 },
        ],
      },
    };

    const result = analyze([fund], prices, fundHoldings);

    expect(result.marketCap.find((slice) => slice.name === 'Large Cap')).toBeUndefined();
    expect(result.marketCap.find((slice) => slice.name === 'Diversified Equity')?.value).toBe(
      100 * 10 * 100,
    );
  });

  it('reconciles region splits across market cap and the sector matrix', () => {
    const stock = asset({
      id: 'hdfc',
      symbol: 'HDFCBANK.NS',
      name: 'HDFC Bank Ltd',
      type: 'EQUITY',
      quantity: 10,
      entryPrice: 800,
    });
    const domesticFund = asset({
      id: 'axis-small',
      symbol: 'MF_125354',
      name: 'Axis Small Cap Fund - Direct Plan - Growth',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 50,
    });
    const qqqm = asset({
      id: 'qqqm',
      symbol: 'QQQM',
      name: 'Invesco NASDAQ 100 ETF',
      type: 'ETF',
      currency: 'USD',
      quantity: 1,
      entryPrice: 300,
    });
    const china = asset({
      id: 'china',
      symbol: 'MF_140243',
      name: 'Edelweiss Greater China Equity Off-shore Fund',
      type: 'MUTUALFUND',
      quantity: 100,
      entryPrice: 10,
    });
    const prices = {
      'HDFCBANK.NS': quote({
        symbol: 'HDFCBANK.NS',
        regularMarketPrice: 800,
        capCategory: 'Large Cap',
        sector: 'Financial Services',
      }),
      MF_125354: quote({ symbol: 'MF_125354', regularMarketPrice: 50 }),
      QQQM: quote({ symbol: 'QQQM', regularMarketPrice: 300, currency: 'USD' }),
      MF_140243: quote({ symbol: 'MF_140243', regularMarketPrice: 10 }),
    };
    const fundHoldings: Record<string, FundData> = {
      MF_125354: {
        assetAllocation: fundAllocation,
        marketCapWeightage: { largeCap: 5.37, midCap: 13.25, smallCap: 66.01, others: 15.37 },
      },
      QQQM: { assetAllocation: fundAllocation },
      MF_140243: {
        assetAllocation: fundAllocation,
        holdings: [
          {
            symbol: 'JPM Greater China I2 acc USD',
            holdingName: 'JPM Greater China I2 acc USD',
            holdingPercent: 0.5395,
          },
        ],
      },
    };

    const result = analyze([stock, domesticFund, qqqm, china], prices, fundHoldings);
    const equity = result.totals.equity;

    expect(result.marketCap.reduce((sum, slice) => sum + slice.value, 0)).toBeCloseTo(
      equity,
      0,
    );
    expect(result.capRows.reduce((sum, row) => sum + row.total, 0)).toBeCloseTo(equity, 0);
    for (const slice of result.marketCap) {
      expect((slice.regions?.domestic ?? 0) + (slice.regions?.global ?? 0)).toBeCloseTo(
        slice.value,
        0,
      );
    }
    for (const row of result.capRows) {
      expect(row.regions.domestic + row.regions.global).toBeCloseTo(row.total, 0);
    }
    expect(result.marketCap.find((slice) => slice.name === 'Other / Uncategorized')).toBeUndefined();

    const qqqmValue = 300 * 84 * 100;
    expect(result.marketCap.find((slice) => slice.name === 'Large Cap')?.regions?.global).toBeCloseTo(
      qqqmValue,
      0,
    );
  });
});
