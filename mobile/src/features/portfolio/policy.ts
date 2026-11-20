import {
  DEFAULT_IDEAL_ALLOCATION,
  normalizeIdealAllocation,
  type AllocationNode,
} from './analytics';
import { normalizeGroup } from './normalize';
import type {
  Policy,
  PolicyCurrencyConfig,
  PolicyDecisionLevel,
  PolicyLiquidityConfig,
  PolicyRange,
  PolicyRebalance,
  PolicyReviewCadence,
  PolicyRiskModel,
} from './types';

/** The policy sleeves that map to the app's strategic asset classes. */
export const POLICY_ROOT_ORDER = [
  'Equities',
  'Fixed Income',
  'Commodities',
  'Crypto',
  'Cash',
] as const;

/**
 * Default tolerance bands, in percentage points of the total portfolio.
 * Broad sleeves can breathe more; small, volatile sleeves need a tighter band.
 */
export const DEFAULT_POLICY_BANDS: Record<string, number> = {
  Equities: 5,
  'Fixed Income': 5,
  Commodities: 2,
  Crypto: 2,
  Cash: 2,
};

export const DEFAULT_POLICY_REBALANCE: PolicyRebalance = {
  method: 'threshold',
  cashFlowFirst: true,
  minCashPct: 5,
};

/** Transparent starting assumptions, not forecasts. */
export const DEFAULT_RISK_VOLATILITY: Record<string, number> = {
  Equities: 18,
  'Fixed Income': 6,
  Commodities: 16,
  Crypto: 55,
  Cash: 1,
  Other: 12,
};

export const DEFAULT_RISK_CORRELATION = 0.25;

export const DEFAULT_RISK_MODEL: PolicyRiskModel = {
  volatility: { ...DEFAULT_RISK_VOLATILITY },
  correlation: DEFAULT_RISK_CORRELATION,
};

export const DEFAULT_CURRENCY_POLICY: PolicyCurrencyConfig = {
  baseCurrency: 'INR',
  hedgeTargets: {},
};

export const DEFAULT_LIQUIDITY_POLICY: PolicyLiquidityConfig = {
  minLiquidPct: 10,
};

export const SLEEVE_COLORS: Record<string, string> = {
  Equities: '#2563EB',
  'Fixed Income': '#0D9488',
  Commodities: '#D97706',
  Crypto: '#7C3AED',
  Cash: '#64748B',
  Other: '#71717A',
  'Other / Uncategorized': '#71717A',
};

const FALLBACK_COLORS = [
  '#DB2777',
  '#0EA5E9',
  '#65A30D',
  '#F59E0B',
  '#10B981',
  '#6366F1',
  '#EC4899',
  '#64748B',
];

export type PolicyStatus = 'within' | 'watch' | 'breach';

/**
 * One drift rule for the policy evaluation and the rebalance simulator. A
 * sleeve is a breach outside its band, a watch from three quarters of the band,
 * and within tolerance otherwise.
 */
export function statusForDrift(driftPp: number, bandPp: number): PolicyStatus {
  const magnitude = Math.abs(driftPp);
  if (magnitude > bandPp) return 'breach';
  if (magnitude >= bandPp * 0.75) return 'watch';
  return 'within';
}

export type PolicyOverallStatus =
  | 'on-policy'
  | 'watch'
  | 'breach'
  | 'unmanaged'
  | 'template'
  | 'invalid';

export interface PolicySleeveEvaluation {
  path: string;
  label: string;
  currentPercentage: number;
  targetPercentage: number;
  bandPp: number;
  driftPp: number;
  currentValue: number;
  targetValue: number;
  driftValue: number;
  status: PolicyStatus;
  color: string;
}

export interface PolicyUnmanagedSlice {
  path: string;
  label: string;
  currentPercentage: number;
  currentValue: number;
  color: string;
}

