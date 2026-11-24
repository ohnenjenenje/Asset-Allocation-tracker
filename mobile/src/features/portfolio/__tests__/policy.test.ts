/** @jest-environment node */

import { analyzePortfolio } from '../analytics';
import { buildPolicyUpdate, evaluatePolicy, resolvePolicyConfig } from '../policy';
import type { Asset, FundData, Policy, PriceData } from '../types';

const existing: Policy = {
  id: 'policy-household',
  version: 4,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  createdAt: '2025-04-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  baseCurrency: 'INR',
  targets: { Equities: 60, 'Fixed Income': 40 },
  bands: { Equities: 3, 'Fixed Income': 3 },
  rebalance: { method: 'threshold', cashFlowFirst: true, minCashPct: 5 },
  reviewCadence: 'quarterly',
  confirmedAt: '2026-01-01T00:00:00.000Z',
  source: 'custom',
  notes: 'Old mandate note',
  approvedBy: 'Investment committee',
  changeNote: 'Initial policy',
};

function update(
  overrides: { notes?: string; approvedBy?: string; changeNote?: string } = {},
) {
  return buildPolicyUpdate({
    existing,
    targets: existing.targets,
    bands: existing.bands,
    ...overrides,
  });
}

describe('buildPolicyUpdate', () => {
  it('clears governance text when empty strings are supplied', () => {
    const next = update({ notes: '', approvedBy: '', changeNote: '' });

    expect(next.notes).toBe('');
    expect(next.approvedBy).toBe('');
    expect(next.changeNote).toBe('');
  });

  it('preserves governance text when the fields are omitted', () => {
    const next = update();

    expect(next.notes).toBe(existing.notes);
    expect(next.approvedBy).toBe(existing.approvedBy);
    expect(next.changeNote).toBe(existing.changeNote);
  });

  it('records a new confirmed custom version on every save', () => {
    const next = update({ notes: 'Updated mandate' });

    expect(next.id).toBe(existing.id);
    expect(next.version).toBe(existing.version + 1);
    expect(next.source).toBe('custom');
    expect(next.confirmedAt).not.toBeNull();
    expect(next.notes).toBe('Updated mandate');
  });
});

describe('evaluatePolicy with global size composition', () => {
  const asset = (
    overrides: Partial<Asset> & Pick<Asset, 'id' | 'symbol' | 'name'>,
  ): Asset => ({
    quantity: 1,
    entryPrice: 100,
    currency: 'INR',
    type: 'STOCK',
    ...overrides,
  });

  const quote = (
    overrides: Partial<PriceData> & Pick<PriceData, 'symbol'>,
  ): PriceData => ({
    regularMarketPrice: 100,
    currency: 'INR',
    shortName: overrides.symbol,
    ...overrides,
  });

  const fundAllocation = {
    stockPosition: 100,
    bondPosition: 0,
    cashPosition: 0,
    otherPosition: 0,
    preferredPosition: 0,
    convertiblePosition: 0,
  };

  it('does not turn global size children into unmanaged policy sleeves', () => {
    const targets = {
      Equities: 60,
      'Fixed Income': 40,
      'Equities > Global Equity': 30,
      'Equities > Domestic Equity': 70,
    };
    const assets = [
      asset({
        id: 'qqqm',
        symbol: 'QQQM',
        name: 'Invesco NASDAQ 100 ETF',
        type: 'ETF',
        currency: 'USD',
        quantity: 1,
        entryPrice: 300,
      }),
      asset({
        id: 'voo',
        symbol: 'VOO',
        name: 'Vanguard S&P 500 ETF',
        type: 'ETF',
        currency: 'USD',
        quantity: 1,
        entryPrice: 600,
      }),
      asset({
        id: 'china',
        symbol: 'MF_140243',
        name: 'Edelweiss Greater China Equity Off-shore Fund',
        type: 'MUTUALFUND',
        quantity: 100,
        entryPrice: 10,
      }),
      asset({
        id: 'hdfc',
        symbol: 'HDFCBANK.NS',
        name: 'HDFC Bank Ltd',
        type: 'EQUITY',
        quantity: 10,
        entryPrice: 800,
      }),
    ];
    const prices = {
      QQQM: quote({ symbol: 'QQQM', regularMarketPrice: 300, currency: 'USD' }),
      VOO: quote({ symbol: 'VOO', regularMarketPrice: 600, currency: 'USD' }),
      MF_140243: quote({ symbol: 'MF_140243', regularMarketPrice: 10 }),
      'HDFCBANK.NS': quote({
        symbol: 'HDFCBANK.NS',
        regularMarketPrice: 800,
        capCategory: 'Large Cap',
      }),
    };
    const fundHoldings: Record<string, FundData> = {
      QQQM: { assetAllocation: fundAllocation },
      VOO: { assetAllocation: fundAllocation },
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

    const analytics = analyzePortfolio({
      assets,
      prices,
      fundHoldings,
      idealAllocation: targets,
      usdToInr: 84,
    });
    const config = resolvePolicyConfig({ settingsAllocation: targets });
    const evaluation = evaluatePolicy({
      nodes: analytics.allocationAnalysis,
      config,
      total: analytics.totals.portfolio,
    });

    const expectedGlobal = 300 * 84 * 100 + 600 * 84 * 100 + 100 * 10 * 100;
    expect(config.targets['Equities > Global Equity']).toBe(30);
    expect(config.effectiveTargets['Equities > Global Equity']).toBeCloseTo(18, 5);
    expect(
      evaluation.sleeves.every((sleeve) => !sleeve.path.includes('Global Equity >')),
    ).toBe(true);

    const unmanagedPaths = evaluation.unmanaged.map((slice) => slice.path);
    expect(unmanagedPaths).not.toContain('Equities > Global Equity > Large Cap');
    expect(unmanagedPaths).not.toContain('Equities > Global Equity > Diversified');
    expect(unmanagedPaths).not.toContain('Equities > Domestic Equity > Large Cap');
    expect(unmanagedPaths).toEqual([]);

    const equities = analytics.allocationAnalysis.find(
      (node) => node.fullPath === 'Equities',
    );
    const global = equities?.subCategories.find(
      (node) => node.fullPath === 'Equities > Global Equity',
    );
    expect(global?.currentValue).toBeCloseTo(expectedGlobal, 0);
    expect(global?.idealPercentage).toBeCloseTo(18, 5);
    expect(global?.subCategories.map((node) => node.fullPath)).toEqual(
      expect.arrayContaining([
        'Equities > Global Equity > Large Cap',
        'Equities > Global Equity > Diversified',
      ]),
    );
  });
});
