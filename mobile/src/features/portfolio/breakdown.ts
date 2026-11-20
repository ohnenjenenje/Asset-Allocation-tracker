import type { AllocationNode } from './analytics';
import { normalizeGroup } from './normalize';
import { effectiveTargetMap } from './policy';
import type { PolicyDecisionLevel, PolicyRange } from './types';

/**
 * Composition is the layer between policy sleeves and implementation detail.
 *
 * Root sleeves remain the only nodes that drive drift alerts and rebalance
 * trades. Everything in this module describes how a sleeve is built: targets as
 * a percentage of the parent, effective weights of the total portfolio, current
 * coverage, and optional promotion to a monitored or policy node.
 */
export interface CompositionNode {
  path: string;
  label: string;
  parentPath: string;
  /** Depth relative to the sleeve: 1 for a direct child. */
  depth: number;
  /** Target as a percentage of the immediate parent. */
  target: number;
  /** Target as a percentage of the total portfolio. */
  effectiveTarget: number;
  currentValue: number;
  /** Current value as a percentage of the total portfolio. */
  currentPercentage: number;
  /** Current value as a percentage of the parent's current value. */
  currentOfParent: number;
  hasHoldings: boolean;
  level: PolicyDecisionLevel;
  children: CompositionNode[];
}

export interface CompositionValidation {
  /** Invalid target inputs, keyed by full path. */
  childErrors: Record<string, string>;
  /** Direct-child target sum for every parent that has children. */
  sumByParent: Record<string, number>;
  /** Parents whose children are not allowed by the selected policy. */
  parentErrors: Record<string, string>;
  /** Explicit remainder when a parent sums below 100. */
  unallocatedByParent: Record<string, number>;
  parentCount: number;
  definedCount: number;
  isValid: boolean;
  allowUnallocated: boolean;
}

export interface CompositionSuggestion {
  path: string;
  label: string;
  /** True when the current portfolio already has holdings on this path. */
  detected: boolean;
}

const STANDARD_SUGGESTIONS: Record<string, string[]> = {
  equities: ['Domestic Equity', 'Global Equity'],
  'domestic equity': ['Large Cap', 'Mid Cap', 'Small Cap'],
  'global equity': ['Developed Markets', 'Emerging Markets'],
  commodities: ['Gold', 'Silver', 'Other Commodities'],
  'fixed income': ['Sovereign', 'Corporate', 'Short Duration'],
  crypto: ['Bitcoin', 'Ethereum', 'Stablecoins'],
  cash: ['Operating Cash', 'Strategic Reserve'],
};

export function compositionPath(parentPath: string, name: string): string {
  return normalizeGroup(`${parentPath} > ${name.trim()}`);
}

export function parentPathOf(path: string): string {
  const parts = normalizeGroup(path).split(' > ');
  return parts.length > 1 ? parts.slice(0, -1).join(' > ') : '';
}

export function pathDepth(path: string): number {
  return normalizeGroup(path).split(' > ').filter(Boolean).length;
}

export function isChildPath(path: string): boolean {
  return pathDepth(path) >= 2;
}

/** Flatten the analytics allocation tree into a path-indexed lookup. */
export function indexAllocationNodes(
  nodes: AllocationNode[],
  index: Map<string, AllocationNode> = new Map(),
): Map<string, AllocationNode> {
  for (const node of nodes) {
    const path = normalizeGroup(node.fullPath);
    const existing = index.get(path);
    if (!existing || node.currentValue > existing.currentValue) index.set(path, node);
    indexAllocationNodes(node.subCategories ?? [], index);
  }
  return index;
}

export function directChildPaths(
  targets: Record<string, number>,
  parentPath: string,
): string[] {
  const parent = normalizeGroup(parentPath);
  return Object.keys(targets)
    .map(normalizeGroup)
    .filter((path) => parentPathOf(path) === parent)
    .sort((a, b) => a.localeCompare(b));
}

export function compositionTargets(
  targets: Record<string, number>,
  roots?: string[],
): Record<string, number> {
  const rootSet = roots ? new Set(roots.map(normalizeGroup)) : null;
  const next: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(targets ?? {})) {
    const path = normalizeGroup(rawPath);
    if (!isChildPath(path)) continue;
    if (rootSet && !rootSet.has(path.split(' > ')[0])) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) next[path] = value;
  }
  return next;
}