export interface PolicyEvaluation {
  sleeves: PolicySleeveEvaluation[];
  unmanaged: PolicyUnmanagedSlice[];
  targetedCount: number;
  /** Sleeves comfortably inside their band (below the watch threshold). */
  withinCount: number;
  /** Sleeves inside tolerance, including those close to the band edge. */
  inToleranceCount: number;
  watchCount: number;
  breachCount: number;
  status: PolicyOverallStatus;
  totalValue: number;
  managedPercentage: number;
  unmanagedPercentage: number;
  worstDriftPp: number;
  targetSum: number;
  isValid: boolean;
  isTemplate: boolean;
}

export interface PolicyConfig {
  policy: Policy;
  targets: Record<string, number>;
  bands: Record<string, number>;
  rootTargets: Record<string, number>;
  /** Effective target as a percentage of the total portfolio, keyed by path. */
  effectiveTargets: Record<string, number>;
  /** Explicit ranges plus root ranges derived from target ± band. */
  ranges: Record<string, PolicyRange>;
  /** Root sleeves default to policy; unlisted children are composition. */
  decisionLevels: Record<string, PolicyDecisionLevel>;
  benchmarks: Record<string, string>;
  sectorTargets: Record<string, number>;
  sectorRanges: Record<string, PolicyRange>;
  riskBudget: Record<string, number>;
  riskModel: PolicyRiskModel;
  currencyPolicy: PolicyCurrencyConfig;
  liquidityPolicy: PolicyLiquidityConfig;
  history: Policy[];
  isTemplate: boolean;
  isValid: boolean;
  targetSum: number;
  source: 'stored' | 'legacy' | 'template';
}

