/**
 * Relative-value reading of the gold/silver ratio.
 *
 * A high ratio means one ounce of gold buys many ounces of silver, so silver is
 * cheap relative to gold. A low ratio means the opposite. The 50/80 bands are a
 * common heuristic rather than a valuation model: the ratio can stay outside
 * them for years, so the copy never presents them as a timing guarantee.
 */
export const GOLD_CHEAP_MAX_RATIO = 50;
export const SILVER_CHEAP_MIN_RATIO = 80;

export type GoldSilverZone = 'gold' | 'balanced' | 'silver';

export interface GoldSilverSignal {
  zone: GoldSilverZone;
  headline: string;
  detail: string;
}

export function classifyGoldSilverRatio(ratio: number): GoldSilverSignal {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return {
      zone: 'balanced',
      headline: 'No ratio signal',
      detail: 'A valid gold and silver quote is needed to read relative value.',
    };
  }

  const ounces = ratio.toFixed(1);

  if (ratio >= SILVER_CHEAP_MIN_RATIO) {
    return {
      zone: 'silver',
      headline: 'Silver looks relatively cheap',
      detail:
        `One ounce of gold buys ${ounces} oz of silver, at or above the 80 band. ` +
        'A reversion toward 50–80 would favor silver.',
    };
  }

  if (ratio <= GOLD_CHEAP_MAX_RATIO) {
    return {
      zone: 'gold',
      headline: 'Gold looks relatively cheap',
      detail:
        `One ounce of gold buys only ${ounces} oz of silver, at or below the 50 band. ` +
        'A reversion toward 50–80 would favor gold.',
    };
  }

  return {
    zone: 'balanced',
    headline: 'Ratio is in its neutral band',
    detail:
      `One ounce of gold buys ${ounces} oz of silver. ` +
      'Between 50 and 80, the ratio offers no strong relative-value signal.',
  };
}
