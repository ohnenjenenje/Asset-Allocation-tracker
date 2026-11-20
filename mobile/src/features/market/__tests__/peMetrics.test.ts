/** @jest-environment node */

import {
  describeMedianPosition,
  discountToMedian,
  formatRelativePe,
  relativePe,
} from '../peMetrics';

describe('discountToMedian', () => {
  it('returns a negative percentage below the median', () => {
    expect(discountToMedian(18.79, 26.7)).toBeCloseTo(-29.63, 2);
  });

  it('returns a positive percentage above the median', () => {
    expect(discountToMedian(34.1, 31.0)).toBeCloseTo(10, 5);
  });

  it('returns null for missing or invalid inputs', () => {
    expect(discountToMedian(null, 20)).toBeNull();
    expect(discountToMedian(20, null)).toBeNull();
    expect(discountToMedian(20, 0)).toBeNull();
    expect(discountToMedian(Number.NaN, 20)).toBeNull();
  });
});

describe('relativePe', () => {
  it('expresses an index P/E against a benchmark', () => {
    expect(relativePe(13.94, 20.78)).toBeCloseTo(0.6708, 3);
  });

  it('returns null when the benchmark is missing', () => {
    expect(relativePe(13.94, null)).toBeNull();
    expect(relativePe(null, 20.78)).toBeNull();
    expect(relativePe(13.94, 0)).toBeNull();
  });
});

describe('describeMedianPosition', () => {
  it('labels discounts and premiums', () => {
    expect(describeMedianPosition(-29.63)).toBe('30% below median');
    expect(describeMedianPosition(-5)).toBe('5.0% below median');
    expect(describeMedianPosition(8.4)).toBe('8.4% above median');
  });

  it('treats a rounding-level difference as at the median', () => {
    expect(describeMedianPosition(0)).toBe('At the 5-year median');
    expect(describeMedianPosition(0.04)).toBe('At the 5-year median');
  });

  it('handles missing values', () => {
    expect(describeMedianPosition(null)).toBeNull();
  });
});

describe('formatRelativePe', () => {
  it('formats a ratio with two decimals', () => {
    expect(formatRelativePe(0.6708)).toBe('0.67x');
    expect(formatRelativePe(1)).toBe('1.00x');
    expect(formatRelativePe(null)).toBe('—');
  });
});