export interface PolicyConfigInput {
  policy?: Policy | null;
  policyHistory?: Policy[] | null;
  settingsAllocation?: Record<string, number> | null;
  topLevelAllocation?: Record<string, number> | null;
  updatedAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function validTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function defaultBandFor(path: string): number {
  return DEFAULT_POLICY_BANDS[normalizeGroup(path)] ?? 3;
}

/**
 * Convert the stored hierarchical target map into effective weights of the
 * total portfolio. Roots are already effective; children compound through
 * each parent. Legacy maps that only declared sub-categories keep working.
 */
export function effectiveTargetMap(
  targets: Record<string, number>,
): Record<string, number> {
  const normalized = normalizeIdealAllocation(targets);
  const paths = new Set<string>();
  for (const path of Object.keys(normalized)) {
    const parts = path.split(' > ');
    for (let index = 1; index <= parts.length; index += 1) {
      paths.add(parts.slice(0, index).join(' > '));
    }
  }

  const effective: Record<string, number> = {};
  const sorted = [...paths].sort(
    (a, b) => a.split('>').length - b.split('>').length,
  );
  for (const path of sorted) {
    const parts = path.split(' > ');
    if (parts.length === 1) {
      effective[path] = normalized[path] ?? 0;
      continue;
    }
    const parentPath = parts.slice(0, -1).join(' > ');
    const parentRaw = normalized[parentPath] ?? 0;
    const parentEffective = effective[parentPath] ?? 0;
    const raw = normalized[path] ?? 0;
    effective[path] =
      parentRaw > 0 ? (raw / 100) * parentEffective : raw;
  }
  return effective;
}

export function resolveDecisionLevels(
  rootTargets: Record<string, number>,
  overrides: Record<string, PolicyDecisionLevel> | undefined,
): Record<string, PolicyDecisionLevel> {
  const levels: Record<string, PolicyDecisionLevel> = {};
  for (const [path, level] of Object.entries(overrides ?? {})) {
    if (level === 'policy' || level === 'monitor') {
      levels[normalizeGroup(path)] = level;
    }
  }
  // Roots are always policy nodes, whatever an older document says.
  for (const path of Object.keys(rootTargets)) levels[normalizeGroup(path)] = 'policy';
  return levels;
}

/**
 * Explicit ranges win. Roots without one fall back to target ± band, keeping
 * older policies meaningful. Promoted children get a default band around their
 * effective target; composition-only nodes get no range and no alert.
 */
export function resolvePolicyRanges(input: {
  policy: Policy;
  rootTargets: Record<string, number>;
  bands: Record<string, number>;
  effectiveTargets: Record<string, number>;
  decisionLevels: Record<string, PolicyDecisionLevel>;
}): Record<string, PolicyRange> {
  const ranges: Record<string, PolicyRange> = {};

  for (const [rawPath, rawRange] of Object.entries(input.policy.ranges ?? {})) {
    const path = normalizeGroup(rawPath);
    const min = Number(rawRange?.min);
    const max = Number(rawRange?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) continue;
    ranges[path] = { min: clamp(min, 0, 100), max: clamp(max, 0, 100) };
  }

  for (const [path, target] of Object.entries(input.effectiveTargets)) {
    if (ranges[path] !== undefined || target <= 0) continue;
    const isRoot = input.rootTargets[path] !== undefined;
    const level = input.decisionLevels[path];
    if (!isRoot && level === undefined) continue;
    const band = input.bands[path] ?? defaultBandFor(path);
    ranges[path] = {
      min: clamp(target - band, 0, 100),
      max: clamp(target + band, 0, 100),
    };
  }

  return ranges;
}

export function isPolicyNode(config: PolicyConfig, path: string): boolean {
  const normalized = normalizeGroup(path);
  return (
    config.rootTargets[normalized] !== undefined ||
    config.decisionLevels[normalized] === 'policy'
  );
}

export function isMonitorNode(config: PolicyConfig, path: string): boolean {
  return config.decisionLevels[normalizeGroup(path)] === 'monitor';
}

export function colorForSleeve(path: string, index = 0): string {
  return SLEEVE_COLORS[normalizeGroup(path)] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/**
 * Derive root-sleeve targets from the stored allocation map. If a root has an
 * explicit target it wins; otherwise the shallowest child targets are summed.
 * This keeps old web policies (which may only contain sub-categories) usable.
 */
export function rootTargetsFromMap(targets: Record<string, number>): Record<string, number> {
  const explicit: Record<string, number> = {};
  const grouped = new Map<string, { depth: number; value: number }[]>();

  for (const [rawPath, rawValue] of Object.entries(targets ?? {})) {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;

    const path = normalizeGroup(rawPath);
    const parts = path.split('>').map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const root = parts[0];
    if (parts.length === 1) {
      explicit[root] = (explicit[root] ?? 0) + value;
      continue;
    }

    const entries = grouped.get(root) ?? [];
    entries.push({ depth: parts.length - 1, value });
    grouped.set(root, entries);
  }

  const roots: Record<string, number> = { ...explicit };
  for (const [root, entries] of grouped) {
    if (explicit[root] !== undefined) continue;
    const minDepth = Math.min(...entries.map((entry) => entry.depth));
    roots[root] = entries
      .filter((entry) => entry.depth === minDepth)
      .reduce((sum, entry) => sum + entry.value, 0);
  }

  return roots;
}

function sortPolicyPaths(paths: string[]): string[] {
  const coreIndex = new Map<string, number>(
    POLICY_ROOT_ORDER.map((path, index) => [path, index]),
  );
  return [...paths].sort((a, b) => {
    const aIndex = coreIndex.get(a);
    const bIndex = coreIndex.get(b);
    if (aIndex !== undefined || bIndex !== undefined) {
      return (aIndex ?? 99) - (bIndex ?? 99) || a.localeCompare(b);
    }
    return a.localeCompare(b);
  });
}

function completeBands(
  rootTargets: Record<string, number>,
  bands: Record<string, number> | undefined,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const path of Object.keys(rootTargets)) {
    const value = Number(bands?.[path]);
    next[path] = Number.isFinite(value) && value > 0 ? clamp(value, 0.5, 50) : defaultBandFor(path);
  }
  return next;
}

function createTemplatePolicy(timestamp: string): Policy {
  const targets = { ...DEFAULT_IDEAL_ALLOCATION };
  const roots = rootTargetsFromMap(targets);
  return {
    id: 'policy-template',
    version: 0,
    effectiveFrom: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    baseCurrency: 'INR',
    targets,
    bands: completeBands(roots, DEFAULT_POLICY_BANDS),
    rebalance: { ...DEFAULT_POLICY_REBALANCE },
    reviewCadence: 'quarterly',
    confirmedAt: null,
    source: 'template',
  };
}

function createMigratedPolicy(
  targets: Record<string, number>,
  updatedAt: string | undefined,
  timestamp: string,
): Policy {
  const roots = rootTargetsFromMap(targets);
  const effectiveFrom = validTimestamp(updatedAt, timestamp);
  return {
    id: 'policy-migrated',
    version: 1,
    effectiveFrom,
    createdAt: effectiveFrom,
    updatedAt: effectiveFrom,
    baseCurrency: 'INR',
    targets,
    bands: completeBands(roots, DEFAULT_POLICY_BANDS),
    rebalance: { ...DEFAULT_POLICY_REBALANCE },
    reviewCadence: 'quarterly',
    confirmedAt: effectiveFrom,
    source: 'migrated',
  };
}

/**
 * Resolve the effective policy for a snapshot.
 *
 * Targets are read from `settings.idealAllocation` when present because that is
 * still the web app's source of truth. The `policy` object adds bands, version
 * and review metadata; storing a copy of the targets there keeps the document
 * self-describing for future history and sync work.
 */
export function resolvePolicyConfig(input: PolicyConfigInput): PolicyConfig {
  const timestamp = nowIso();
  const legacyInput =
    input.settingsAllocation && Object.keys(input.settingsAllocation).length > 0
      ? input.settingsAllocation
      : input.topLevelAllocation;
  const legacyTargets = normalizeIdealAllocation(legacyInput);
  const storedTargets = normalizeIdealAllocation(input.policy?.targets);
  const targets =
    Object.keys(legacyTargets).length > 0 ? legacyTargets : storedTargets;

  const stored = input.policy;
  const useStored = Boolean(stored && stored.source !== 'template');
  const hasTargets = Object.keys(targets).length > 0;

  let policy: Policy;
  let source: PolicyConfig['source'];

  if (useStored) {
    policy = { ...stored!, targets: hasTargets ? targets : storedTargets };
    source = 'stored';
  } else if (hasTargets) {
    policy = createMigratedPolicy(targets, input.updatedAt, timestamp);
    source = 'legacy';
  } else {
    policy = createTemplatePolicy(timestamp);
    source = 'template';
  }

  const rootTargets = rootTargetsFromMap(policy.targets);
  const bands = completeBands(rootTargets, policy.bands);
  const targetSum = Object.values(rootTargets).reduce((sum, value) => sum + value, 0);
  const valuesValid = Object.values(rootTargets).every(
    (value) => Number.isFinite(value) && value >= 0,
  );
  const isValid =
    Object.keys(rootTargets).length > 0 &&
    valuesValid &&
    Math.abs(targetSum - 100) <= 0.01;
  const isTemplate = policy.confirmedAt == null || policy.source === 'template';

  const effectiveTargets = effectiveTargetMap(hasTargets ? targets : policy.targets);
  const decisionLevels = resolveDecisionLevels(rootTargets, policy.decisionLevels);
  const ranges = resolvePolicyRanges({
    policy,
    rootTargets,
    bands,
    effectiveTargets,
    decisionLevels,
  });

  const sectorTargets: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(policy.sectorTargets ?? {})) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) {
      sectorTargets[normalizeGroup(rawPath)] = value;
    }
  }
  const sectorRanges: Record<string, PolicyRange> = {};
  for (const [rawPath, rawRange] of Object.entries(policy.sectorRanges ?? {})) {
    const min = Number(rawRange?.min);
    const max = Number(rawRange?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) continue;
    sectorRanges[normalizeGroup(rawPath)] = {
      min: clamp(min, 0, 100),
      max: clamp(max, 0, 100),
    };
  }

  const riskBudget: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(policy.riskBudget ?? {})) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value >= 0) {
      riskBudget[normalizeGroup(rawPath)] = value;
    }
  }

  const storedVolatility = policy.riskModel?.volatility ?? {};
  const volatility: Record<string, number> = { ...DEFAULT_RISK_VOLATILITY };
  for (const [rawPath, rawValue] of Object.entries(storedVolatility)) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value >= 0) {
      volatility[normalizeGroup(rawPath)] = value;
    }
  }
  const correlationValue = Number(policy.riskModel?.correlation);
  const riskModel: PolicyRiskModel = {
    volatility,
    correlation:
      Number.isFinite(correlationValue) && correlationValue >= -1 && correlationValue <= 1
        ? correlationValue
        : DEFAULT_RISK_CORRELATION,
    correlations: policy.riskModel?.correlations,
  };

  const currencyPolicy: PolicyCurrencyConfig = {
    baseCurrency: 'INR',
    hedgeTargets: { ...(policy.currencyPolicy?.hedgeTargets ?? {}) },
  };
  const liquidityValue = Number(policy.liquidityPolicy?.minLiquidPct);
  const liquidityPolicy: PolicyLiquidityConfig = {
    minLiquidPct:
      Number.isFinite(liquidityValue) && liquidityValue >= 0
        ? clamp(liquidityValue, 0, 100)
        : DEFAULT_LIQUIDITY_POLICY.minLiquidPct,
  };

  return {
    policy: { ...policy, targets: hasTargets ? targets : policy.targets, bands },
    targets: hasTargets ? targets : policy.targets,
    bands,
    rootTargets,
    effectiveTargets,
    ranges,
    decisionLevels,
    benchmarks: { ...(policy.benchmarks ?? {}) },
    sectorTargets,
    sectorRanges,
    riskBudget,
    riskModel,
    currencyPolicy,
    liquidityPolicy,
    history: input.policyHistory ?? [],
    isTemplate,
    isValid,
    targetSum,
    source,
  };
}

