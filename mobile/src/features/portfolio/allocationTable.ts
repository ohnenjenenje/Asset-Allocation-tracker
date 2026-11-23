import type { AllocationNode } from './analytics';
import { normalizeGroup } from './normalize';
import type { PolicyEvaluation, PolicyStatus } from './policy';

export type AllocationTableKind = 'sleeve' | 'unmanaged' | 'subcategory' | 'holding';

/**
 * One flattened-in-place row of the Target vs Actual table. Root rows carry the
 * policy comparison; child rows are composition detail and deliberately have no
 * target or drift so the table reads top-down.
 */
export interface AllocationTableRow {
  key: string;
  kind: AllocationTableKind;
  depth: number;
  label: string;
  symbol?: string;
  color: string;
  currentPercentage: number;
  targetPercentage: number | null;
  currentValue: number;
  targetValue: number | null;
  driftPp: number | null;
  driftValue: number | null;
  bandPp: number | null;
  status: PolicyStatus | null;
  /** Number of underlying holdings in this row and its children. */
  holdingCount: number;
  children: AllocationTableRow[];
}

type PolicyRows = Pick<PolicyEvaluation, 'sleeves' | 'unmanaged'>;

export function buildAllocationTableRows(
  evaluation: PolicyRows,
  nodes: AllocationNode[],
  total: number,
): AllocationTableRow[] {
  const nodeByPath = new Map(
    nodes.map((node) => [normalizeGroup(node.fullPath), node]),
  );

  const sleeves: AllocationTableRow[] = evaluation.sleeves.map((sleeve) => {
    const node = nodeByPath.get(sleeve.path);

    return {
      key: `sleeve:${sleeve.path}`,
      kind: 'sleeve',
      depth: 0,
      label: sleeve.label,
      color: sleeve.color,
      currentPercentage: sleeve.currentPercentage,
      targetPercentage: sleeve.targetPercentage,
      currentValue: sleeve.currentValue,
      targetValue: sleeve.targetValue,
      driftPp: sleeve.driftPp,
      driftValue: sleeve.driftValue,
      bandPp: sleeve.bandPp,
      status: sleeve.status,
      holdingCount: node ? countHoldings(node) : 0,
      children: node ? buildChildren(node, sleeve.color, 1, total) : [],
    };
  });

  const unmanaged: AllocationTableRow[] = evaluation.unmanaged.map((slice) => {
    const node = nodeByPath.get(slice.path);

    return {
      key: `unmanaged:${slice.path}`,
      kind: 'unmanaged',
      depth: 0,
      label: slice.label,
      color: slice.color,
      currentPercentage: slice.currentPercentage,
      targetPercentage: null,
      currentValue: slice.currentValue,
      targetValue: null,
      driftPp: null,
      driftValue: null,
      bandPp: null,
      status: null,
      holdingCount: node ? countHoldings(node) : 0,
      children: node ? buildChildren(node, slice.color, 1, total) : [],
    };
  });

  return [...sleeves, ...unmanaged];
}

function buildChildren(
  node: AllocationNode,
  color: string,
  depth: number,
  total: number,
): AllocationTableRow[] {
  const subcategories: AllocationTableRow[] = node.subCategories.map((child) => ({
    key: `subcategory:${child.fullPath}`,
    kind: 'subcategory',
    depth,
    label: child.category,
    color,
    currentPercentage: child.currentPercentage,
    targetPercentage: null,
    currentValue: child.currentValue,
    targetValue: null,
    driftPp: null,
    driftValue: null,
    bandPp: null,
    status: null,
    holdingCount: countHoldings(child),
    children: buildChildren(child, color, depth + 1, total),
  }));

  const holdings: AllocationTableRow[] = node.constituents
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((holding, index) => ({
      key: `holding:${node.fullPath}:${holding.symbol}:${index}`,
      kind: 'holding',
      depth,
      label: holding.name,
      symbol: holding.symbol,
      color,
      currentPercentage: total > 0 ? (holding.value / total) * 100 : 0,
      targetPercentage: null,
      currentValue: holding.value,
      targetValue: null,
      driftPp: null,
      driftValue: null,
      bandPp: null,
      status: null,
      holdingCount: 0,
      children: [],
    }));

  return [...subcategories, ...holdings];
}

function countHoldings(node: AllocationNode): number {
  return (
    node.constituents.length +
    node.subCategories.reduce((sum, child) => sum + countHoldings(child), 0)
  );
}
