/** @jest-environment node */

import type { FundSlice } from '../analytics';
import type { Holding } from '../aggregate';
import {
  analyzeStockConcentration,
  equitySleeveValue,
  normalizeStockName,
  stockConcentrationStatus,
  stockSymbolBase,
} from '../concentration';
import type { FundAssetAllocation } from '../types';

const allocation: FundAssetAllocation = {
  stockPosition: 95,
  bondPosition: 0,
  cashPosition: 5,
  otherPosition: 0,
  preferredPosition: 0,
  convertiblePosition: 0,
};

function holding({
  id,
  name,
  symbol,
  value,
  type = 'STOCK',
}: {
  id: string;
  name: string;
  symbol: string;
  value: number;
  type?: string;
}): Holding {
  return {
    asset: {
      id,
      symbol,
      name,
      quantity: 1,
      entryPrice: 0,
      currency: 'INR',
      type,
    },
    category: 'Equities',
    currentValue: value,
    investedValue: value,
    pnl: 0,
    pnlPercent: 0,
    hasLivePrice: true,
  };
}

function fund({
  name,
  value,
  holdings,
  stockPosition = 95,
}: {
  name: string;
  value: number;
  holdings: { name: string; symbol?: string; value: number }[];
  stockPosition?: number;
}): FundSlice {
  return {
    key: name,
    name,
    value,
    constituents: [
      {
        name,
        symbol: name.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        value,
        subHoldings: holdings.map((item) => ({
          name: item.name,
          symbol: item.symbol,
          value: item.value,
        })),
        assetAllocation: { ...allocation, stockPosition },
      },
    ],
  };
}

describe('stock name and symbol normalization', () => {
  it('strips legal suffixes and punctuation', () => {
    expect(normalizeStockName('HDFC Bank Ltd.')).toBe('hdfc bank');
    expect(normalizeStockName('The Tata Motors Co.')).toBe('tata motors');
    expect(normalizeStockName('Larsen & Toubro Limited')).toBe(
      'larsen and toubro',
    );
  });

  it('strips exchange suffixes without merging class shares', () => {
    expect(stockSymbolBase('HDFCBANK.NS')).toBe('HDFCBANK');
    expect(stockSymbolBase('NSE:INFY')).toBe('INFY');
    expect(stockSymbolBase('BRK-B')).toBe('BRK-B');
  });
});

describe('concentration status', () => {
  it('breaches above the cap and watches in the point below it', () => {
    expect(stockConcentrationStatus(10.01)).toBe('breach');
    expect(stockConcentrationStatus(10)).toBe('watch');
    expect(stockConcentrationStatus(9)).toBe('watch');
    expect(stockConcentrationStatus(8.99)).toBe('ok');
  });
});

describe('equity sleeve denominator', () => {
  it('prefers the Equities sleeve and falls back to the equity total', () => {
    expect(
      equitySleeveValue(
        [
          { path: 'Cash', currentValue: 10_000 },
          { path: 'Equities', currentValue: 152_000 },
        ],
        999,
      ),
    ).toBe(152_000);
    expect(
      equitySleeveValue(
        [{ path: 'Equities > Domestic Equity', currentValue: 100_000 }],
        50_000,
      ),
    ).toBe(100_000);
    expect(equitySleeveValue([{ path: 'Cash', currentValue: 10 }], 50)).toBe(50);
    expect(equitySleeveValue(undefined, 0)).toBe(0);
  });
});