/**
 * Compare current sleeve weights with policy targets. Drift is measured at the
 * sleeve level only; sub-sleeves are composition, not separate policy decisions.
 */
export function evaluatePolicy(input: {
  nodes: AllocationNode[];
  config: PolicyConfig;
  total: number;
}): PolicyEvaluation {
  const { nodes, config, total } = input;
  const nodeMap = new Map(nodes.map((node) => [normalizeGroup(node.fullPath), node]));
  const targetPaths = sortPolicyPaths(Object.keys(config.rootTargets));

  const sleeves: PolicySleeveEvaluation[] = targetPaths.map((path, index) => {
    const targetPercentage = config.rootTargets[path] ?? 0;
    const bandPp = config.bands[path] ?? defaultBandFor(path);
    const node = nodeMap.get(path);
    const currentValue = node?.currentValue ?? 0;
    const currentPercentage = total > 0 ? (currentValue / total) * 100 : 0;
    const driftPp = currentPercentage - targetPercentage;
    const status = statusForDrift(driftPp, bandPp);

    return {
      path,
      label: path.split(' > ').pop() ?? path,
      currentPercentage,
      targetPercentage,
      bandPp,
      driftPp,
      currentValue,
      targetValue: total * (targetPercentage / 100),
      driftValue: total * (driftPp / 100),
      status,
      color: colorForSleeve(path, index),
    };
  });

  const targeted = new Set(targetPaths);
  const unmanaged: PolicyUnmanagedSlice[] = nodes
    .filter((node) => !targeted.has(normalizeGroup(node.fullPath)))
    .map((node, index) => ({
      path: normalizeGroup(node.fullPath),
      label: node.category,
      currentValue: node.currentValue,
      currentPercentage: total > 0 ? (node.currentValue / total) * 100 : 0,
      color: colorForSleeve(node.fullPath, targetPaths.length + index),
    }))
    // Holdings that round to 0.00% of the portfolio are valuation dust, not an
    // actionable policy exception. Keep the threshold visible in the UI honest.
    .filter((slice) => slice.currentPercentage >= 0.01);

  const withinCount = sleeves.filter((sleeve) => sleeve.status === 'within').length;
  const watchCount = sleeves.filter((sleeve) => sleeve.status === 'watch').length;
  const breachCount = sleeves.filter((sleeve) => sleeve.status === 'breach').length;
  const managedPercentage = sleeves.reduce(
    (sum, sleeve) => sum + sleeve.currentPercentage,
    0,
  );
  const unmanagedPercentage = unmanaged.reduce(
    (sum, slice) => sum + slice.currentPercentage,
    0,
  );

  const status: PolicyOverallStatus = config.isTemplate
    ? 'template'
    : sleeves.length === 0
      ? 'unmanaged'
      : !config.isValid
        ? 'invalid'
        : breachCount > 0
          ? 'breach'
          : watchCount > 0
            ? 'watch'
            : 'on-policy';

  return {
    sleeves,
    unmanaged,
    targetedCount: sleeves.length,
    withinCount,
    inToleranceCount: withinCount + watchCount,
    watchCount,
    breachCount,
    status,
    totalValue: total,
    managedPercentage,
    unmanagedPercentage,
    worstDriftPp: sleeves.reduce(
      (worst, sleeve) => Math.max(worst, Math.abs(sleeve.driftPp)),
      0,
    ),
    targetSum: config.targetSum,
    isValid: config.isValid,
    isTemplate: config.isTemplate,
  };
}

