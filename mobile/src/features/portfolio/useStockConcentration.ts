import { useMemo } from 'react';

import type { FundSlice } from './analytics';
import type { Holding } from './aggregate';
import {
  analyzeStockConcentration,
  equitySleeveValue,
  type StockConcentrationReport,
} from './concentration';

interface ConcentrationSleeve {
  path: string;
  label?: string;
  currentValue: number;
}

interface UseStockConcentrationInput {
  holdings: Holding[];
  funds: FundSlice[];
  /** Policy sleeves, used to resolve the Equities denominator. */
  sleeves?: ConcentrationSleeve[];
  /** Falls back to the analytics equity total before a policy is confirmed. */
  equityValue: number;
  portfolioValue?: number;
  limitPct?: number;
}

/**
 * Shared concentration report for the Insights preview and the full list.
 * Both screens already load `usePortfolioData`, so this only memoizes the
 * aggregation and never fetches anything on its own.
 */
export function useStockConcentration({
  holdings,
  funds,
  sleeves,
  equityValue,
  portfolioValue = 0,
  limitPct,
}: UseStockConcentrationInput): StockConcentrationReport {
  return useMemo(
    () =>
      analyzeStockConcentration({
        holdings,
        funds,
        equityValue: equitySleeveValue(sleeves, equityValue),
        portfolioValue,
        limitPct,
      }),
    [holdings, funds, sleeves, equityValue, portfolioValue, limitPct],
  );
}
