import { normalizeGroup } from './normalize';
import type { PolicyRange } from './types';

/**
 * Deterministic stress scenarios. They are not forecasts and they do not use
 * historical returns; they answer "if these sleeve shocks happen, what happens
 * to weights, values and policy ranges?"
 */
export interface StressScenario {
  id: string;
  name: string;
  description: string;
  /** Percentage shock by root sleeve. Unlisted sleeves are unchanged. */
  shocks: Record<string, number>;
  /** INR depreciation (positive) or appreciation (negative) applied to USD value. */
  currencyShockPct?: number;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: 'equity-shock',
    name: 'Equity −20%',
    description: 'Broad equity de-rating with a modest risk-off spillover.',
    shocks: {
      Equities: -20,
      'Fixed Income': 2,
      Commodities: -5,
      Crypto: -10,
      Cash: 0,
    },
  },
  {
    id: 'rate-shock',
    name: 'Rates +100 bp',
    description: 'Duration shock hits bonds and growth equities; cash is stable.',
    shocks: {
      Equities: -8,
      'Fixed Income': -6,
      Commodities: -3,
      Crypto: -12,
      Cash: 0,
    },
  },
  {
    id: 'gold-shock',
    name: 'Gold −15%',
    description: 'Commodity unwind with limited contagion.',
    shocks: {
      Equities: -2,
      'Fixed Income': 1,
      Commodities: -15,
      Crypto: -2,
      Cash: 0,
    },
  },
  {
    id: 'crypto-winter',
    name: 'Crypto −45%',
    description: 'A severe crypto drawdown with a small equity spillover.',
    shocks: {
      Equities: -5,
      'Fixed Income': 1,
      Commodities: -2,
      Crypto: -45,
      Cash: 0,
    },
  },
  {
    id: 'risk-off',
    name: 'Combined risk-off',
    description: 'Equities, credit, commodities and crypto fall together; cash holds.',
    shocks: {
      Equities: -25,
      'Fixed Income': 3,
      Commodities: -8,
      Crypto: -35,
      Cash: 0,
    },
  },
  {
    id: 'inr-depreciation',
    name: 'INR −10%',
    description: 'USD assets gain in INR terms; domestic assets are unchanged.',
    shocks: {
      Equities: 0,
      'Fixed Income': 0,
      Commodities: 0,
      Crypto: 0,
      Cash: 0,
    },
    currencyShockPct: 10,
  },
];

export interface ScenarioSleeveResult {
  path: string;
  label: string;
  currentValue: number;
  currentPercentage: number;
  projectedValue: number;
  projectedPercentage: number;
  changeValue: number;
  changePct: number;
  range?: PolicyRange;
  breach: 'below' | 'above' | null;
}

export interface ScenarioResult {
  scenario: StressScenario;
  currentTotal: number;
  projectedTotal: number;
  changeValue: number;
  changePct: number;
  rows: ScenarioSleeveResult[];
  breaches: number;
}

export function runScenario(input: {
  sleeves: { path: string; label: string; value: number }[];
  scenario: StressScenario;
  ranges?: Record<string, PolicyRange>;
  usdValue?: number;
}): ScenarioResult {
  const { sleeves, scenario, ranges = {}, usdValue = 0 } = input;
  const currentTotal = sleeves.reduce((sum, sleeve) => sum + sleeve.value, 0);
  const currencyEffect =
    currentTotal > 0 && scenario.currencyShockPct
      ? usdValue * (scenario.currencyShockPct / 100)
      : 0;

  // The FX effect is a portfolio-level translation. Without a currency split by
  // sleeve, allocate it pro-rata so the projected sleeve weights still sum to
  // 100%. The screen labels it as an approximation.
  const projected = sleeves.map((sleeve) => {
    const shock = scenario.shocks[normalizeGroup(sleeve.path)] ?? 0;
    const fxShare =
      currentTotal > 0 && currencyEffect !== 0
        ? currencyEffect * (sleeve.value / currentTotal)
        : 0;
    const projectedValue = Math.max(
      0,
      sleeve.value * (1 + shock / 100) + fxShare,
    );
    return { sleeve, projectedValue };
  });
  const projectedTotal = projected.reduce(
    (sum, row) => sum + row.projectedValue,
    0,
  );

  const rows: ScenarioSleeveResult[] = projected.map(({ sleeve, projectedValue }) => {
    const currentPercentage =
      currentTotal > 0 ? (sleeve.value / currentTotal) * 100 : 0;
    const projectedPercentage =
      projectedTotal > 0 ? (projectedValue / projectedTotal) * 100 : 0;
    const range = ranges[normalizeGroup(sleeve.path)];
    const breach =
      range == null
        ? null
        : projectedPercentage < range.min
          ? 'below'
          : projectedPercentage > range.max
            ? 'above'
            : null;
    return {
      path: sleeve.path,
      label: sleeve.label,
      currentValue: sleeve.value,
      currentPercentage,
      projectedValue,
      projectedPercentage,
      changeValue: projectedValue - sleeve.value,
      changePct: sleeve.value > 0 ? ((projectedValue - sleeve.value) / sleeve.value) * 100 : 0,
      range,
      breach: range ? breach : null,
    };
  });

  return {
    scenario,
    currentTotal,
    projectedTotal,
    changeValue: projectedTotal - currentTotal,
    changePct: currentTotal > 0 ? ((projectedTotal - currentTotal) / currentTotal) * 100 : 0,
    rows: rows.sort((a, b) => b.projectedValue - a.projectedValue),
    breaches: rows.filter((row) => row.breach != null).length,
  };
}