/** Editor order: core sleeves first, then any custom or unmanaged sleeves. */
export function policySleevePaths(
  rootTargets: Record<string, number>,
  nodes: Pick<AllocationNode, 'fullPath' | 'currentValue'>[],
): string[] {
  const core = new Set<string>(POLICY_ROOT_ORDER);
  const seen = new Set<string>(POLICY_ROOT_ORDER);
  const valueByPath = new Map<string, number>();

  for (const node of nodes) {
    const path = normalizeGroup(node.fullPath);
    valueByPath.set(path, node.currentValue);
    seen.add(path);
  }
  for (const path of Object.keys(rootTargets)) seen.add(normalizeGroup(path));

  const extras = [...seen]
    .filter((path) => !core.has(path))
    .sort(
      (a, b) =>
        (valueByPath.get(b) ?? 0) - (valueByPath.get(a) ?? 0) || a.localeCompare(b),
    );

  return [...POLICY_ROOT_ORDER, ...extras];
}

/**
 * Legacy target maps sometimes stored sub-categories as absolute shares of the
 * whole portfolio with no explicit root. The app now treats children as a
 * percentage of their parent, so when an explicit root is introduced the
 * children must be re-expressed without changing their effective weights.
 *
 * When the parent already had a stored target the conversion is the identity,
 * which keeps normal hierarchical web policies byte-for-byte stable.
 */
