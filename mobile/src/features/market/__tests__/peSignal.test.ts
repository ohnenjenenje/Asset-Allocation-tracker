/** @jest-environment node */

import {
  classifyPePercentile,
  isPeAtBoundary,
  peBoundaryLabel,
  PE_CHEAP_AT_OR_BELOW,
  PE_EXPENSIVE_AT_OR_ABOVE,
} from '../peSignal';

describe('classifyPePercentile', () => {
  it('treats the bottom quartile, including its boundary, as cheap', () => {
    expect(classifyPePercentile(0)).toBe('cheap');
    expect(classifyPePercentile(24.9)).toBe('cheap');
    expect(classifyPePercentile(PE_CHEAP_AT_OR_BELOW)).toBe('cheap');
  });

  it('treats the middle half as fair', () => {
    expect(classifyPePercentile(25.1)).toBe('fair');
    expect(classifyPePercentile(50)).toBe('fair');
    expect(classifyPePercentile(74.9)).toBe('fair');
  });

  it('treats the top quartile, including its boundary, as expensive', () => {
    expect(classifyPePercentile(PE_EXPENSIVE_AT_OR_ABOVE)).toBe('expensive');
    expect(classifyPePercentile(75.1)).toBe('expensive');
    expect(classifyPePercentile(100)).toBe('expensive');
  });

  it('returns unknown without a usable history', () => {
    expect(classifyPePercentile(null)).toBe('unknown');
    expect(classifyPePercentile(Number.NaN)).toBe('unknown');
  });
});

describe('isPeAtBoundary', () => {
  it('flags only the exact quartile cutoffs', () => {
    expect(isPeAtBoundary(PE_CHEAP_AT_OR_BELOW)).toBe(true);
    expect(isPeAtBoundary(PE_EXPENSIVE_AT_OR_ABOVE)).toBe(true);
    expect(isPeAtBoundary(25.1)).toBe(false);
    expect(isPeAtBoundary(74.9)).toBe(false);
    expect(isPeAtBoundary(null)).toBe(false);
  });
});

describe('peBoundaryLabel', () => {
  it('explains the exact cutoff reading', () => {
    expect(peBoundaryLabel(25)).toBe('At the 25th percentile buy cutoff');
    expect(peBoundaryLabel(75)).toBe('At the 75th percentile expensive cutoff');
    expect(peBoundaryLabel(50)).toBeNull();
  });
});
