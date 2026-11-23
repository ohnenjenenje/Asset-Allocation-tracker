/** @jest-environment node */

import type { AllocationNode } from '../analytics';
import {
  buildAllocationTableRows,
  type AllocationTableRow,
} from '../allocationTable';
import type {
  PolicySleeveEvaluation,
  PolicyUnmanagedSlice,
} from '../policy';

function node(
  overrides: Partial<AllocationNode> & Pick<AllocationNode, 'category' | 'fullPath'>,
): AllocationNode {
  return {
    currentValue: 0,
    currentPercentage: 0,
    idealPercentage: 0,
    diffPercentage: 0,
    diffValue: 0,
    constituents: [],
    subCategories: [],
    ...overrides,
  };
}

function sleeve(
  overrides: Partial<PolicySleeveEvaluation> & Pick<PolicySleeveEvaluation, 'path' | 'label'>,
): PolicySleeveEvaluation {
  return {
    currentPercentage: 0,
    targetPercentage: 0,
    bandPp: 3,
    driftPp: 0,
    currentValue: 0,
    targetValue: 0,
    driftValue: 0,
    status: 'within',
    color: '#2563EB',
    ...overrides,
  };
}

function unmanaged(
  overrides: Partial<PolicyUnmanagedSlice> &
    Pick<PolicyUnmanagedSlice, 'path' | 'label'>,
): PolicyUnmanagedSlice {
  return {
    currentPercentage: 0,
    currentValue: 0,
    color: '#71717A',
    ...overrides,
  };
}

function findRow(rows: AllocationTableRow[], key: string): AllocationTableRow {
  const row = rows.find((item) => item.key === key);
  if (!row) throw new Error(`Missing row ${key}`);
  return row;
}

describe('buildAllocationTableRows', () => {
  const domesticEquity = node({
    category: 'Domestic Equity',
    fullPath: 'Equities > Domestic Equity',
    currentValue: 4_000,
    currentPercentage: 40,
    constituents: [
      { name: 'TCS', symbol: 'TCS', value: 3_000 },
      { name: 'Infosys', symbol: 'INFY', value: 1_000 },
    ],
  });

  const equities = node({
    category: 'Equities',
    fullPath: 'Equities',
    currentValue: 10_000,
    currentPercentage: 100,
    constituents: [{ name: 'HDFC Bank', symbol: 'HDFCBANK', value: 6_000 }],
    subCategories: [domesticEquity],
  });

  it('maps policy sleeves to root rows and counts nested holdings', () => {
    const rows = buildAllocationTableRows(
      {
        sleeves: [
          sleeve({
            path: 'Equities',
            label: 'Equities',
            currentPercentage: 100,
            targetPercentage: 60,
            driftPp: 40,
            currentValue: 10_000,
            targetValue: 6_000,
            driftValue: 4_000,
            status: 'breach',
          }),
        ],
        unmanaged: [],
      },
      [equities],
      10_000,
    );

    expect(rows).toHaveLength(1);
    const root = rows[0];
    expect(root.kind).toBe('sleeve');
    expect(root.targetPercentage).toBe(60);
    expect(root.status).toBe('breach');
    expect(root.holdingCount).toBe(3);
    expect(root.children.map((child) => child.kind)).toEqual([
      'subcategory',
      'holding',
    ]);

    const subcategory = findRow(
      root.children,
      'subcategory:Equities > Domestic Equity',
    );
    expect(subcategory.targetPercentage).toBeNull();
    expect(subcategory.holdingCount).toBe(2);
    expect(subcategory.children.map((child) => child.label)).toEqual([
      'TCS',
      'Infosys',
    ]);
    expect(subcategory.children[0].currentPercentage).toBeCloseTo(30);
  });

  it('carries sub-sleeve targets and drift onto child rows', () => {
    const targeted = node({
      category: 'Domestic Equity',
      fullPath: 'Equities > Domestic Equity',
      currentValue: 4_000,
      currentPercentage: 40,
      idealPercentage: 30,
      diffPercentage: 10,
      diffValue: 1_000,
      constituents: [{ name: 'TCS', symbol: 'TCS', value: 4_000 }],
    });
    const root = node({
      category: 'Equities',
      fullPath: 'Equities',
      currentValue: 4_000,
      currentPercentage: 40,
      subCategories: [targeted],
    });

    const rows = buildAllocationTableRows(
      {
        sleeves: [
          sleeve({
            path: 'Equities',
            label: 'Equities',
            currentPercentage: 40,
            targetPercentage: 30,
            bandPp: 3,
            driftPp: 10,
            currentValue: 4_000,
            targetValue: 3_000,
            driftValue: 1_000,
            status: 'breach',
          }),
        ],
        unmanaged: [],
      },
      [root],
      10_000,
    );

    const subcategory = findRow(
      rows[0].children,
      'subcategory:Equities > Domestic Equity',
    );
    expect(subcategory).toMatchObject({
      targetPercentage: 30,
      targetValue: 3_000,
      driftPp: 10,
      driftValue: 1_000,
      bandPp: null,
      status: null,
    });
    expect(subcategory.children[0]).toMatchObject({
      kind: 'holding',
      targetPercentage: null,
      driftPp: null,
    });
  });

  it('leaves child targets empty when the policy has none', () => {
    const rows = buildAllocationTableRows(
      {
        sleeves: [
          sleeve({
            path: 'Equities',
            label: 'Equities',
            currentPercentage: 100,
            targetPercentage: 60,
          }),
        ],
        unmanaged: [],
      },
      [equities],
      10_000,
    );

    const subcategory = findRow(
      rows[0].children,
      'subcategory:Equities > Domestic Equity',
    );
    expect(subcategory.targetPercentage).toBeNull();
    expect(subcategory.targetValue).toBeNull();
    expect(subcategory.driftPp).toBeNull();
    expect(subcategory.driftValue).toBeNull();
  });

  it('appends unmanaged rows without a target or drift', () => {
    const crypto = node({
      category: 'Crypto',
      fullPath: 'Crypto',
      currentValue: 2_000,
      currentPercentage: 20,
      constituents: [{ name: 'Bitcoin', symbol: 'BTC-USD', value: 2_000 }],
    });

    const rows = buildAllocationTableRows(
      {
        sleeves: [sleeve({ path: 'Equities', label: 'Equities' })],
        unmanaged: [
          unmanaged({
            path: 'Crypto',
            label: 'Crypto',
            currentPercentage: 20,
            currentValue: 2_000,
          }),
        ],
      },
      [crypto],
      10_000,
    );

    expect(rows).toHaveLength(2);
    const outside = rows[1];
    expect(outside.kind).toBe('unmanaged');
    expect(outside.targetPercentage).toBeNull();
    expect(outside.driftPp).toBeNull();
    expect(outside.children[0].label).toBe('Bitcoin');
    expect(outside.children[0].currentPercentage).toBeCloseTo(20);
  });

  it('keeps target-only sleeves when there is no matching allocation node', () => {
    const rows = buildAllocationTableRows(
      {
        sleeves: [
          sleeve({
            path: 'Cash',
            label: 'Cash',
            targetPercentage: 10,
            status: 'watch',
          }),
        ],
        unmanaged: [],
      },
      [],
      10_000,
    );

    expect(rows[0]).toMatchObject({
      kind: 'sleeve',
      holdingCount: 0,
      children: [],
      targetPercentage: 10,
      status: 'watch',
    });
  });
});
