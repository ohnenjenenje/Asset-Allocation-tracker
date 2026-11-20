/** @jest-environment node */

import type { AllocationNode } from '../analytics';
import {
  buildCompositionTree,
  compositionCoverage,
  compositionCount,
  compositionSuggestions,
  currentValueForPath,
  directChildPaths,
  effectiveTargetOfTotal,
  indexAllocationNodes,
  mergeCompositionTargets,
  rangeForNode,
  removeSubtree,
  validateComposition,
} from '../breakdown';

function makeNode(
  fullPath: string,
  currentValue: number,
  subCategories: AllocationNode[] = [],
): AllocationNode {
  return {
    category: fullPath.split(' > ').pop() ?? fullPath,
    fullPath,
    currentValue,
    currentPercentage: 0,
    idealPercentage: 0,
    diffPercentage: 0,
    diffValue: 0,
    constituents: [],
    subCategories,
  };
}

const nodes: AllocationNode[] = [
  makeNode('Equities', 600, [
    makeNode('Equities > Domestic Equity', 450, [
      makeNode('Equities > Domestic Equity > Large Cap', 300),
      makeNode('Equities > Domestic Equity > Mid Cap', 100),
      makeNode('Equities > Domestic Equity > Small Cap', 50),
    ]),
    makeNode('Equities > Global Equity', 150),
  ]),
  makeNode('Commodities', 50, [
    makeNode('Commodities > Gold', 35),
    makeNode('Commodities > Silver', 15),
  ]),
  makeNode('Cash', 100),
];

const targets = {
  Equities: 60,
  'Equities > Domestic Equity': 70,
  'Equities > Domestic Equity > Large Cap': 60,
  'Equities > Domestic Equity > Mid Cap': 25,
  'Equities > Domestic Equity > Small Cap': 15,
  'Equities > Global Equity': 30,
  Commodities: 5,
  'Commodities > Gold': 70,
  'Commodities > Silver': 30,
  Cash: 10,
};

describe('composition paths', () => {
  it('lists only direct children of a parent', () => {
    expect(directChildPaths(targets, 'Equities')).toEqual([
      'Equities > Domestic Equity',
      'Equities > Global Equity',
    ]);
    expect(directChildPaths(targets, 'Equities > Domestic Equity')).toEqual([
      'Equities > Domestic Equity > Large Cap',
      'Equities > Domestic Equity > Mid Cap',
      'Equities > Domestic Equity > Small Cap',
    ]);
  });

  it('compounds effective targets through every parent', () => {
    expect(effectiveTargetOfTotal(targets, 'Equities > Domestic Equity')).toBeCloseTo(42);
    expect(
      effectiveTargetOfTotal(targets, 'Equities > Domestic Equity > Large Cap'),
    ).toBeCloseTo(25.2);
    expect(effectiveTargetOfTotal(targets, 'Equities > Global Equity')).toBeCloseTo(18);
    expect(effectiveTargetOfTotal(targets, 'Commodities > Gold')).toBeCloseTo(3.5);
  });

  it('counts defined composition nodes', () => {
    expect(compositionCount(targets)).toBe(7);
    expect(compositionCount(targets, ['Equities'])).toBe(5);
    expect(compositionCount(targets, ['Commodities'])).toBe(2);
  });

  it('indexes the current allocation tree and reads current values', () => {
    const index = indexAllocationNodes(nodes);
    expect(currentValueForPath(index, 'Equities > Domestic Equity > Large Cap')).toBe(300);
    expect(currentValueForPath(index, 'Unlisted > Custom')).toBe(0);
  });
});

