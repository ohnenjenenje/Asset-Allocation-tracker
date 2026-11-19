/** @jest-environment node */

import {
  classifyGoldSilverRatio,
  GOLD_CHEAP_MAX_RATIO,
  SILVER_CHEAP_MIN_RATIO,
} from '../ratioSignal';

describe('classifyGoldSilverRatio', () => {
  it('favors silver when one ounce of gold buys at least 80 ounces of silver', () => {
    const signal = classifyGoldSilverRatio(SILVER_CHEAP_MIN_RATIO);

    expect(signal.zone).toBe('silver');
    expect(signal.headline).toBe('Silver looks relatively cheap');
    expect(signal.detail).toContain('80.0 oz');
  });

  it('favors gold when the ratio is at or below 50', () => {
    const signal = classifyGoldSilverRatio(GOLD_CHEAP_MAX_RATIO);

    expect(signal.zone).toBe('gold');
    expect(signal.headline).toBe('Gold looks relatively cheap');
    expect(signal.detail).toContain('50.0 oz');
  });

  it('treats readings between the bands as neutral', () => {
    expect(classifyGoldSilverRatio(50.1).zone).toBe('balanced');
    expect(classifyGoldSilverRatio(79.9).zone).toBe('balanced');
    expect(classifyGoldSilverRatio(65).headline).toBe('Ratio is in its neutral band');
  });

  it('describes the live reading in the detail copy', () => {
    expect(classifyGoldSilverRatio(82.82).detail).toContain('82.8 oz');
  });

  it('returns no signal for an invalid quote', () => {
    const signal = classifyGoldSilverRatio(Number.NaN);

    expect(signal.zone).toBe('balanced');
    expect(signal.headline).toBe('No ratio signal');
  });
});
