/** @jest-environment node */

import {
  classifyPePercentile,
  PE_CHEAP_BELOW,
  PE_EXPENSIVE_ABOVE,
} from '../peSignal';

describe('classifyPePercentile', () => {
  it('treats the bottom quartile as cheap', () => {
    expect(classifyPePercentile(0)).toBe('cheap');
    expect(classifyPePercentile(24.9)).toBe('cheap');
  });

  it('treats the middle half as fair', () => {
    expect(classifyPePercentile(PE_CHEAP_BELOW)).toBe('fair');
    expect(classifyPePercentile(50)).toBe('fair');
    expect(classifyPePercentile(PE_EXPENSIVE_ABOVE)).toBe('fair');
  });

  it('treats the top quartile as expensive', () => {
    expect(classifyPePercentile(75.1)).toBe('expensive');
    expect(classifyPePercentile(100)).toBe('expensive');
  });

  it('returns unknown without a usable history', () => {
    expect(classifyPePercentile(null)).toBe('unknown');
    expect(classifyPePercentile(Number.NaN)).toBe('unknown');
  });
});