function convertLegacyChildTargets(
  existing: Record<string, number>,
  root: string,
  rootEffective: number,
): Record<string, number> {
  const rawByPath = new Map<string, number>();
  for (const [rawPath, rawValue] of Object.entries(existing)) {
    const path = normalizeGroup(rawPath);
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    rawByPath.set(path, (rawByPath.get(path) ?? 0) + value);
  }

  const entries: { path: string; raw: number; depth: number }[] = [];
  for (const [path, raw] of rawByPath) {
    const parts = path.split(' > ');
    if (parts.length < 2 || parts[0] !== root) continue;
    entries.push({ path, raw, depth: parts.length });
  }
  entries.sort((a, b) => a.depth - b.depth);

  const effective = new Map<string, number>([[root, rootEffective]]);
  const converted: Record<string, number> = {};

  for (const entry of entries) {
    const parts = entry.path.split(' > ');
    const parentPath = parts.slice(0, -1).join(' > ');
    const parentEffective = effective.get(parentPath) ?? 0;
    const parentRaw = rawByPath.get(parentPath) ?? 0;
    const childEffective =
      parentRaw > 0 ? (entry.raw / 100) * parentEffective : entry.raw;
    effective.set(entry.path, childEffective);

    converted[entry.path] =
      parentEffective > 0
        ? Number(((childEffective / parentEffective) * 100).toFixed(4))
        : entry.raw;
  }

  return converted;
}

/**
 * Update root targets while preserving child composition for sleeves that stay
 * in the policy. Removing a root also removes its child targets.
 */
