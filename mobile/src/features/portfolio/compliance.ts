import { formatCompactINR } from '@/src/lib/format/money';

import type { AllocationNode, ExposureSlice } from './analytics';
import { normalizeGroup } from './normalize';
import { colorForSleeve, type PolicyConfig } from './policy';
import type { PolicyRange } from './types';

/**
 * Institutional compliance is deliberately separate from the root-only
 * allocation evaluation. Roots keep driving drift, health and rebalancing; this
 * layer adds explicit ranges, promoted monitor/policy nodes, cash floors,
 * concentration limits, coverage and the separate sector policy.
 */
export type RangeStatus =
  | 'below'
  | 'watch-low'
  | 'inside'
  | 'watch-high'
  | 'above';

export type ComplianceSeverity = 'ok' | 'watch' | 'breach';

export interface PolicyRangeRow {
  path: string;
  label: string;
  currentPercentage: number;
  currentValue: number;
  targetPercentage: number;
  range: PolicyRange;
  driftPp: number;
  status: RangeStatus;
  severity: ComplianceSeverity;
  color: string;
  level: 'policy' | 'monitor';
}

export interface SectorPolicyRow {
  sector: string;
  currentValue: number;
  currentPercentage: number;
  targetPercentage: number | null;
  range?: PolicyRange;
  driftPp: number | null;
  status: RangeStatus | 'untargeted';
  severity: ComplianceSeverity;
}

export interface ComplianceCheck {
  id: string;
  label: string;
  severity: ComplianceSeverity;
  detail: string;
  value?: number;
  limit?: number;
}

/**
 * Shared concentration output. Compliance accepts the same rows the Insights
 * card renders, so the cap can never disagree between the two surfaces.
 */
export interface StockConcentrationCheckInput {
  rows: {
    name: string;
    totalValue: number;
    fundValue: number;
    equityPercentage: number;
    status: ComplianceSeverity;
  }[];
  equityValue: number;
  limitPct: number;
}

export interface ComplianceReport {
  ranges: PolicyRangeRow[];
  sectorRows: SectorPolicyRow[];
  checks: ComplianceCheck[];
  status: 'compliant' | 'watch' | 'breach' | 'template' | 'unmanaged';
  breachCount: number;
  watchCount: number;
  sectorPolicyDefined: boolean;
  sectorTargetSum: number;
  sectorCoveragePercentage: number;
  sectorUnallocatedPercentage: number;
  rangeCoveragePercentage: number;
}

export interface ComplianceInput {
  config: PolicyConfig;
  nodes: AllocationNode[];
  totalValue: number;
  fundCoverage: { withData: number; total: number };
  unmanagedPercentage: number;
  holdings: { name: string; symbol: string; value: number }[];
  sectors: ExposureSlice[];
  equityTotal: number;
  reviewDue: string | null;
  now?: Date;
  concentrationLimitPct?: number;
  sectorConcentrationLimitPct?: number;
  /** Direct + fund look-through stock exposure, measured against the Equities sleeve. */
  stockConcentration?: StockConcentrationCheckInput;
}

const WATCH_BAND = 0.15;

/** Five-state range status: outside, near the edge, or comfortably inside. */
export function rangeStatusFor(
  current: number,
  range: PolicyRange,
): RangeStatus {
  const width = Math.max(0.01, range.max - range.min);
  if (current < range.min) return 'below';
  if (current > range.max) return 'above';
  if (current <= range.min + width * WATCH_BAND) return 'watch-low';
  if (current >= range.max - width * WATCH_BAND) return 'watch-high';
  return 'inside';
}

export function severityForRange(status: RangeStatus): ComplianceSeverity {
  if (status === 'below' || status === 'above') return 'breach';
  if (status === 'watch-low' || status === 'watch-high') return 'watch';
  return 'ok';
}

export function buildNodeIndex(
  nodes: AllocationNode[],
): Map<string, AllocationNode> {
  const index = new Map<string, AllocationNode>();
  const visit = (list: AllocationNode[]) => {
    for (const node of list) {
      index.set(normalizeGroup(node.fullPath), node);
      visit(node.subCategories ?? []);
    }
  };
  visit(nodes);
  return index;
}