export function compositionCount(
  targets: Record<string, number>,
  roots?: string[],
): number {
  return Object.keys(compositionTargets(targets, roots)).length;
}

export function effectiveTargetOfTotal(
  targets: Record<string, number>,
  path: string,
): number {
  return effectiveTargetMap(targets)[normalizeGroup(path)] ?? 0;
}

export function currentValueForPath(
  index: Map<string, AllocationNode>,
  path: string,
): number {
  return index.get(normalizeGroup(path))?.currentValue ?? 0;
}

export function compositionSuggestions(
  nodes: AllocationNode[],
  parentPath: string,
  targets: Record<string, number> = {},
): CompositionSuggestion[] {
  const parent = normalizeGroup(parentPath);
  const index = indexAllocationNodes(nodes);
  const existing = new Set(
    directChildPaths(targets, parent).map((path) => path.toLowerCase()),
  );
  const suggestions = new Map<string, CompositionSuggestion>();

  for (const [path, node] of index) {
    if (parentPathOf(path) !== parent || node.currentValue <= 0) continue;
    const label = path.split(' > ').pop() ?? path;
    if (existing.has(path.toLowerCase())) continue;
    suggestions.set(path.toLowerCase(), { path, label, detected: true });
  }

  const parentLabel = (parent.split(' > ').pop() ?? parent).toLowerCase();
  for (const label of STANDARD_SUGGESTIONS[parentLabel] ?? []) {
    const path = compositionPath(parent, label);
    if (existing.has(path.toLowerCase())) continue;
    if (!suggestions.has(path.toLowerCase())) {
      suggestions.set(path.toLowerCase(), { path, label, detected: false });
    }
  }

  return [...suggestions.values()].sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Validate the complete composition map. Roots are validated by the sleeve
 * editor; here every parent that has children must be fully explained, either
 * by a 100% split or by an explicit Unallocated remainder.
 */
export function validateComposition(
  targets: Record<string, number>,
  options: { allowUnallocated?: boolean } = {},
): CompositionValidation {
  const allowUnallocated = Boolean(options.allowUnallocated);
  const values: Record<string, number> = {};
  const childErrors: Record<string, string> = {};
  const parents = new Set<string>();

  for (const [rawPath, rawValue] of Object.entries(targets ?? {})) {
    const path = normalizeGroup(rawPath);
    if (!isChildPath(path)) continue;
    parents.add(parentPathOf(path));

    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      childErrors[path] = 'Enter a number';
      continue;
    }
    if (value <= 0) {
      childErrors[path] = 'Must be above 0%';
      continue;
    }
    if (value > 100) {
      childErrors[path] = 'Cannot exceed 100%';
      continue;
    }
    values[path] = (values[path] ?? 0) + value;
  }

  const sumByParent: Record<string, number> = {};
  const parentErrors: Record<string, string> = {};
  const unallocatedByParent: Record<string, number> = {};

  for (const parent of parents) {
    let sum = 0;
    let childCount = 0;
    for (const [path, value] of Object.entries(values)) {
      if (parentPathOf(path) !== parent) continue;
      sum += value;
      childCount += 1;
    }
    const rounded = Math.round(sum * 100) / 100;
    sumByParent[parent] = rounded;
    const gap = Math.round((100 - rounded) * 100) / 100;

    if (gap < -0.01) {
      parentErrors[parent] = `Children total ${rounded.toFixed(2)}% — reduce by ${Math.abs(gap).toFixed(2)}%`;
    } else if (gap > 0.01 && !allowUnallocated) {
      parentErrors[parent] = `Children total ${rounded.toFixed(2)}% — ${gap.toFixed(2)}% unallocated`;
    } else if (gap > 0.01) {
      unallocatedByParent[parent] = gap;
    }

    if (childCount === 0 && !childErrors[parent]) {
      parentErrors[parent] = 'No valid child targets';
    }
  }

  const definedCount = Object.values(values).reduce((count) => count + 1, 0);

  return {
    childErrors,
    sumByParent,
    parentErrors,
    unallocatedByParent,
    parentCount: parents.size,
    definedCount,
    isValid:
      Object.keys(childErrors).length === 0 &&
      Object.keys(parentErrors).length === 0,
    allowUnallocated,
  };
}

