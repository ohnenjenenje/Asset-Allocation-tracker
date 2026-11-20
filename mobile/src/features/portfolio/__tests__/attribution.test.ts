/** @jest-environment node */

import type { AllocationNode } from '../analytics';
import type { Holding } from '../aggregate';
import {
  accountSummary,
  buildContributionReport,
} from '../attribution';
import type { Asset } from '../types';

function makeAsset(
  id: string,
  name: string,
  symbol: string,
  account?: string,
  type = 'STOCK',
): Asset {
  return {
    id,
    name,
    symbol,
    quantity: 1,
    entryPrice: 0,
    currency: 'INR',
    type,
    account,
  };
}

function makeNode(
  fullPath: string,
  constituents: { name: string; symbol: string; value: number }[],
  currentValue = 0,
): AllocationNode {
  return {
    category: fullPath.split(' > ').pop() ?? fullPath,
    fullPath,
    currentValue,
    currentPercentage: 0,
    idealPercentage: 0,
    diffPercentage: 0,
    diffValue: 0,
    constituents,
    subCategories: [],
  };
}

function makeHolding(input: {
  id: string;
  name: string;
  symbol: string;
  currentValue: number;
  investedValue: number;
  account?: string;
  type?: string;
}): Holding {
  const pnl = input.currentValue - input.investedValue;
  return {
    asset: makeAsset(
      input.id,
      input.name,
      input.symbol,
      input.account,
      input.type,
    ),
    category: 'Equities',
    currentValue: input.currentValue,
    investedValue: input.investedValue,
    pnl,
    pnlPercent: input.investedValue > 0 ? (pnl / input.investedValue) * 100 : 0,
    hasLivePrice: true,
  };
}

const holdings: Holding[] = [
  makeHolding({
    id: 'a1',
    name: 'Equity A',
    symbol: 'AAA',
    currentValue: 120_000,
    investedValue: 100_000,
    account: 'Primary',
  }),
  makeHolding({
    id: 'b1',
    name: 'Bond B',
    symbol: 'BBB',
    currentValue: 50_000,
    investedValue: 55_000,
    account: 'Retirement',
  }),
  makeHolding({
    id: 'c1',
    name: 'Cash C',
    symbol: 'CCC',
    currentValue: 30_000,
    investedValue: 30_000,
    type: 'CASH',
  }),
];

const nodes: AllocationNode[] = [
  makeNode(
    'Equities',
    [{ name: 'Equity A', symbol: 'AAA', value: 120_000 }],
    120_000,
  ),
  makeNode(
    'Fixed Income',
    [{ name: 'Bond B', symbol: 'BBB', value: 50_000 }],
    50_000,
  ),
];

describe('contribution report', () => {
  it('aggregates current unrealised P&L by sleeve', () => {
    const report = buildContributionReport({ holdings, nodes });

    expect(report.totalValue).toBe(200_000);
    expect(report.totalInvested).toBe(185_000);
    expect(report.totalPnl).toBe(15_000);
    expect(report.winners).toBe(1);
    expect(report.losers).toBe(1);

    const equities = report.bySleeve.find((row) => row.label === 'Equities');
    expect(equities?.currentValue).toBe(120_000);
    expect(equities?.pnl).toBe(20_000);
    expect(equities?.contributionPct).toBeCloseTo(10);

    const fixed = report.bySleeve.find((row) => row.label === 'Fixed Income');
    expect(fixed?.pnl).toBe(-5_000);
    expect(fixed?.contributionPct).toBeCloseTo(-2.5);
  });

  it('falls back to the holding type when no allocation constituent matches', () => {
    const report = buildContributionReport({ holdings, nodes });
    const cash = report.bySleeve.find((row) => row.label === 'Cash');
    expect(cash?.currentValue).toBe(30_000);
    expect(cash?.pnl).toBe(0);
  });

  it('sorts holdings by absolute P&L and preserves accounts', () => {
    const report = buildContributionReport({ holdings, nodes });
    expect(report.byHolding[0].label).toBe('Equity A');
    expect(report.byHolding[1].label).toBe('Bond B');
    expect(report.byHolding[0].account).toBe('Primary');
    expect(report.byHolding[1].account).toBe('Retirement');
    expect(report.byHolding[2].account).toBe('Primary');
  });

  it('splits a multi-sleeve fund proportionally to its constituents', () => {
    const fundHolding = makeHolding({
      id: 'fund',
      name: 'Balanced fund',
      symbol: 'FUND',
      currentValue: 100_000,
      investedValue: 90_000,
      account: 'Primary',
    });
    const splitNodes = [
      makeNode(
        'Equities',
        [{ name: 'Balanced fund', symbol: 'FUND', value: 60_000 }],
        60_000,
      ),
      makeNode(
        'Fixed Income',
        [{ name: 'Balanced fund', symbol: 'FUND', value: 40_000 }],
        40_000,
      ),
    ];

    const report = buildContributionReport({
      holdings: [fundHolding],
      nodes: splitNodes,
    });

    const equities = report.bySleeve.find((row) => row.label === 'Equities');
    const fixed = report.bySleeve.find((row) => row.label === 'Fixed Income');
    expect(equities?.currentValue).toBeCloseTo(60_000);
    expect(equities?.pnl).toBeCloseTo(6_000);
    expect(fixed?.currentValue).toBeCloseTo(40_000);
    expect(fixed?.pnl).toBeCloseTo(4_000);
  });
});

describe('account summary', () => {
  it('consolidates accounts with percentages, counts and P&L', () => {
    const accounts = accountSummary(holdings);
    expect(accounts).toHaveLength(2);

    const primary = accounts.find((row) => row.account === 'Primary');
    expect(primary?.currentValue).toBe(150_000);
    expect(primary?.percentage).toBeCloseTo(75);
    expect(primary?.holdings).toBe(2);
    expect(primary?.pnl).toBe(20_000);

    const retirement = accounts.find((row) => row.account === 'Retirement');
    expect(retirement?.currentValue).toBe(50_000);
    expect(retirement?.percentage).toBeCloseTo(25);
    expect(retirement?.pnl).toBe(-5_000);
  });

  it('handles an empty portfolio', () => {
    expect(accountSummary([])).toEqual([]);
  });
});