export function mergeRootTargets(
  existingTargets: Record<string, number>,
  rootTargets: Record<string, number>,
): Record<string, number> {
  const existing = existingTargets ?? {};
  const normalisedRoots: Record<string, number> = {};

  for (const [path, value] of Object.entries(rootTargets)) {
    const root = normalizeGroup(path);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    normalisedRoots[root] = (normalisedRoots[root] ?? 0) + parsed;
  }

  const rootEffective = rootTargetsFromMap(existing);
  const next: Record<string, number> = {};

  for (const root of Object.keys(normalisedRoots)) {
    Object.assign(
      next,
      convertLegacyChildTargets(existing, root, rootEffective[root] ?? 0),
    );
  }

  for (const [root, value] of Object.entries(normalisedRoots)) {
    next[root] = value;
  }

  return next;
}

/**
 * Scale a set of root targets so they total exactly 100%. Zero-weight sleeves
 * stay at zero; rounding residue is assigned to the largest sleeve.
 */
export function normalizeRootTargets(
  targets: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(targets)
    .map(([path, value]) => [normalizeGroup(path), Math.max(0, Number(value) || 0)] as const)
    .filter(([, value]) => value > 0);

  if (entries.length === 0) return { ...DEFAULT_IDEAL_ALLOCATION };

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const scaled = entries.map(
    ([path, value]) => [path, Math.round((value / total) * 1000) / 10] as [string, number],
  );
  const scaledTotal = scaled.reduce((sum, [, value]) => sum + value, 0);
  const remainder = Math.round((100 - scaledTotal) * 10) / 10;

  if (remainder !== 0) {
    let largest = 0;
    for (let index = 1; index < scaled.length; index += 1) {
      if (scaled[index][1] > scaled[largest][1]) largest = index;
    }
    scaled[largest][1] = Math.round((scaled[largest][1] + remainder) * 10) / 10;
  }

  return Object.fromEntries(scaled);
}

function completeRanges(
  ranges: Record<string, PolicyRange> | undefined,
): Record<string, PolicyRange> {
  const next: Record<string, PolicyRange> = {};
  for (const [rawPath, rawRange] of Object.entries(ranges ?? {})) {
    const min = Number(rawRange?.min);
    const max = Number(rawRange?.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) continue;
    next[normalizeGroup(rawPath)] = {
      min: clamp(min, 0, 100),
      max: clamp(max, 0, 100),
    };
  }
  return next;
}