describe('composition validation', () => {
  it('accepts a fully allocated tree', () => {
    const result = validateComposition(targets);
    expect(result.isValid).toBe(true);
    expect(result.parentErrors).toEqual({});
    expect(result.sumByParent.Equities).toBeCloseTo(100);
    expect(result.sumByParent['Equities > Domestic Equity']).toBeCloseTo(100);
    expect(result.definedCount).toBe(7);
  });

  it('rejects a parent that does not total 100%', () => {
    const result = validateComposition({
      ...targets,
      'Equities > Global Equity': 20,
    });
    expect(result.isValid).toBe(false);
    expect(result.sumByParent.Equities).toBeCloseTo(90);
    expect(result.parentErrors.Equities).toContain('unallocated');
  });

  it('rejects an over-allocated parent', () => {
    const result = validateComposition({
      ...targets,
      'Commodities > Gold': 90,
    });
    expect(result.isValid).toBe(false);
    expect(result.parentErrors.Commodities).toContain('reduce');
  });

  it('carries an explicit remainder when Unallocated is allowed', () => {
    const result = validateComposition(
      {
        ...targets,
        'Equities > Global Equity': 20,
      },
      { allowUnallocated: true },
    );
    expect(result.isValid).toBe(true);
    expect(result.unallocatedByParent.Equities).toBeCloseTo(10);
    expect(result.parentErrors.Equities).toBeUndefined();
  });

  it('rejects a zero, non-numeric or out-of-range child target', () => {
    const result = validateComposition({
      ...targets,
      'Commodities > Gold': 0,
      'Commodities > Silver': Number.NaN,
      'Commodities > Other': 120,
    });
    expect(result.isValid).toBe(false);
    expect(result.childErrors['Commodities > Gold']).toBeDefined();
    expect(result.childErrors['Commodities > Silver']).toBeDefined();
    expect(result.childErrors['Commodities > Other']).toBeDefined();
  });
});

describe('composition editing', () => {
  it('removes a branch without touching the root or siblings', () => {
    const next = removeSubtree(targets, 'Equities > Domestic Equity');
    expect(next['Equities']).toBe(60);
    expect(next['Equities > Global Equity']).toBe(30);
    expect(next['Equities > Domestic Equity']).toBeUndefined();
    expect(next['Equities > Domestic Equity > Large Cap']).toBeUndefined();
    expect(next['Commodities > Gold']).toBe(70);
  });

  it('replaces edited sleeve composition while preserving roots and other sleeves', () => {
    const next = mergeCompositionTargets(
      targets,
      ['Equities'],
      {
        'Equities > Domestic Equity': 75,
        'Equities > Global Equity': 25,
        'Commodities > Gold': 90,
      },
    );
    expect(next.Equities).toBe(60);
    expect(next['Equities > Domestic Equity']).toBe(75);
    expect(next['Equities > Domestic Equity > Large Cap']).toBeUndefined();
    expect(next['Equities > Global Equity']).toBe(25);
    // Other sleeves keep their original composition.
    expect(next['Commodities > Gold']).toBe(70);
    expect(next['Commodities > Silver']).toBe(30);
  });

  it('suggests detected groups before standard groups and hides existing paths', () => {
    const suggestions = compositionSuggestions(nodes, 'Equities', {
      'Equities > Global Equity': 30,
    });
    expect(suggestions[0].path).toBe('Equities > Domestic Equity');
    expect(suggestions[0].detected).toBe(true);
    expect(
      suggestions.some((suggestion) => suggestion.path === 'Equities > Global Equity'),
    ).toBe(false);
  });
});

describe('composition tree', () => {
  it('builds nested rows with current and effective weights', () => {
    const tree = buildCompositionTree({
      targets,
      nodes,
      rootPath: 'Equities',
      totalValue: 1000,
      decisionLevels: { 'Equities > Domestic Equity': 'monitor' },
    });

    expect(tree).toHaveLength(2);
    const domestic = tree.find((node) => node.path === 'Equities > Domestic Equity');
    expect(domestic?.effectiveTarget).toBeCloseTo(42);
    expect(domestic?.currentValue).toBe(450);
    expect(domestic?.currentOfParent).toBeCloseTo(75);
    expect(domestic?.level).toBe('monitor');
    expect(domestic?.children).toHaveLength(3);

    const global = tree.find((node) => node.path === 'Equities > Global Equity');
    expect(global?.effectiveTarget).toBeCloseTo(18);
    expect(global?.currentOfParent).toBeCloseTo(25);
    expect(global?.level).toBe('composition');
  });

  it('measures how much of a sleeve the direct composition covers', () => {
    const tree = buildCompositionTree({
      targets,
      nodes,
      rootPath: 'Equities',
      totalValue: 1000,
    });
    expect(compositionCoverage(tree, 600)).toBeCloseTo(100);
    expect(compositionCoverage(tree, 1200)).toBeCloseTo(50);
  });

  it('derives a range for a promoted node when none is stored', () => {
    expect(
      rangeForNode({
        path: 'Equities > Domestic Equity',
        effectiveTarget: 42,
        ranges: {},
        fallbackBandPp: 3,
      }),
    ).toEqual({ min: 39, max: 45 });

    expect(
      rangeForNode({
        path: 'Equities > Domestic Equity',
        effectiveTarget: 42,
        ranges: { 'Equities > Domestic Equity': { min: 40, max: 44 } },
      }),
    ).toEqual({ min: 40, max: 44 });
  });
});
