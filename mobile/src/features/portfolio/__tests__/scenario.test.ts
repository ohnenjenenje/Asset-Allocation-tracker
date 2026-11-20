/** @jest-environment node */

import { runScenario, type StressScenario } from '../scenario';

const equityShock: StressScenario = {
  id: 'test-equity',
  name: 'Equity −20%',
  description: 'Test shock',
  shocks: { Equities: -20 },
};

describe('stress scenarios', () => {
  it('applies sleeve shocks and recomputes weights', () => {
    const result = runScenario({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 600 },
        { path: 'Cash', label: 'Cash', value: 400 },
      ],
      scenario: equityShock,
    });

    expect(result.currentTotal).toBe(1000);
    expect(result.projectedTotal).toBe(880);
    expect(result.changeValue).toBe(-120);
    expect(result.changePct).toBeCloseTo(-12);
    const equities = result.rows.find((row) => row.path === 'Equities');
    expect(equities?.projectedValue).toBe(480);
    expect(equities?.projectedPercentage).toBeCloseTo(54.55, 1);
    expect(result.breaches).toBe(0);
  });

  it('flags range breaches after the shock', () => {
    const result = runScenario({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 800 },
        { path: 'Cash', label: 'Cash', value: 200 },
      ],
      scenario: equityShock,
      ranges: { Equities: { min: 40, max: 70 } },
    });

    const equities = result.rows.find((row) => row.path === 'Equities');
    expect(equities?.projectedPercentage).toBeCloseTo(76.19, 1);
    expect(equities?.breach).toBe('above');
    expect(result.breaches).toBe(1);
  });

  it('approximates an FX translation pro-rata across sleeves', () => {
    const fx: StressScenario = {
      id: 'test-fx',
      name: 'INR −10%',
      description: 'Test FX shock',
      shocks: {},
      currencyShockPct: 10,
    };
    const result = runScenario({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 500 },
        { path: 'Crypto', label: 'Crypto', value: 500 },
      ],
      scenario: fx,
      usdValue: 300,
    });

    expect(result.projectedTotal).toBeCloseTo(1030);
    expect(result.changeValue).toBeCloseTo(30);
    for (const row of result.rows) {
      expect(row.changeValue).toBeCloseTo(15);
    }
  });

  it('never projects a negative sleeve value', () => {
    const severe: StressScenario = {
      id: 'severe',
      name: 'Severe',
      description: 'Test floor',
      shocks: { Crypto: -150 },
    };
    const result = runScenario({
      sleeves: [{ path: 'Crypto', label: 'Crypto', value: 100 }],
      scenario: severe,
    });
    expect(result.rows[0].projectedValue).toBe(0);
    expect(result.projectedTotal).toBe(0);
    expect(result.changePct).toBeCloseTo(-100);
  });

  it('leaves unlisted sleeves unchanged', () => {
    const result = runScenario({
      sleeves: [
        { path: 'Equities', label: 'Equities', value: 100 },
        { path: 'Cash', label: 'Cash', value: 100 },
      ],
      scenario: equityShock,
    });
    const cash = result.rows.find((row) => row.path === 'Cash');
    expect(cash?.projectedValue).toBe(100);
    expect(cash?.changePct).toBe(0);
  });
});