/** Evaluate every node that carries policy or monitor responsibility. */
export function evaluateRanges(input: {
  config: PolicyConfig;
  nodes: AllocationNode[];
  totalValue: number;
}): PolicyRangeRow[] {
  const { config, nodes, totalValue } = input;
  const index = buildNodeIndex(nodes);
  const paths = Object.keys(config.effectiveTargets)
    .filter((path) => {
      const level = config.decisionLevels[path];
      return level === 'policy' || level === 'monitor';
    })
    .filter((path) => (config.effectiveTargets[path] ?? 0) > 0)
    .sort((a, b) => {
      const depth = a.split('>').length - b.split('>').length;
      if (depth !== 0) return depth;
      return a.localeCompare(b);
    });

  return paths.map((path, indexValue) => {
    const currentValue = index.get(path)?.currentValue ?? 0;
    const currentPercentage = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
    const targetPercentage = config.effectiveTargets[path] ?? 0;
    const range = config.ranges[path] ?? {
      min: Math.max(0, targetPercentage - 3),
      max: Math.min(100, targetPercentage + 3),
    };
    const status = rangeStatusFor(currentPercentage, range);
    return {
      path,
      label: path.split(' > ').pop() ?? path,
      currentPercentage,
      currentValue,
      targetPercentage,
      range,
      driftPp: currentPercentage - targetPercentage,
      status,
      severity: severityForRange(status),
      color: colorForSleeve(path, indexValue),
      level: config.decisionLevels[path] === 'monitor' ? 'monitor' : 'policy',
    };
  });
}

/**
 * Sector policy is a separate exposure lens expressed as a share of equity.
 * It never nests under the asset-class composition tree.
 */
export function evaluateSectorPolicy(input: {
  sectors: ExposureSlice[];
  equityTotal: number;
  targets: Record<string, number>;
  ranges?: Record<string, PolicyRange>;
}): {
  rows: SectorPolicyRow[];
  targetSum: number;
  coveragePercentage: number;
  unallocatedPercentage: number;
  defined: boolean;
} {
  const { sectors, equityTotal, targets, ranges = {} } = input;
  const normalizedTargets: Record<string, number> = {};
  for (const [rawSector, rawValue] of Object.entries(targets ?? {})) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) {
      normalizedTargets[normalizeGroup(rawSector)] = value;
    }
  }
  const defined = Object.keys(normalizedTargets).length > 0;
  const currentBySector = new Map(
    sectors.map((sector) => [normalizeGroup(sector.name), sector]),
  );
  const sectorsToShow = new Set<string>([
    ...Object.keys(normalizedTargets),
    ...sectors.map((sector) => normalizeGroup(sector.name)),
  ]);

  const rows: SectorPolicyRow[] = [...sectorsToShow]
    .map((sector) => {
      const slice = currentBySector.get(sector);
      const currentValue = slice?.value ?? 0;
      const currentPercentage = equityTotal > 0 ? (currentValue / equityTotal) * 100 : 0;
      const target = normalizedTargets[sector];
      const range = ranges[sector];
      const targetPercentage = target ?? null;
      if (targetPercentage == null) {
        return {
          sector,
          currentValue,
          currentPercentage,
          targetPercentage,
          driftPp: null,
          status: 'untargeted' as const,
          severity: currentPercentage > 0 ? ('watch' as const) : ('ok' as const),
        };
      }
      const effectiveRange = range ?? {
        min: Math.max(0, targetPercentage - 3),
        max: Math.min(100, targetPercentage + 3),
      };
      const status = rangeStatusFor(currentPercentage, effectiveRange);
      return {
        sector,
        currentValue,
        currentPercentage,
        targetPercentage,
        range: effectiveRange,
        driftPp: currentPercentage - targetPercentage,
        status,
        severity: severityForRange(status),
      };
    })
    .sort((a, b) => b.currentPercentage - a.currentPercentage);

  const targetSum = Object.values(normalizedTargets).reduce(
    (sum, value) => sum + value,
    0,
  );
  const covered = rows
    .filter((row) => row.targetPercentage != null)
    .reduce((sum, row) => sum + row.currentPercentage, 0);

  return {
    rows,
    targetSum: Math.round(targetSum * 100) / 100,
    coveragePercentage: Math.min(100, covered),
    unallocatedPercentage: defined ? Math.max(0, 100 - targetSum) : 0,
    defined,
  };
}

