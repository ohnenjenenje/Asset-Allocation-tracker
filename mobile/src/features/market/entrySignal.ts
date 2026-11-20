import type { PeZone } from './peSignal';
import type { GoldSilverZone } from './ratioSignal';

export type MarketEntryTone = 'positive' | 'warning' | 'neutral' | 'accent';

export type MarketEntryIcon =
  | 'trending-up'
  | 'minus'
  | 'check-circle'
  | 'alert-triangle'
  | 'help-circle';

export interface MarketEntryVerdict {
  /** At-a-glance action label, e.g. Buy zone / Neutral / Expensive. */
  label: string;
  /** Short explanation of what the label means. */
  headline: string;
  tone: MarketEntryTone;
  icon: MarketEntryIcon;
}

/**
 * A high gold/silver ratio makes silver cheap relative to gold, so the signal is
 * a relative-value entry cue rather than a forecast for either metal.
 */
export function goldSilverEntryVerdict(zone: GoldSilverZone): MarketEntryVerdict {
  switch (zone) {
    case 'silver':
      return {
        label: 'Buy silver',
        headline: 'Silver is relatively cheap vs gold',
        tone: 'accent',
        icon: 'trending-up',
      };
    case 'gold':
      return {
        label: 'Buy gold',
        headline: 'Gold is relatively cheap vs silver',
        tone: 'warning',
        icon: 'trending-up',
      };
    default:
      return {
        label: 'Neutral',
        headline: 'No relative-value edge',
        tone: 'neutral',
        icon: 'minus',
      };
  }
}

/**
 * Index valuation is expressed against each index's own five-year history, so
 * "Buy zone" means the cheapest quartile rather than a market-timing call.
 */
export function indexEntryVerdict(zone: PeZone): MarketEntryVerdict {
  switch (zone) {
    case 'cheap':
      return {
        label: 'Buy zone',
        headline: 'Valuation supports fresh buying',
        tone: 'positive',
        icon: 'check-circle',
      };
    case 'fair':
      return {
        label: 'Neutral',
        headline: 'No strong valuation edge',
        tone: 'neutral',
        icon: 'minus',
      };
    case 'expensive':
      return {
        label: 'Expensive',
        headline: 'Valuation is stretched',
        tone: 'warning',
        icon: 'alert-triangle',
      };
    default:
      return {
        label: 'No signal',
        headline: 'Not enough history to judge',
        tone: 'neutral',
        icon: 'help-circle',
      };
  }
}
