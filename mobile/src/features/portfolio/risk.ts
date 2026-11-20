import { normalizeGroup } from './normalize';
import type { PolicyRiskModel } from './types';

/**
 * Transparent risk budgeting. Expected volatility and correlation are explicit
 * assumptions, not forecasts. The model answers one question: how much of the
 * portfolio's estimated risk comes from each sleeve, and how does that compare
 * with the risk budget the policy intends?
 */
export interface RiskSleeveInput {
  path: string;
  label: string;
  value: number;
  weightPct?: number;
}

export type RiskBudgetStatus = 'unbudgeted' | 'within' | 'watch' | 'breach';

export interface RiskContributionRow {
  path: string;
  label: string;
  weightPct: number;
  volatilityPct: number;
  contributionPct: number;
  contributionValue: number;
  budgetPct: number | null;
  gapPp: number | null;
  status: RiskBudgetStatus;
}

export interface RiskBudgetReport {
  rows: RiskContributionRow[];
  portfolioVolatilityPct: number;
  diversificationBenefitPp: number;
  topRiskPath: string | null;
  topRiskPct: number;
  budgeted: boolean;
  budgetTotal: number;
  breachCount: number;
  watchCount: number;
  status: 'ok' | 'watch' | 'breach';
}

function correlationFor(
  a: string,
  b: string,
  model: PolicyRiskModel,
): number {
  if (a === b) return 1;
  const explicit =
    model.correlations?.[`${a}|${b}`] ?? model.correlations?.[`${b}|${a}`];
  if (Number.isFinite(explicit)) return Math.min(1, Math.max(-1, Number(explicit)));
  if (a === 'Cash' || b === 'Cash') return 0;
  if (
    (a === 'Equities' && b === 'Crypto') ||
    (a === 'Crypto' && b === 'Equities')
  ) {
    return 0.45;
  }
  return model.correlation;
}

export function computeRiskBudget(input: {
  sleeves: RiskSleeveInput[];
  model: PolicyRiskModel;
  budget?: Record<string, number>;
  totalValue: number;
}): RiskBudgetReport {
  const { sleeves, model, budget, totalValue } = input;
  const active = sleeves
    .map((sleeve) => ({
      ...sleeve,
      weightPct:
        sleeve.weightPct ??
        (totalValue > 0 ? (sleeve.value / totalValue) * 100 : 0),
      volatilityPct: Number(
        model.volatility[normalizeGroup(sleeve.path)] ?? 12,
      ),
    }))
    .filter((sleeve) => sleeve.weightPct > 0);

  if (active.length === 0) {
    return {
      rows: [],
      portfolioVolatilityPct: 0,
      diversificationBenefitPp: 0,
      topRiskPath: null,
      topRiskPct: 0,
      budgeted: false,
      budgetTotal: 0,
      breachCount: 0,
      watchCount: 0,
      status: 'ok',
    };
  }

  const weights = active.map((sleeve) => sleeve.weightPct / 100);
  const vols = active.map((sleeve) => sleeve.volatilityPct / 100);
  const covariance = active.map((a, i) =>
    active.map(
      (b, j) =>
        correlationFor(normalizeGroup(a.path), normalizeGroup(b.path), model) *
        vols[i] *
        vols[j],
    ),
  );

  const variance = weights.reduce(
    (sum, weight, i) =>
      sum +
      weights.reduce(
        (inner, otherWeight, j) =>
          inner + weight * otherWeight * covariance[i][j],
        0,
      ),
    0,
  );
  const portfolioVolatility = Math.sqrt(Math.max(0, variance));
  const weightedVol = weights.reduce(
    (sum, weight, index) => sum + weight * vols[index],
    0,
  );

  const budgetMap: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(budget ?? {})) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value >= 0) {
      budgetMap[normalizeGroup(rawPath)] = value;
    }
  }
  const budgeted = Object.keys(budgetMap).length > 0;

  const rows: RiskContributionRow[] = active.map((sleeve, i) => {
    const marginal = weights.reduce(
      (sum, weight, j) => sum + weight * covariance[i][j],
      0,
    );
    const contributionValue =
      portfolioVolatility > 0 ? (weights[i] * marginal) / portfolioVolatility : 0;
    const contributionPct =
      portfolioVolatility > 0 ? (contributionValue / portfolioVolatility) * 100 : 0;
    const target = budgetMap[normalizeGroup(sleeve.path)];
    const budgetPct = target ?? null;
    const gapPp = budgetPct == null ? null : contributionPct - budgetPct;
    const status: RiskBudgetStatus =
      budgetPct == null
        ? 'unbudgeted'
        : gapPp == null
          ? 'within'
          : Math.abs(gapPp) > 10
            ? 'breach'
            : Math.abs(gapPp) > 5
              ? 'watch'
              : 'within';

    return {
      path: sleeve.path,
      label: sleeve.label,
      weightPct: sleeve.weightPct,
      volatilityPct: sleeve.volatilityPct,
      contributionPct,
      contributionValue: contributionValue * totalValue,
      budgetPct,
      gapPp,
      status,
    };
  });

  const budgetTotal = Object.values(budgetMap).reduce((sum, value) => sum + value, 0);
  const top = [...rows].sort((a, b) => b.contributionPct - a.contributionPct)[0];
  const breachCount = rows.filter((row) => row.status === 'breach').length;
  const watchCount = rows.filter((row) => row.status === 'watch').length;

  return {
    rows: rows.sort((a, b) => b.contributionPct - a.contributionPct),
    portfolioVolatilityPct: portfolioVolatility * 100,
    diversificationBenefitPp: Math.max(0, weightedVol * 100 - portfolioVolatility * 100),
    topRiskPath: top?.path ?? null,
    topRiskPct: top?.contributionPct ?? 0,
    budgeted,
    budgetTotal: Math.round(budgetTotal * 100) / 100,
    breachCount,
    watchCount,
    status: breachCount > 0 ? 'breach' : watchCount > 0 ? 'watch' : 'ok',
  };
}

/** Volatility assumptions are editable, but never silently replaced. */
export function defaultVolatilityFor(path: string): number {
  const key = normalizeGroup(path);
  switch (key) {
    case 'Equities':
      return 18;
    case 'Fixed Income':
      return 6;
    case 'Commodities':
      return 16;
    case 'Crypto':
      return 55;
    case 'Cash':
      return 1;
    default:
      return 12;
  }
}