describe('stock concentration', () => {
  it('merges direct lots per stock and ignores funds, ETFs and non-equities', () => {
    const report = analyzeStockConcentration({
      holdings: [
        holding({
          id: 'hdfc-1',
          name: 'HDFC Bank',
          symbol: 'HDFCBANK.NS',
          value: 12_000,
        }),
        holding({
          id: 'hdfc-2',
          name: 'HDFC Bank',
          symbol: 'HDFCBANK.NS',
          value: 8_000,
        }),
        holding({
          id: 'infy',
          name: 'Infosys',
          symbol: 'INFY.NS',
          value: 5_000,
        }),
        holding({
          id: 'etf',
          name: 'Nifty BeES',
          symbol: 'NIFTYBEES.NS',
          value: 40_000,
          type: 'ETF',
        }),
        holding({
          id: 'fund',
          name: 'Parag Parikh Flexi Cap',
          symbol: 'PPFCF',
          value: 30_000,
          type: 'MUTUALFUND',
        }),
        holding({
          id: 'btc',
          name: 'Bitcoin',
          symbol: 'BTC',
          value: 20_000,
          type: 'CRYPTO',
        }),
      ],
      funds: [],
      equityValue: 100_000,
      portfolioValue: 200_000,
    });

    expect(report.rows).toHaveLength(2);
    const hdfc = report.rows.find((row) => row.name === 'HDFC Bank');
    expect(hdfc?.directValue).toBe(20_000);
    expect(hdfc?.fundValue).toBe(0);
    expect(hdfc?.totalValue).toBe(20_000);
    expect(hdfc?.equityPercentage).toBeCloseTo(20, 6);
    expect(hdfc?.portfolioPercentage).toBeCloseTo(10, 6);
    expect(hdfc?.status).toBe('breach');
    expect(hdfc?.funds).toEqual([]);
    expect(report.directValue).toBe(25_000);
    expect(report.fundValue).toBe(0);
    expect(report.otherEquityValue).toBe(75_000);
    expect(report.breachCount).toBe(1);
    expect(report.largest?.name).toBe('HDFC Bank');
  });

  it('adds fund look-through and excludes residual rows', () => {
    const report = analyzeStockConcentration({
      holdings: [],
      funds: [
        fund({
          name: 'Flexi Cap Fund',
          value: 100_000,
          holdings: [
            { name: 'HDFC Bank Ltd', symbol: 'HDFCBANK.NS', value: 15_000 },
            { name: 'Tata Consultancy Services', symbol: 'TCS.NS', value: 8_000 },
            { name: 'Other Assets', value: 5_000 },
            { name: 'Cash & Equivalents', value: 2_000 },
            { name: 'iShares Core S&P 500 ETF', value: 3_000 },
          ],
        }),
      ],
      equityValue: 100_000,
    });

    expect(report.rows).toHaveLength(2);
    const hdfc = report.rows.find((row) => row.name.startsWith('HDFC'));
    expect(hdfc?.fundValue).toBe(15_000);
    expect(hdfc?.equityPercentage).toBeCloseTo(15, 6);
    expect(hdfc?.status).toBe('breach');
    expect(hdfc?.funds).toHaveLength(1);
    expect(hdfc?.funds[0]).toMatchObject({
      key: 'Flexi Cap Fund',
      name: 'Flexi Cap Fund',
      value: 15_000,
      fundValue: 100_000,
    });
    expect(report.directValue).toBe(0);
    expect(report.fundValue).toBe(23_000);
    expect(report.otherEquityValue).toBe(77_000);
    expect(report.coverage).toEqual({
      withData: 1,
      total: 1,
      coveredValue: 23_000,
      fundValue: 100_000,
    });
  });

  it('merges the same stock when one source has only a name', () => {
    const report = analyzeStockConcentration({
      holdings: [
        holding({
          id: 'hdfc',
          name: 'HDFC Bank',
          symbol: 'HDFCBANK.NS',
          value: 5_000,
        }),
      ],
      funds: [
        fund({
          name: 'Banking Fund',
          value: 50_000,
          holdings: [{ name: 'HDFC Bank Ltd.', value: 6_000 }],
        }),
      ],
      equityValue: 100_000,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].directValue).toBe(5_000);
    expect(report.rows[0].fundValue).toBe(6_000);
    expect(report.rows[0].totalValue).toBe(11_000);
    expect(report.rows[0].equityPercentage).toBeCloseTo(11, 6);
    expect(report.rows[0].status).toBe('breach');
  });

  it('merges a stock held through multiple funds', () => {
    const report = analyzeStockConcentration({
      holdings: [],
      funds: [
        fund({
          name: 'Fund A',
          value: 50_000,
          holdings: [{ name: 'HDFC Bank', value: 4_000 }],
        }),
        fund({
          name: 'Fund B',
          value: 50_000,
          holdings: [
            { name: 'HDFC Bank Limited', symbol: 'HDFCBANK.NS', value: 3_000 },
          ],
        }),
      ],
      equityValue: 100_000,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].directValue).toBe(0);
    expect(report.rows[0].fundValue).toBe(7_000);
    expect(report.rows[0].totalValue).toBe(7_000);
    expect(report.rows[0].funds.map((item) => item.name)).toEqual([
      'Fund A',
      'Fund B',
    ]);
    expect(report.rows[0].funds.map((item) => item.value)).toEqual([4_000, 3_000]);
    expect(report.directValue).toBe(0);
    expect(report.fundValue).toBe(7_000);
    expect(report.otherEquityValue).toBe(93_000);
    expect(report.coverage.withData).toBe(2);
    expect(report.coverage.total).toBe(2);
  });

  it('merges one fund across multiple constituents into a single source line', () => {
    const report = analyzeStockConcentration({
      holdings: [],
      funds: [
        {
          key: 'Flexi Cap Fund',
          name: 'Flexi Cap Fund',
          value: 100_000,
          constituents: [
            {
              name: 'Flexi Cap Fund',
              symbol: 'FLEXI-A',
              assetId: 'fund-a',
              value: 60_000,
              subHoldings: [
                { name: 'HDFC Bank', symbol: 'HDFCBANK.NS', value: 4_000 },
              ],
              assetAllocation: allocation,
            },
            {
              name: 'Flexi Cap Fund',
              symbol: 'FLEXI-B',
              assetId: 'fund-b',
              value: 40_000,
              subHoldings: [{ name: 'HDFC Bank', value: 2_000 }],
              assetAllocation: allocation,
            },
          ],
        },
      ],
      equityValue: 100_000,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].fundValue).toBe(6_000);
    expect(report.rows[0].funds).toHaveLength(1);
    expect(report.rows[0].funds[0]).toMatchObject({
      key: 'Flexi Cap Fund',
      name: 'Flexi Cap Fund',
      value: 6_000,
      fundValue: 100_000,
      assetId: 'fund-a',
    });
  });

  it('clamps other equity when disclosed stocks exceed the sleeve', () => {
    const report = analyzeStockConcentration({
      holdings: [
        holding({
          id: 'hdfc',
          name: 'HDFC Bank',
          symbol: 'HDFCBANK.NS',
          value: 12_000,
        }),
      ],
      funds: [],
      equityValue: 10_000,
    });

    expect(report.directValue).toBe(12_000);
    expect(report.fundValue).toBe(0);
    expect(report.otherEquityValue).toBe(0);
  });

  it('skips debt-only schemes and still counts equity-fund coverage', () => {
    const report = analyzeStockConcentration({
      holdings: [],
      funds: [
        fund({
          name: 'Short Duration Debt',
          value: 50_000,
          stockPosition: 0,
          holdings: [{ name: 'HDFC Bank', value: 10_000 }],
        }),
        fund({
          name: 'Equity Savings',
          value: 100_000,
          holdings: [{ name: 'HDFC Bank', symbol: 'HDFCBANK.NS', value: 5_000 }],
        }),
      ],
      equityValue: 100_000,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].totalValue).toBe(5_000);
    expect(report.coverage.total).toBe(1);
    expect(report.coverage.withData).toBe(1);
    expect(report.coverage.fundValue).toBe(100_000);
  });

  it('uses the equity sleeve, not the portfolio, as the denominator', () => {
    const report = analyzeStockConcentration({
      holdings: [
        holding({
          id: 'hdfc',
          name: 'HDFC Bank',
          symbol: 'HDFCBANK.NS',
          value: 10_000,
        }),
      ],
      funds: [],
      equityValue: 80_000,
      portfolioValue: 200_000,
    });

    expect(report.rows[0].equityPercentage).toBeCloseTo(12.5, 6);
    expect(report.rows[0].portfolioPercentage).toBeCloseTo(5, 6);
    expect(report.rows[0].status).toBe('breach');
  });

  it('reports coverage when an equity fund has no disclosed holdings', () => {
    const report = analyzeStockConcentration({
      holdings: [],
      funds: [
        fund({
          name: 'Fund A',
          value: 50_000,
          holdings: [{ name: 'HDFC Bank', value: 5_000 }],
        }),
        fund({ name: 'Fund B', value: 50_000, holdings: [] }),
      ],
      equityValue: 100_000,
    });

    expect(report.coverage).toEqual({
      withData: 1,
      total: 2,
      coveredValue: 5_000,
      fundValue: 100_000,
    });
  });

  it('returns an empty report when nothing is held', () => {
    const report = analyzeStockConcentration({
      holdings: [],
      funds: [],
      equityValue: 0,
    });
    expect(report.rows).toEqual([]);
    expect(report.largest).toBeNull();
    expect(report.breachCount).toBe(0);
    expect(report.coverage.total).toBe(0);
  });
});