/** Delete a node and its whole branch; the parent is left untouched. */
export function removeSubtree(
  targets: Record<string, number>,
  path: string,
): Record<string, number> {
  const target = normalizeGroup(path);
  const next: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(targets ?? {})) {
    const current = normalizeGroup(rawPath);
    if (current === target || current.startsWith(`${target} > `)) continue;
    next[current] = rawValue;
  }
  return next;
}

/**
 * Replace the composition under the given roots while preserving every root
 * target and every untouched sleeve. This makes deletion safe: a child that is
 * absent from `nextChildren` is removed rather than silently retained.
 */
export function mergeCompositionTargets(
  existingTargets: Record<string, number>,
  roots: string[],
  nextChildren: Record<string, number>,
): Record<string, number> {
  const rootSet = new Set(roots.map(normalizeGroup));
  const next: Record<string, number> = {};

  for (const [rawPath, rawValue] of Object.entries(existingTargets ?? {})) {
    const path = normalizeGroup(rawPath);
    const parts = path.split(' > ');
    if (parts.length === 1) {
      next[path] = rawValue;
      continue;
    }
    if (rootSet.has(parts[0])) continue;
    next[path] = rawValue;
  }

  for (const [rawPath, rawValue] of Object.entries(nextChildren)) {
    const path = normalizeGroup(rawPath);
    const value = Number(rawValue);
    if (!isChildPath(path)) continue;
    if (rootSet.size > 0 && !rootSet.has(path.split(' > ')[0])) continue;
    if (Number.isFinite(value) && value > 0) next[path] = value;
  }

  return next;
}

export function buildCompositionTree(input: {
  targets: Record<string, number>;
  nodes: AllocationNode[];
  rootPath: string;
  totalValue: number;
  decisionLevels?: Record<string, PolicyDecisionLevel>;
}): CompositionNode[] {
  const { targets, nodes, rootPath, totalValue, decisionLevels = {} } = input;
  const root = normalizeGroup(rootPath);
  const index = indexAllocationNodes(nodes);
  const effective = effectiveTargetMap(targets);

  const build = (parentPath: string, depth: number): CompositionNode[] =>
    directChildPaths(targets, parentPath)
      .map((path) => {
        const rawTarget = Number(targets[path] ?? 0);
        const currentValue = currentValueForPath(index, path);
        const parentValue = currentValueForPath(index, parentPath);
        return {
          path,
          label: path.split(' > ').pop() ?? path,
          parentPath,
          depth,
          target: Number.isFinite(rawTarget) ? rawTarget : 0,
          effectiveTarget: effective[path] ?? 0,
          currentValue,
          currentPercentage: totalValue > 0 ? (currentValue / totalValue) * 100 : 0,
          currentOfParent:
            parentValue > 0 ? (currentValue / parentValue) * 100 : 0,
          hasHoldings: currentValue > 0,
          level: decisionLevels[path] ?? 'composition',
          children: build(path, depth + 1),
        };
      })
      .sort((a, b) => b.currentValue - a.currentValue || a.label.localeCompare(b.label));

  return build(root, 1);
}

/** How much of the sleeve's current value the direct composition covers. */
export function compositionCoverage(
  children: CompositionNode[],
  rootValue: number,
): number {
  if (rootValue <= 0) return 0;
  const covered = children.reduce((sum, child) => sum + child.currentValue, 0);
  return Math.min(100, (covered / rootValue) * 100);
}

/**
 * Range for a promoted node. The policy stores ranges as effective weights of
 * the total portfolio, so this helper keeps the editor and the report aligned.
 */
export function rangeForNode(input: {
  path: string;
  effectiveTarget: number;
  ranges: Record<string, PolicyRange>;
  fallbackBandPp?: number;
}): PolicyRange {
  const stored = input.ranges[normalizeGroup(input.path)];
  if (stored) return stored;
  const band = input.fallbackBandPp ?? 3;
  return {
    min: Math.max(0, input.effectiveTarget - band),
    max: Math.min(100, input.effectiveTarget + band),
  };
}

export function targetRangeError(min: string, max: string): string | undefined {
  const parsedMin = Number(min);
  const parsedMax = Number(max);
  if (min.trim() === '' || max.trim() === '') return 'Required';
  if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) return 'Enter numbers';
  if (parsedMin < 0 || parsedMax > 100) return 'Use 0–100';
  if (parsedMax < parsedMin) return 'Max must be ≥ min';
  return undefined;
}
