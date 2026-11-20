/** @jest-environment node */

import {
  computeRiskBudget,
  defaultVolatilityFor,
} from '../risk';
import type { PolicyRiskModel } from '../types';

const model: PolicyRiskModel = {
  volatility: { Equities: 20, 'Fixed Income': 5, Cash: 1 },
  correlation: 0,
};

describe('risk budgeting', () => {
  it('computes portfolio volatility and contribution percentages', () => {
    const report = computeRiskBudget({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 600 },
        { path: 'Fixed Income', label: 'Fixed Income', value: 400 },
      ],
      model,
      totalValue: 1000,
    });

    expect(report.portfolioVolatilityPct).toBeCloseTo(12.17, 1);
    expect(report.rows[0].path).toBe('Equities');
    expect(report.rows[0].contributionPct).toBeGreaterThan(95);
    expect(
      report.rows.reduce((sum, row) => sum + row.contributionPct, 0),
    ).toBeCloseTo(100, 4);
    expect(report.diversificationBenefitPp).toBeCloseTo(
      0.6 * 20 + 0.4 * 5 - report.portfolioVolatilityPct,
      4,
    );
    expect(report.topRiskPath).toBe('Equities');
  });

  it('reduces diversification benefit when correlation is one', () => {
    const report = computeRiskBudget({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 600 },
        { path: 'Fixed Income', label: 'Fixed Income', value: 400 },
      ],
      model: { ...model, correlation: 1 },
      totalValue: 1000,
    });

    expect(report.portfolioVolatilityPct).toBeCloseTo(14, 6);
    expect(report.diversificationBenefitPp).toBeCloseTo(0, 6);
  });

  it('compares risk contribution with the stated budget', () => {
    const base = {
      sleeves: [{ path: 'Equities', label: 'Equities', value: 100 }],
      model,
      totalValue: 100,
    };
    expect(computeRiskBudget({ ...base, budget: { Equities: 100 } }).rows[0].status).toBe(
      'within',
    );
    expect(computeRiskBudget({ ...base, budget: { Equities: 94 } }).rows[0].status).toBe(
      'watch',
    );
    const breach = computeRiskBudget({ ...base, budget: { Equities: 50 } });
    expect(breach.rows[0].status).toBe('breach');
    expect(breach.rows[0].gapPp).toBeCloseTo(50, 4);
    expect(breach.breachCount).toBe(1);
    expect(breach.status).toBe('breach');
  });

  it('treats cash as uncorrelated in a mixed portfolio', () => {
    const cash = computeRiskBudget({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 500 },
        { path: 'Cash', label: 'Cash', value: 500 },
      ],
      model,
      totalValue: 1000,
    });

    const cashRow = cash.rows.find((row) => row.path === 'Cash');
    expect(cashRow?.contributionPct).toBeLessThan(1);
    expect(cash.portfolioVolatilityPct).toBeLessThan(11);
  });

  it('returns an empty report when nothing is valued', () => {
    const report = computeRiskBudget({
      sleeves: [],
      model,
      totalValue: 0,
    });
    expect(report.rows).toEqual([]);
    expect(report.portfolioVolatilityPct).toBe(0);
    expect(report.status).toBe('ok');
  });

  it('keeps explicit volatility assumptions visible', () => {
    expect(defaultVolatilityFor('Equities')).toBe(18);
    expect(defaultVolatilityFor('Fixed Income')).toBe(6);
    expect(defaultVolatilityFor('Crypto')).toBe(55);
    expect(defaultVolatilityFor('Something Custom')).toBe(12);
  });
});