export function buildPolicyUpdate(input: {
  existing: Policy;
  targets: Record<string, number>;
  bands: Record<string, number>;
  reviewCadence?: PolicyReviewCadence;
  ranges?: Record<string, PolicyRange>;
  decisionLevels?: Record<string, PolicyDecisionLevel>;
  benchmarks?: Record<string, string>;
  sectorTargets?: Record<string, number>;
  sectorRanges?: Record<string, PolicyRange>;
  riskBudget?: Record<string, number>;
  riskModel?: PolicyRiskModel;
  currencyPolicy?: PolicyCurrencyConfig;
  liquidityPolicy?: PolicyLiquidityConfig;
  allowUnallocated?: boolean;
  notes?: string;
  approvedBy?: string;
  changeNote?: string;
  now?: Date;
}): Policy {
  const timestamp = (input.now ?? new Date()).toISOString();
  const targets = normalizeIdealAllocation(input.targets);
  const roots = rootTargetsFromMap(targets);
  const bands = completeBands(roots, input.bands);
  const existing = input.existing;
  const keepId = existing.source === 'custom' && existing.id.length > 0;

  const sectorTargets: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(
    input.sectorTargets ?? existing.sectorTargets ?? {},
  )) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > 0) {
      sectorTargets[normalizeGroup(rawPath)] = value;
    }
  }

  const riskBudget: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(
    input.riskBudget ?? existing.riskBudget ?? {},
  )) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value >= 0) {
      riskBudget[normalizeGroup(rawPath)] = value;
    }
  }

  const storedVolatility =
    input.riskModel?.volatility ?? existing.riskModel?.volatility ?? {};
  const volatility: Record<string, number> = {};
  for (const [rawPath, rawValue] of Object.entries(storedVolatility)) {
    const value = Number(rawValue);
    if (Number.isFinite(value) && value >= 0) {
      volatility[normalizeGroup(rawPath)] = value;
    }
  }
  const correlation = Number(
    input.riskModel?.correlation ?? existing.riskModel?.correlation,
  );
  const riskModel: PolicyRiskModel = {
    volatility:
      Object.keys(volatility).length > 0
        ? volatility
        : { ...DEFAULT_RISK_VOLATILITY },
    correlation:
      Number.isFinite(correlation) && correlation >= -1 && correlation <= 1
        ? correlation
        : DEFAULT_RISK_CORRELATION,
    correlations:
      input.riskModel?.correlations ?? existing.riskModel?.correlations,
  };

  const liquidityValue = Number(
    input.liquidityPolicy?.minLiquidPct ??
      existing.liquidityPolicy?.minLiquidPct ??
      DEFAULT_LIQUIDITY_POLICY.minLiquidPct,
  );

  return {
    id: keepId ? existing.id : `policy-${Date.now().toString(36)}`,
    version: Math.max(1, Math.floor(Number(existing.version) || 0) + 1),
    effectiveFrom: timestamp,
    createdAt: validTimestamp(existing.createdAt, timestamp),
    updatedAt: timestamp,
    baseCurrency: 'INR',
    targets,
    bands,
    rebalance: { ...(existing.rebalance ?? DEFAULT_POLICY_REBALANCE) },
    reviewCadence: input.reviewCadence ?? existing.reviewCadence ?? 'quarterly',
    confirmedAt: timestamp,
    source: 'custom',
    ranges: completeRanges(input.ranges ?? existing.ranges),
    decisionLevels: {
      ...(input.decisionLevels ?? existing.decisionLevels ?? {}),
    },
    benchmarks: {
      ...(input.benchmarks ?? existing.benchmarks ?? {}),
    },
    allowUnallocated:
      input.allowUnallocated ?? existing.allowUnallocated ?? false,
    sectorTargets,
    sectorRanges: completeRanges(
      input.sectorRanges ?? existing.sectorRanges,
    ),
    riskBudget,
    riskModel,
    currencyPolicy: {
      baseCurrency: 'INR',
      hedgeTargets: {
        ...(input.currencyPolicy?.hedgeTargets ??
          existing.currencyPolicy?.hedgeTargets ??
          {}),
      },
    },
    liquidityPolicy: {
      minLiquidPct:
        Number.isFinite(liquidityValue) && liquidityValue >= 0
          ? clamp(liquidityValue, 0, 100)
          : DEFAULT_LIQUIDITY_POLICY.minLiquidPct,
    },
    notes: input.notes ?? existing.notes,
    approvedBy: input.approvedBy ?? existing.approvedBy,
    changeNote: input.changeNote ?? existing.changeNote,
  };
}

/** Keep a small, append-only audit trail of confirmed policy versions. */
export function buildPolicyHistory(
  existing: Policy,
  history: Policy[] | undefined,
): Policy[] {
  const previous = history ?? [];
  if (existing.confirmedAt == null || existing.source === 'template') return previous;

  const alreadyStored = previous.some(
    (policy) => policy.id === existing.id && policy.version === existing.version,
  );
  if (alreadyStored) return previous;

  return [existing, ...previous].slice(0, 12);
}

const REVIEW_MONTHS: Record<PolicyReviewCadence, number> = {
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/**
 * The next scheduled policy review, anchored to the last confirmation. Returns
 * null for the default template because there is nothing to review yet.
 */
export function reviewDueDate(policy: Policy): string | null {
  if (policy.confirmedAt == null || policy.source === 'template') return null;

  const anchor = new Date(policy.confirmedAt);
  if (!Number.isFinite(anchor.getTime())) return null;

  anchor.setMonth(anchor.getMonth() + (REVIEW_MONTHS[policy.reviewCadence] ?? 3));
  return anchor.toISOString();
}