export function evaluateCompliance(input: ComplianceInput): ComplianceReport {
  const {
    config,
    nodes,
    totalValue,
    fundCoverage,
    unmanagedPercentage,
    holdings,
    sectors,
    equityTotal,
    reviewDue,
    now = new Date(),
  } = input;

  const ranges = evaluateRanges({ config, nodes, totalValue });
  const sectorPolicy = evaluateSectorPolicy({
    sectors,
    equityTotal,
    targets: config.sectorTargets,
    ranges: config.sectorRanges,
  });
  const checks: ComplianceCheck[] = [];

  const minCash = Number(config.policy.rebalance.minCashPct) || 0;
  const cash = ranges.find(
    (row) => normalizeGroup(row.path) === 'Cash' && row.level === 'policy',
  );
  // The cash floor applies even when Cash has no explicit target, because the
  // rebalance policy still reserves a minimum buffer.
  const cashCurrent =
    cash?.currentPercentage ??
    (totalValue > 0
      ? ((buildNodeIndex(nodes).get('Cash')?.currentValue ?? 0) / totalValue) * 100
      : 0);
  if (cash || minCash > 0) {
    const floor = Math.max(minCash, cash?.range.min ?? 0);
    if (cashCurrent < floor - 1) {
      checks.push({
        id: 'cash-floor',
        label: 'Cash reserve floor',
        severity: 'breach',
        detail: `Cash is ${cashCurrent.toFixed(2)}%, below the ${floor.toFixed(
          2,
        )}% floor.`,
        value: cashCurrent,
        limit: floor,
      });
    } else if (cashCurrent < floor) {
      checks.push({
        id: 'cash-floor',
        label: 'Cash reserve floor',
        severity: 'watch',
        detail: `Cash is ${cashCurrent.toFixed(2)}%, just below the ${floor.toFixed(
          2,
        )}% floor.`,
        value: cashCurrent,
        limit: floor,
      });
    } else {
      checks.push({
        id: 'cash-floor',
        label: 'Cash reserve floor',
        severity: 'ok',
        detail: `Cash is ${cashCurrent.toFixed(2)}%, above the ${floor.toFixed(
          2,
        )}% floor.`,
        value: cashCurrent,
        limit: floor,
      });
    }
  }

  const concentrationLimit = input.concentrationLimitPct ?? 10;

  const stockConcentration = input.stockConcentration;
  if (
    stockConcentration &&
    stockConcentration.equityValue > 0 &&
    stockConcentration.rows.length > 0
  ) {
    const limit =
      stockConcentration.limitPct > 0
        ? stockConcentration.limitPct
        : concentrationLimit;
    const stockRows = [...stockConcentration.rows]
      .filter((row) => row.totalValue > 0)
      .sort((a, b) => b.equityPercentage - a.equityPercentage);
    const topStock = stockRows[0];
    if (topStock) {
      const breaches = stockRows.filter((row) => row.status === 'breach');
      const watches = stockRows.filter((row) => row.status === 'watch');
      const severity: ComplianceSeverity =
        breaches.length > 0 ? 'breach' : watches.length > 0 ? 'watch' : 'ok';
      const fundNote =
        topStock.fundValue > 0
          ? `, including ${formatCompactINR(topStock.fundValue)} via funds`
          : '';
      const detail =
        breaches.length > 1
          ? `${breaches.length} stocks exceed the ${limit}% equity cap. ${topStock.name} is ${topStock.equityPercentage.toFixed(2)}% of equity${fundNote}.`
          : severity === 'breach'
            ? `${topStock.name} is ${topStock.equityPercentage.toFixed(2)}% of equity${fundNote} (limit ${limit}%).`
            : severity === 'watch'
              ? `${topStock.name} is ${topStock.equityPercentage.toFixed(2)}% of equity${fundNote}, close to the ${limit}% cap.`
              : `Largest stock, ${topStock.name}, is ${topStock.equityPercentage.toFixed(2)}% of equity${fundNote} (limit ${limit}%).`;
      checks.push({
        id: 'single-stock-equity',
        label: 'Single-stock concentration (equity)',
        severity,
        detail,
        value: topStock.equityPercentage,
        limit,
      });
    }
  }

  const topHolding = [...holdings].sort((a, b) => b.value - a.value)[0];
  if (topHolding && totalValue > 0) {
    const percentage = (topHolding.value / totalValue) * 100;
    checks.push({
      id: 'single-holding',
      label: 'Single-holding concentration (portfolio)',
      severity:
        percentage > concentrationLimit * 1.5
          ? 'breach'
          : percentage > concentrationLimit
            ? 'watch'
            : 'ok',
      detail: `${topHolding.name} is ${percentage.toFixed(
        2,
      )}% of the total portfolio (limit ${concentrationLimit}%).`,
      value: percentage,
      limit: concentrationLimit,
    });
  }

  if (fundCoverage.total > 0) {
    const coverage = (fundCoverage.withData / fundCoverage.total) * 100;
    checks.push({
      id: 'look-through-coverage',
      label: 'Fund look-through coverage',
      severity: coverage < 50 ? 'breach' : coverage < 80 ? 'watch' : 'ok',
      detail: `${fundCoverage.withData} of ${fundCoverage.total} funds have look-through data (${coverage.toFixed(
        0,
      )}%).`,
      value: coverage,
      limit: 80,
    });
  }

  checks.push({
    id: 'unmanaged-exposure',
    label: 'Outside policy',
    severity:
      unmanagedPercentage > 15 ? 'breach' : unmanagedPercentage > 5 ? 'watch' : 'ok',
    detail:
      unmanagedPercentage > 0
        ? `${unmanagedPercentage.toFixed(2)}% of the portfolio is outside every policy sleeve.`
        : 'Every valued holding maps to a policy sleeve.',
    value: unmanagedPercentage,
    limit: 5,
  });

  if (sectorPolicy.defined) {
    const unclassified = sectorPolicy.rows.find(
      (row) => normalizeGroup(row.sector) === 'Other / Uncategorized',
    );
    if (unclassified && unclassified.currentPercentage > 20) {
      checks.push({
        id: 'sector-unclassified',
        label: 'Unclassified sector exposure',
        severity: unclassified.currentPercentage > 35 ? 'breach' : 'watch',
        detail: `${unclassified.currentPercentage.toFixed(
          2,
        )}% of equity exposure is in Other / Uncategorized.`,
        value: unclassified.currentPercentage,
        limit: 20,
      });
    }
    const topSector = [...sectorPolicy.rows]
      .filter((row) => row.targetPercentage != null)
      .sort((a, b) => b.currentPercentage - a.currentPercentage)[0];
    const sectorLimit = input.sectorConcentrationLimitPct ?? 35;
    if (topSector && topSector.currentPercentage > sectorLimit) {
      checks.push({
        id: 'sector-concentration',
        label: 'Sector concentration',
        severity:
          topSector.currentPercentage > sectorLimit * 1.25 ? 'breach' : 'watch',
        detail: `${topSector.sector} is ${topSector.currentPercentage.toFixed(
          2,
        )}% of equity (limit ${sectorLimit}%).`,
        value: topSector.currentPercentage,
        limit: sectorLimit,
      });
    }
    if (Math.abs(sectorPolicy.targetSum - 100) > 0.01) {
      checks.push({
        id: 'sector-policy-sum',
        label: 'Sector policy allocation',
        severity: sectorPolicy.targetSum > 100.01 ? 'breach' : 'ok',
        detail:
          sectorPolicy.targetSum > 100.01
            ? `Sector targets total ${sectorPolicy.targetSum.toFixed(
                2,
              )}%, above 100%.`
            : `Sector targets total ${sectorPolicy.targetSum.toFixed(
                2,
              )}%; ${sectorPolicy.unallocatedPercentage.toFixed(
                2,
              )}% is an explicit Unallocated remainder.`,
        value: sectorPolicy.targetSum,
        limit: 100,
      });
    }
  }

  if (reviewDue) {
    const due = new Date(reviewDue);
    const dueTime = due.getTime();
    if (Number.isFinite(dueTime)) {
      const days = Math.floor((dueTime - now.getTime()) / 86_400_000);
      checks.push({
        id: 'policy-review',
        label: 'Policy review',
        severity: days < -30 ? 'breach' : days < 0 ? 'watch' : 'ok',
        detail:
          days < 0
            ? `Policy review is overdue by ${Math.abs(days)} days.`
            : `Next policy review is due in ${days} days.`,
        value: days,
        limit: 0,
      });
    }
  }

  const sectorBreaches = sectorPolicy.rows.filter(
    (row) => row.targetPercentage != null && row.severity === 'breach',
  ).length;
  const sectorWatches = sectorPolicy.rows.filter(
    (row) => row.targetPercentage != null && row.severity === 'watch',
  ).length;

  const breachCount =
    ranges.filter((row) => row.severity === 'breach').length +
    sectorBreaches +
    checks.filter((check) => check.severity === 'breach').length;
  const watchCount =
    ranges.filter((row) => row.severity === 'watch').length +
    sectorWatches +
    checks.filter((check) => check.severity === 'watch').length;

  const status: ComplianceReport['status'] = config.isTemplate
    ? 'template'
    : ranges.length === 0
      ? 'unmanaged'
      : breachCount > 0
        ? 'breach'
        : watchCount > 0
          ? 'watch'
          : 'compliant';

  // Root rows only: promoted children would double-count the same exposure.
  const rangeCoverage = ranges
    .filter((row) => row.path.split(' > ').length === 1)
    .reduce((sum, row) => sum + row.currentPercentage, 0);

  return {
    ranges,
    sectorRows: sectorPolicy.rows,
    checks,
    status,
    breachCount,
    watchCount,
    sectorPolicyDefined: sectorPolicy.defined,
    sectorTargetSum: sectorPolicy.targetSum,
    sectorCoveragePercentage: sectorPolicy.coveragePercentage,
    sectorUnallocatedPercentage: sectorPolicy.unallocatedPercentage,
    rangeCoveragePercentage: Math.min(100, rangeCoverage),
  };
}
