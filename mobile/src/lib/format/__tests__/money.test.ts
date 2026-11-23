/** @jest-environment node */

import { formatDriftPp, formatPercent } from '../money';

describe('formatPercent', () => {
  it('defaults to two decimals', () => {
    expect(formatPercent(12.34)).toBe('12.34%');
  });

  it('supports one decimal precision for allocation tables', () => {
    expect(formatPercent(12.34, { precision: 1 })).toBe('12.3%');
  });

  it('keeps signed output at one decimal precision', () => {
    expect(formatPercent(-4.26, { precision: 1, signed: true })).toBe('-4.3%');
  });
});

describe('formatDriftPp', () => {
  it('signs percentage-point drift', () => {
    expect(formatDriftPp(-3.5, { signed: true })).toBe('-3.5 pp');
  });
});
