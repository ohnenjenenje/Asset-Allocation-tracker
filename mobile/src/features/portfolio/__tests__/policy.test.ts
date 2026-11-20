/** @jest-environment node */

import { buildPolicyUpdate } from '../policy';
import type { Policy } from '../types';

const existing: Policy = {
  id: 'policy-household',
  version: 4,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  createdAt: '2025-04-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  baseCurrency: 'INR',
  targets: { Equities: 60, 'Fixed Income': 40 },
  bands: { Equities: 3, 'Fixed Income': 3 },
  rebalance: { method: 'threshold', cashFlowFirst: true, minCashPct: 5 },
  reviewCadence: 'quarterly',
  confirmedAt: '2026-01-01T00:00:00.000Z',
  source: 'custom',
  notes: 'Old mandate note',
  approvedBy: 'Investment committee',
  changeNote: 'Initial policy',
};

function update(
  overrides: { notes?: string; approvedBy?: string; changeNote?: string } = {},
) {
  return buildPolicyUpdate({
    existing,
    targets: existing.targets,
    bands: existing.bands,
    ...overrides,
  });
}

describe('buildPolicyUpdate', () => {
  it('clears governance text when empty strings are supplied', () => {
    const next = update({ notes: '', approvedBy: '', changeNote: '' });

    expect(next.notes).toBe('');
    expect(next.approvedBy).toBe('');
    expect(next.changeNote).toBe('');
  });

  it('preserves governance text when the fields are omitted', () => {
    const next = update();

    expect(next.notes).toBe(existing.notes);
    expect(next.approvedBy).toBe(existing.approvedBy);
    expect(next.changeNote).toBe(existing.changeNote);
  });

  it('records a new confirmed custom version on every save', () => {
    const next = update({ notes: 'Updated mandate' });

    expect(next.id).toBe(existing.id);
    expect(next.version).toBe(existing.version + 1);
    expect(next.source).toBe('custom');
    expect(next.confirmedAt).not.toBeNull();
    expect(next.notes).toBe('Updated mandate');
  });
});
