import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState, type ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { policyStatusView } from '@/src/components/portfolio/policyStatus';
import { DEFAULT_IDEAL_ALLOCATION, type AllocationNode } from '@/src/features/portfolio/analytics';
import {
  DEFAULT_POLICY_BANDS,
  colorForSleeve,
  defaultBandFor,
  mergeRootTargets,
  normalizeRootTargets,
  policySleevePaths,
  reviewDueDate,
  rootTargetsFromMap,
  type PolicyConfig,
  type PolicyEvaluation,
} from '@/src/features/portfolio/policy';
import { usePortfolioData, useSavePolicy } from '@/src/features/portfolio/queries';
import type {
  PolicyReviewCadence,
  PolicySource,
} from '@/src/features/portfolio/types';
import {
  formatCompactINR,
  formatDriftPp,
  formatPercent,
} from '@/src/lib/format/money';
import { numeric, radius, space } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const CADENCE_OPTIONS: { key: PolicyReviewCadence; label: string; hint: string }[] = [
  { key: 'quarterly', label: 'Quarterly', hint: 'Every 3 months' },
  { key: 'semiannual', label: 'Semiannual', hint: 'Every 6 months' },
  { key: 'annual', label: 'Annual', hint: 'Once a year' },
];

const SOURCE_LABEL: Record<PolicySource, string> = {
  template: 'Default template',
  custom: 'Household policy',
  migrated: 'Migrated from web targets',
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function targetInputs(
  paths: string[],
  targets: Record<string, number>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const path of paths) {
    const value = Number(targets[path] ?? 0);
    next[path] = String(round2(Number.isFinite(value) ? value : 0));
  }
  return next;
}

function bandInputs(
  paths: string[],
  bands: Record<string, number>,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const path of paths) {
    const value = Number(bands[path] ?? defaultBandFor(path));
    next[path] = String(round1(Number.isFinite(value) ? value : defaultBandFor(path)));
  }
  return next;
}

/**
 * Scale positive targets to 100% and round to two decimals, assigning the
 * rounding residue to the largest sleeve so the displayed inputs still total
 * exactly 100.
 */
function scaledTargetInputs(
  paths: string[],
  targets: Record<string, number>,
): Record<string, string> {
  const scaled = normalizeRootTargets(targets);
  const rounded: Record<string, number> = {};
  let total = 0;
  let largestPath = paths[0];
  let largestValue = -1;

  for (const path of paths) {
    const value = round2(scaled[path] ?? 0);
    rounded[path] = value;
    total += value;
    if (value > largestValue) {
      largestValue = value;
      largestPath = path;
    }
  }

  const residue = round2(100 - total);
  if (largestPath && residue !== 0) {
    rounded[largestPath] = round2(rounded[largestPath] + residue);
  }

  const next: Record<string, string> = {};
  for (const path of paths) next[path] = String(rounded[path] ?? 0);
  return next;
}

export default function PolicyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    analytics,
    policyConfig,
    policyEvaluation,
    isLoading,
    error,
    isDemo,
    refetch,
  } = usePortfolioData();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          eyebrow="Portfolio policy"
          title="Allocation policy"
          subtitle="Versioned targets, bands and review cadence"
          action={
            <IconButton
              icon="x"
              onPress={() => router.back()}
              accessibilityLabel="Close policy editor"
            />
          }
        />

        <View style={styles.stack}>
          {isDemo ? (
            <Banner
              tone="warning"
              icon="play-circle"
              message="Policy editing is read-only in demo mode. Sign in to confirm targets."
            />
          ) : null}

          {error ? (
            <Card>
              <ErrorState
                message={
                  error instanceof Error
                    ? error.message
                    : 'The policy could not be loaded.'
                }
                onRetry={refetch}
              />
            </Card>
          ) : isLoading ? (
            <View style={styles.stack}>
              <Skeleton height={96} borderRadius={16} />
              <Skeleton height={260} borderRadius={16} />
              <Skeleton height={120} borderRadius={16} />
            </View>
          ) : (
            <PolicyEditor
              key={`${policyConfig.policy.id}:${policyConfig.policy.version}:${policyConfig.policy.updatedAt}`}
              config={policyConfig}
              evaluation={policyEvaluation}
              nodes={analytics.allocationAnalysis}
              portfolioValue={analytics.totals.portfolio}
              isDemo={isDemo}
            />
          )}

          <Text style={[styles.footer, { color: colors.muted }]}>
            Targets are stored as a versioned household policy. Accounts execute it; they do not
            each carry their own target.
          </Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface PolicyEditorProps {
  config: PolicyConfig;
  evaluation: PolicyEvaluation;
  nodes: AllocationNode[];
  portfolioValue: number;
  isDemo: boolean;
}

function PolicyEditor({
  config,
  evaluation,
  nodes,
  portfolioValue,
  isDemo,
}: PolicyEditorProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const save = useSavePolicy();

  const paths = useMemo(
    () => policySleevePaths(config.rootTargets, nodes),
    [config.rootTargets, nodes],
  );

  const currentByPath = useMemo(() => {
    const map = new Map<string, { value: number; percent: number }>();
    for (const sleeve of evaluation.sleeves) {
      map.set(sleeve.path, {
        value: sleeve.currentValue,
        percent: sleeve.currentPercentage,
      });
    }
    for (const slice of evaluation.unmanaged) {
      map.set(slice.path, {
        value: slice.currentValue,
        percent: slice.currentPercentage,
      });
    }
    return map;
  }, [evaluation]);

  const sleeveByPath = useMemo(
    () => new Map(evaluation.sleeves.map((sleeve) => [sleeve.path, sleeve])),
    [evaluation.sleeves],
  );

  const subTargetCount = useMemo(
    () =>
      Object.keys(config.policy.targets).filter((path) => path.includes('>')).length,
    [config.policy.targets],
  );

  const [targets, setTargets] = useState(() =>
    targetInputs(paths, config.rootTargets),
  );
  const [bands, setBands] = useState(() => bandInputs(paths, config.bands));
  const [cadence, setCadence] = useState<PolicyReviewCadence>(
    config.policy.reviewCadence ?? 'quarterly',
  );
  const [showValidation, setShowValidation] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [customRanges, setCustomRanges] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      paths.map((path) => [path, config.policy.ranges?.[path] !== undefined]),
    ),
  );
  const [rangeInputs, setRangeInputs] = useState<
    Record<string, { min: string; max: string }>
  >(() => {
    const next: Record<string, { min: string; max: string }> = {};
    for (const path of paths) {
      const stored = config.ranges[path];
      const target = config.rootTargets[path] ?? 0;
      const band = config.bands[path] ?? defaultBandFor(path);
      next[path] = {
        min: String(round2(stored?.min ?? Math.max(0, target - band))),
        max: String(round2(stored?.max ?? Math.min(100, target + band))),
      };
    }
    return next;
  });
  const [benchmarks, setBenchmarks] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const path of paths) next[path] = config.benchmarks[path] ?? '';
    return next;
  });
  const [notes, setNotes] = useState(config.policy.notes ?? '');
  const [changeNote, setChangeNote] = useState('');
  const [approvedBy, setApprovedBy] = useState(config.policy.approvedBy ?? '');

  const parsedTargets = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const path of paths) {
      const raw = (targets[path] ?? '').trim();
      const value = Number(raw);
      if (raw === '') {
        values[path] = 0;
        errors[path] = 'Required';
      } else if (!Number.isFinite(value)) {
        values[path] = 0;
        errors[path] = 'Enter a number';
      } else if (value < 0 || value > 100) {
        values[path] = 0;
        errors[path] = 'Use 0–100';
      } else {
        values[path] = value;
      }
    }
    return { values, errors };
  }, [paths, targets]);

  const parsedBands = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const path of paths) {
      const raw = (bands[path] ?? '').trim();
      const value = Number(raw);
      if (raw === '') {
        values[path] = defaultBandFor(path);
        errors[path] = 'Required';
      } else if (!Number.isFinite(value)) {
        values[path] = defaultBandFor(path);
        errors[path] = 'Enter a number';
      } else if (value < 0.5 || value > 50) {
        values[path] = defaultBandFor(path);
        errors[path] = 'Use 0.5–50';
      } else {
        values[path] = value;
      }
    }
    return { values, errors };
  }, [bands, paths]);

  const parsedRanges = useMemo(() => {
    const values: Record<string, { min: number; max: number }> = {};
    const errors: Record<string, string> = {};
    for (const path of paths) {
      if (!customRanges[path]) continue;
      const input = rangeInputs[path] ?? { min: '', max: '' };
      const min = Number(input.min);
      const max = Number(input.max);
      if (input.min.trim() === '' || input.max.trim() === '') {
        errors[path] = 'Required';
        continue;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        errors[path] = 'Enter numbers';
        continue;
      }
      if (min < 0 || max > 100 || max < min) {
        errors[path] = 'Use 0–100 with max ≥ min';
        continue;
      }
      const target = parsedTargets.values[path] ?? 0;
      if (target < min || target > max) {
        errors[path] = `Target ${formatPercent(target)} is outside the range`;
        continue;
      }
      values[path] = { min, max };
    }
    return { values, errors };
  }, [customRanges, parsedTargets.values, paths, rangeInputs]);

  const totalTarget = paths.reduce(
    (sum, path) => sum + (parsedTargets.values[path] ?? 0),
    0,
  );
  const totalValid = Math.abs(totalTarget - 100) <= 0.01;
  const inputsValid =
    Object.keys(parsedTargets.errors).length === 0 &&
    Object.keys(parsedBands.errors).length === 0 &&
    Object.keys(parsedRanges.errors).length === 0;

  const dirty = useMemo(() => {
    if (cadence !== config.policy.reviewCadence) return true;
    if (notes !== (config.policy.notes ?? '')) return true;
    if (changeNote.trim() !== '') return true;
    if (approvedBy !== (config.policy.approvedBy ?? '')) return true;

    return paths.some((path) => {
      const targetChanged =
        round2(parsedTargets.values[path] ?? 0) !==
        round2(config.rootTargets[path] ?? 0);
      const bandChanged =
        round1(parsedBands.values[path] ?? defaultBandFor(path)) !==
        round1(config.bands[path] ?? defaultBandFor(path));
      const storedRange = config.policy.ranges?.[path];
      const customChanged =
        Boolean(customRanges[path]) !== Boolean(storedRange);
      const rangeChanged =
        Boolean(customRanges[path]) &&
        storedRange != null &&
        (round2(parsedRanges.values[path]?.min ?? 0) !== round2(storedRange.min) ||
          round2(parsedRanges.values[path]?.max ?? 0) !== round2(storedRange.max));
      const benchmarkChanged =
        (benchmarks[path] ?? '').trim() !== (config.benchmarks[path] ?? '');
      return targetChanged || bandChanged || customChanged || rangeChanged || benchmarkChanged;
    });
  }, [
    approvedBy,
    benchmarks,
    cadence,
    changeNote,
    config.benchmarks,
    config.policy.approvedBy,
    config.policy.notes,
    config.policy.ranges,
    config.policy.reviewCadence,
    config.rootTargets,
    config.bands,
    customRanges,
    notes,
    parsedTargets.values,
    parsedBands.values,
    parsedRanges.values,
    paths,
  ]);

  const canSave =
    !isDemo &&
    inputsValid &&
    totalValid &&
    (dirty || config.isTemplate) &&
    !save.isPending;

  const saveLabel = isDemo
    ? 'Read-only in demo'
    : !inputsValid
      ? 'Check the highlighted inputs'
      : !totalValid
        ? 'Targets must total 100%'
        : config.isTemplate
          ? 'Confirm policy'
          : dirty
            ? 'Save policy'
            : 'No changes to save';

  const policyStatus = policyStatusView(evaluation);
  const reviewDue = reviewDueDate(config.policy);

  const statusColor =
    policyStatus.tone === 'negative'
      ? colors.negative
      : policyStatus.tone === 'positive'
        ? colors.positive
        : colors.textSecondary;
  const outsideNote =
    evaluation.unmanagedPercentage > 0.05
      ? ` · ${formatPercent(evaluation.unmanagedPercentage, { precision: 1 })} outside`
      : '';
  const statusBase =
    evaluation.status === 'breach'
      ? `${evaluation.inToleranceCount}/${evaluation.targetedCount} in tolerance · worst ${formatDriftPp(
          evaluation.worstDriftPp,
          { signed: true },
        )}`
      : evaluation.status === 'invalid'
        ? `Targets sum to ${formatPercent(evaluation.targetSum, { precision: 1 })}`
        : evaluation.status === 'template' || evaluation.status === 'unmanaged'
          ? `${formatPercent(evaluation.managedPercentage, { precision: 1 })} of portfolio covered`
          : `${evaluation.inToleranceCount}/${evaluation.targetedCount} in tolerance · worst ${formatDriftPp(
              evaluation.worstDriftPp,
              { signed: true },
            )}`;
  const statusDetail = `${statusBase}${outsideNote}`;

  const scaleTo100 = () => {
    setTargets(scaledTargetInputs(paths, parsedTargets.values));
  };

  const toggleRange = (path: string) => {
    const nextValue = !customRanges[path];
    setCustomRanges((current) => ({ ...current, [path]: nextValue }));
    if (!nextValue) return;

    setRangeInputs((current) => {
      if (current[path]) return current;
      const target = parsedTargets.values[path] ?? 0;
      const band = parsedBands.values[path] ?? defaultBandFor(path);
      return {
        ...current,
        [path]: {
          min: String(round2(Math.max(0, target - band))),
          max: String(round2(Math.min(100, target + band))),
        },
      };
    });
  };

  const loadTemplate = () => {
    setTargets(targetInputs(paths, DEFAULT_IDEAL_ALLOCATION));
    setBands(bandInputs(paths, DEFAULT_POLICY_BANDS));
    setCadence('quarterly');
    setCustomRanges({});
    setRangeInputs({});
  };

  const confirm = () => {
    setShowValidation(true);
    if (!canSave) return;

    const rootTargets: Record<string, number> = {};
    for (const path of paths) {
      const displayed = round2(parsedTargets.values[path] ?? 0);
      const original = Number(config.rootTargets[path] ?? 0);
      // The editor shows two decimals. When that display is unchanged, keep the
      // stored precision so a band-only edit does not rewrite target amounts.
      const unchanged = Number.isFinite(original) && round2(original) === displayed;
      const value = unchanged && displayed > 0 ? original : displayed;
      if (value > 0) rootTargets[path] = value;
    }

    const nextBands: Record<string, number> = {};
    for (const path of paths) {
      if ((rootTargets[path] ?? 0) > 0) {
        nextBands[path] = round1(parsedBands.values[path] ?? defaultBandFor(path));
      }
    }

    const nextRanges = { ...(config.policy.ranges ?? {}) };
    for (const path of paths) {
      if (customRanges[path]) {
        const range = parsedRanges.values[path];
        if (range) nextRanges[path] = range;
      } else {
        delete nextRanges[path];
      }
    }

    const nextBenchmarks = { ...(config.policy.benchmarks ?? {}) };
    for (const path of paths) {
      const value = (benchmarks[path] ?? '').trim();
      if (value) nextBenchmarks[path] = value;
      else delete nextBenchmarks[path];
    }

    save.mutate(
      {
        targets: mergeRootTargets(config.policy.targets, rootTargets),
        bands: nextBands,
        reviewCadence: cadence,
        ranges: nextRanges,
        decisionLevels: config.policy.decisionLevels,
        benchmarks: nextBenchmarks,
        sectorTargets: config.policy.sectorTargets,
        sectorRanges: config.policy.sectorRanges,
        riskBudget: config.policy.riskBudget,
        riskModel: config.policy.riskModel,
        currencyPolicy: config.policy.currencyPolicy,
        liquidityPolicy: config.policy.liquidityPolicy,
        allowUnallocated: config.policy.allowUnallocated,
        notes: notes.trim(),
        approvedBy: approvedBy.trim(),
        changeNote: changeNote.trim(),
      },
      { onSuccess: () => router.back() },
    );
  };

  const targetTotalLabel = totalValid
    ? 'Fully allocated'
    : totalTarget > 100
      ? `${formatPercent(totalTarget - 100, { precision: 1 })} over`
      : `${formatPercent(100 - totalTarget, { precision: 1 })} unallocated`;

  return (
    <>
      <Card padded={false}>
        <View style={styles.summary}>
          <View style={styles.summaryMetric}>
            <Text style={[styles.metricLabel, { color: colors.muted }]}>Total target</Text>
            <Text
              style={[
                styles.metricValue,
                numeric,
                { color: totalValid ? colors.text : colors.warning },
              ]}
              numberOfLines={1}
            >
              {formatPercent(totalTarget, { precision: 1 })}
            </Text>
            <Text style={[styles.metricMeta, { color: colors.muted }]} numberOfLines={1}>
              {formatCompactINR(portfolioValue)} portfolio
            </Text>
          </View>

          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />

          <View style={styles.summaryMetric}>
            <Text style={[styles.metricLabel, { color: colors.muted }]}>Policy status</Text>
            <View style={styles.statusLine}>
              <Feather name={policyStatus.icon} size={13} color={statusColor} />
              <Text
                style={[styles.statusHeadline, { color: statusColor }]}
                numberOfLines={1}
              >
                {policyStatus.headline}
              </Text>
            </View>
            <Text style={[styles.metricMeta, { color: colors.muted }]} numberOfLines={2}>
              {statusDetail}
            </Text>
          </View>
        </View>

        {!totalValid ? (
          <View style={[styles.summaryAction, { borderTopColor: colors.border }]}>
            <View style={styles.summaryActionText}>
              <Text style={[styles.actionTitle, { color: colors.warning }]}>
                {targetTotalLabel}
              </Text>
              <Text style={[styles.metricMeta, { color: colors.muted }]}>
                Targets must total exactly 100.0%
              </Text>
            </View>
            <Button
              label="Scale to 100%"
              onPress={scaleTo100}
              variant="secondary"
              size="sm"
              icon="sliders"
              disabled={isDemo || totalTarget <= 0}
            />
          </View>
        ) : null}
      </Card>

      {save.isError ? (
        <Banner
          tone="error"
          icon="alert-circle"
          message={
            save.error instanceof Error
              ? save.error.message
              : 'The policy could not be saved.'
          }
        />
      ) : null}

      <View>
        <SectionHeader
          title="Sleeve targets"
          subtitle="Current weight and ±pp bands; expand for details."
          actionLabel={isDemo ? undefined : 'Load template'}
          onAction={isDemo ? undefined : loadTemplate}
        />

        <Card padded={false}>
          <View style={[styles.tableHead, { borderBottomColor: colors.border }]}>
            <Text style={[styles.th, styles.thName, { color: colors.muted }]}>Sleeve</Text>
            <Text style={[styles.th, styles.thCurrent, { color: colors.muted }]}>Current</Text>
            <Text style={[styles.th, styles.thTarget, { color: colors.muted }]}>Target</Text>
            <Text style={[styles.th, styles.thBand, { color: colors.muted }]}>Band</Text>
            <View style={styles.thChevron} />
          </View>

          {paths.map((path, index) => {
            const current = currentByPath.get(path);
            const currentPercent = current?.percent ?? 0;
            const currentValue = current?.value ?? 0;
            const sleeve = sleeveByPath.get(path);
            const driftPp = sleeve?.driftPp ?? 0;
            const status = sleeve?.status;
            const targetError = showValidation ? parsedTargets.errors[path] : undefined;
            const bandError = showValidation ? parsedBands.errors[path] : undefined;
            const untargeted =
              (parsedTargets.values[path] ?? 0) <= 0 && currentPercent > 0;
            const isExpanded = expandedPath === path;
            const hasAdvanced =
              Boolean(customRanges[path]) ||
              (benchmarks[path] ?? '').trim().length > 0;
            const driftColor =
              status === 'breach'
                ? colors.negative
                : status === 'watch'
                  ? colors.warning
                  : colors.muted;
            const rowNote = targetError
              ? targetError
              : untargeted
                ? `Outside policy · ${formatCompactINR(currentValue)}`
                : `${formatCompactINR(currentValue)} · ${formatDriftPp(driftPp, {
                    signed: true,
                  })}${
                    status === 'breach'
                      ? ' · breach'
                      : status === 'watch'
                        ? ' · watch'
                        : ''
                  }`;

            return (
              <View key={path}>
                <View
                  style={[
                    styles.sleeveRow,
                    index > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => setExpandedPath(isExpanded ? null : path)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isExpanded }}
                    accessibilityLabel={`${path}: ${formatPercent(currentPercent, {
                      precision: 1,
                    })} current, ${formatPercent(parsedTargets.values[path] ?? 0, {
                      precision: 1,
                    })} target. ${isExpanded ? 'Hide' : 'Show'} range and benchmark.`}
                    style={styles.sleeveIdentity}
                  >
                    <View
                      style={[
                        styles.sleeveDot,
                        { backgroundColor: colorForSleeve(path, index) },
                      ]}
                    />
                    <View style={styles.sleeveText}>
                      <Text
                        style={[styles.sleeveName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {path}
                      </Text>
                      <Text
                        style={[
                          styles.sleeveMeta,
                          { color: targetError ? colors.negative : driftColor },
                        ]}
                        numberOfLines={1}
                      >
                        {rowNote}
                      </Text>
                    </View>
                  </Pressable>

                  <Text
                    style={[
                      styles.currentValue,
                      numeric,
                      {
                        color:
                          status === 'breach' ? colors.negative : colors.textSecondary,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {formatPercent(currentPercent, { precision: 1 })}
                  </Text>

                  <View style={styles.targetCell}>
                    <CompactField
                      value={targets[path] ?? ''}
                      onChangeText={(value) =>
                        setTargets((currentInputs) => ({
                          ...currentInputs,
                          [path]: value,
                        }))
                      }
                      editable={!isDemo}
                      keyboardType="decimal-pad"
                      align="right"
                      suffix="%"
                      dense
                      invalid={Boolean(targetError)}
                      accessibilityLabel={`${path} target percentage`}
                    />
                  </View>

                  <View style={styles.bandCell}>
                    <CompactField
                      value={bands[path] ?? ''}
                      onChangeText={(value) =>
                        setBands((currentInputs) => ({
                          ...currentInputs,
                          [path]: value,
                        }))
                      }
                      editable={!isDemo}
                      keyboardType="decimal-pad"
                      align="right"
                      prefix="±"
                      dense
                      invalid={Boolean(bandError)}
                      accessibilityLabel={`${path} band in percentage points`}
                    />
                  </View>

                  <Pressable
                    onPress={() => setExpandedPath(isExpanded ? null : path)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${isExpanded ? 'Hide' : 'Show'} advanced policy settings for ${path}`}
                    style={styles.chevron}
                  >
                    <Feather
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color={hasAdvanced ? colors.accent : colors.muted}
                    />
                  </Pressable>
                </View>

                {isExpanded ? (
                  <View
                    style={[
                      styles.advanced,
                      {
                        backgroundColor: colors.cardMuted,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.advRow}>
                      <View style={styles.advText}>
                        <Text style={[styles.advLabel, { color: colors.textSecondary }]}>
                          Custom range
                        </Text>
                        <Text
                          style={[styles.advHint, { color: colors.muted }]}
                          numberOfLines={1}
                        >
                          {customRanges[path]
                            ? `Allowed ${rangeInputs[path]?.min || '—'}–${
                                rangeInputs[path]?.max || '—'
                              }% of portfolio`
                            : `Uses the ±${
                                parsedBands.values[path] ?? defaultBandFor(path)
                              } pp band`}
                        </Text>
                      </View>
                      <Chip
                        label={customRanges[path] ? 'On' : 'Off'}
                        selected={Boolean(customRanges[path])}
                        onPress={isDemo ? undefined : () => toggleRange(path)}
                      />
                    </View>

                    {customRanges[path] ? (
                      <View style={styles.rangeRow}>
                        <CompactField
                          value={rangeInputs[path]?.min ?? ''}
                          onChangeText={(value) =>
                            setRangeInputs((currentInputs) => ({
                              ...currentInputs,
                              [path]: {
                                min: value,
                                max: currentInputs[path]?.max ?? '',
                              },
                            }))
                          }
                          editable={!isDemo}
                          keyboardType="decimal-pad"
                          align="right"
                          suffix="%"
                          placeholder="Min"
                          dense
                          accessibilityLabel={`${path} custom range minimum`}
                          style={styles.rangeField}
                        />
                        <Text style={[styles.rangeDash, { color: colors.muted }]}>–</Text>
                        <CompactField
                          value={rangeInputs[path]?.max ?? ''}
                          onChangeText={(value) =>
                            setRangeInputs((currentInputs) => ({
                              ...currentInputs,
                              [path]: {
                                min: currentInputs[path]?.min ?? '',
                                max: value,
                              },
                            }))
                          }
                          editable={!isDemo}
                          keyboardType="decimal-pad"
                          align="right"
                          suffix="%"
                          placeholder="Max"
                          dense
                          accessibilityLabel={`${path} custom range maximum`}
                          style={styles.rangeField}
                        />
                        <Text style={[styles.advHint, { color: colors.muted }]}>
                          min / max
                        </Text>
                      </View>
                    ) : null}

                    {customRanges[path] && showValidation && parsedRanges.errors[path] ? (
                      <Text style={[styles.advError, { color: colors.negative }]}>
                        {parsedRanges.errors[path]}
                      </Text>
                    ) : null}

                    <View style={styles.benchmarkRow}>
                      <Text style={[styles.advLabel, { color: colors.textSecondary }]}>
                        Benchmark
                      </Text>
                      <TextInput
                        value={benchmarks[path] ?? ''}
                        onChangeText={(value) =>
                          setBenchmarks((currentInputs) => ({
                            ...currentInputs,
                            [path]: value,
                          }))
                        }
                        placeholder="Optional, e.g. Nifty 500 TRI"
                        placeholderTextColor={colors.muted}
                        autoCapitalize="characters"
                        editable={!isDemo}
                        accessibilityLabel={`${path} benchmark`}
                        style={[
                          styles.benchmarkInput,
                          {
                            color: colors.text,
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Sleeve composition"
          subtitle="Sub-targets explain how each root sleeve is built; roots remain the policy level"
        />
        <Card padded={false}>
          <PolicyLinkRow
            first
            icon="layers"
            title="Composition targets"
            meta={
              subTargetCount > 0
                ? `${subTargetCount} sub-target${subTargetCount === 1 ? '' : 's'} set · optional`
                : 'No sub-targets set · optional'
            }
            actionLabel={isDemo ? 'View' : 'Manage'}
            onPress={() => router.push('/breakdown')}
          />
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Institutional tools"
          subtitle="Ranges, risk budget and governed reporting"
        />
        <Card padded={false}>
          <PolicyLinkRow
            first
            icon="shield"
            title="Compliance & ranges"
            meta="Explicit ranges and hard limits"
            actionLabel="Open"
            onPress={() => router.push('/compliance')}
          />
          <PolicyLinkRow
            icon="activity"
            title="Risk & liquidity"
            meta="Volatility, correlation and cash-floor checks"
            actionLabel="Open"
            onPress={() => router.push('/risk')}
          />
          <PolicyLinkRow
            icon="file-text"
            title="Policy report"
            meta="Consolidated accounts and the policy audit trail"
            actionLabel="Open"
            onPress={() => router.push('/report')}
          />
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Review & rebalance"
          subtitle="Cadence is a commitment, not a prediction"
        />
        <Card padded={false}>
          <View style={styles.settingsBlock}>
            <Text style={[styles.blockLabel, { color: colors.muted }]}>
              Review cadence
            </Text>
            <View style={styles.chips}>
              {CADENCE_OPTIONS.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  selected={cadence === option.key}
                  onPress={isDemo ? undefined : () => setCadence(option.key)}
                />
              ))}
            </View>
            <Text style={[styles.blockHint, { color: colors.muted }]}>
              {CADENCE_OPTIONS.find((option) => option.key === cadence)?.hint}
              {reviewDue
                ? ` · next review due ${formatDate(reviewDue)}`
                : ' · the first confirmation starts the review clock'}
            </Text>
          </View>

          <FactRow label="Rebalance method" value="Threshold · cash-flow first" />
          <FactRow label="Tolerance model" value="Per-sleeve bands" />
          <FactRow
            label="Cash reserve floor"
            value={`${config.policy.rebalance.minCashPct}% before rebalancing`}
          />
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Governance"
          subtitle="Notes and approval attach to the next policy version"
        />
        <Card style={styles.formCard}>
          <CompactField
            label="Policy notes"
            placeholder="Mandate, constraints, liquidity needs…"
            value={notes}
            onChangeText={setNotes}
            editable={!isDemo}
            multiline
          />
          <CompactField
            label="Change note"
            placeholder="What changed and why"
            value={changeNote}
            onChangeText={setChangeNote}
            editable={!isDemo}
          />
          <CompactField
            label="Approved by"
            placeholder="e.g. Investment committee"
            value={approvedBy}
            onChangeText={setApprovedBy}
            editable={!isDemo}
            autoCapitalize="words"
          />
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Policy record"
          subtitle="Every confirmation becomes a new version"
        />
        <Card padded={false}>
          <FactRow
            first
            label="Version"
            value={config.isTemplate ? 'Not confirmed' : `v${config.policy.version}`}
          />
          <FactRow label="Source" value={SOURCE_LABEL[config.policy.source]} />
          <FactRow
            label="Effective from"
            value={config.isTemplate ? '—' : formatDate(config.policy.effectiveFrom)}
          />
          <FactRow
            label="Last changed"
            value={config.isTemplate ? '—' : formatDate(config.policy.updatedAt)}
          />
          <FactRow label="Next review" value={reviewDue ? formatDate(reviewDue) : '—'} />
          <FactRow label="Prior versions" value={String(config.history.length)} />

          {config.history.length > 0 ? (
            <View style={[styles.historyList, { borderTopColor: colors.border }]}>
              <Text style={[styles.blockLabel, { color: colors.muted }]}>
                Recent versions
              </Text>
              {config.history.slice(0, 3).map((entry, index) => {
                const previousTotal = Object.values(
                  rootTargetsFromMap(entry.targets),
                ).reduce((sum, value) => sum + value, 0);
                return (
                  <View
                    key={`${entry.id}:${entry.version}`}
                    style={[
                      styles.historyRow,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.historyVersion, { color: colors.text }]}>
                      v{entry.version}
                    </Text>
                    <Text style={[styles.historyDate, { color: colors.muted }]}>
                      {formatDate(entry.effectiveFrom)}
                    </Text>
                    <Text
                      style={[
                        styles.historyTotal,
                        numeric,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {formatPercent(previousTotal, { precision: 1 })} targets
                    </Text>
                  </View>
                );
              })}
              {config.history.length > 3 ? (
                <Text style={[styles.blockHint, { color: colors.muted }]}>
                  + {config.history.length - 3} earlier{' '}
                  {config.history.length - 3 === 1 ? 'version' : 'versions'}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>
      </View>

      <View style={styles.saveBlock}>
        {!inputsValid && showValidation ? (
          <Banner
            tone="warning"
            icon="alert-triangle"
            message={
              Object.values(parsedRanges.errors)[0]
                ? `Range check: ${Object.values(parsedRanges.errors)[0]}`
                : 'Fix the highlighted target, band or range inputs before saving.'
            }
          />
        ) : null}

        <Button
          label={save.isPending ? 'Saving policy…' : saveLabel}
          onPress={confirm}
          disabled={!canSave}
          loading={save.isPending}
          icon={config.isTemplate ? 'check' : 'save'}
          fullWidth
          size="md"
        />
        <Text style={[styles.saveHint, { color: colors.muted }]}>
          {isDemo
            ? 'Demo policy is read-only. Nothing is written to the server.'
            : config.isTemplate
              ? 'Confirming adopts these targets and creates policy v1.'
              : 'Saving creates a new version; the previous one stays in the audit trail.'}
        </Text>
      </View>
    </>
  );
}

interface CompactFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  label?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  editable?: boolean;
  invalid?: boolean;
  dense?: boolean;
  multiline?: boolean;
  align?: 'left' | 'right';
  keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
  autoCapitalize?: ComponentProps<typeof TextInput>['autoCapitalize'];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function CompactField({
  value,
  onChangeText,
  label,
  placeholder,
  prefix,
  suffix,
  editable = true,
  invalid = false,
  dense = false,
  multiline = false,
  align = 'left',
  keyboardType,
  autoCapitalize,
  accessibilityLabel,
  style,
}: CompactFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={style}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.fieldBox,
          dense ? styles.fieldBoxDense : null,
          multiline ? styles.fieldBoxMultiline : null,
          {
            backgroundColor: colors.cardMuted,
            borderColor: invalid
              ? colors.negative
              : focused
                ? colors.accent
                : colors.border,
          },
        ]}
      >
        {prefix ? (
          <Text style={[styles.fieldAffix, { color: colors.muted }]}>{prefix}</Text>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={editable}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize ?? (multiline ? 'sentences' : 'none')}
          multiline={multiline}
          selectTextOnFocus={!multiline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={accessibilityLabel ?? label}
          style={[
            styles.fieldInput,
            dense ? styles.fieldInputDense : null,
            multiline ? styles.fieldInputMultiline : null,
            {
              color: editable ? colors.text : colors.textSecondary,
              textAlign: align,
            },
          ]}
        />
        {suffix ? (
          <Text style={[styles.fieldAffix, { color: colors.muted }]}>{suffix}</Text>
        ) : null}
      </View>
    </View>
  );
}

interface PolicyLinkRowProps {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  meta: string;
  actionLabel: string;
  onPress: () => void;
  first?: boolean;
}

function PolicyLinkRow({
  icon,
  title,
  meta,
  actionLabel,
  onPress,
  first = false,
}: PolicyLinkRowProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
      style={({ pressed }) => [
        styles.linkRow,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        pressed && { backgroundColor: colors.cardMuted },
      ]}
    >
      <View style={[styles.linkIcon, { backgroundColor: colors.cardMuted }]}>
        <Feather name={icon} size={13} color={colors.textSecondary} />
      </View>
      <View style={styles.linkText}>
        <Text style={[styles.linkTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.linkMeta, { color: colors.muted }]} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Text style={[styles.linkAction, { color: colors.accent }]}>{actionLabel}</Text>
      <Feather name="chevron-right" size={14} color={colors.muted} />
    </Pressable>
  );
}

interface FactRowProps {
  label: string;
  value: string;
  first?: boolean;
}

function FactRow({ label, value, first = false }: FactRowProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.factRow,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.factLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.factValue, { color: colors.textSecondary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.lg },
  footer: { fontSize: 10, lineHeight: 15, textAlign: 'center' },

  summary: { flexDirection: 'row', padding: space.md },
  summaryMetric: { flex: 1, gap: 2 },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metricValue: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  metricMeta: { fontSize: 10, lineHeight: 14 },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    marginHorizontal: space.md,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusHeadline: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  summaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  summaryActionText: { flex: 1, gap: 1 },
  actionTitle: { fontSize: 12, fontWeight: '600' },

  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: space.sm,
    paddingBottom: 6,
  },
  th: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  thName: { flex: 1, paddingLeft: 13 },
  thCurrent: { width: 54, textAlign: 'right' },
  thTarget: { width: 56, textAlign: 'right' },
  thBand: { width: 46, textAlign: 'right' },
  thChevron: { width: 22 },

  sleeveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sleeveIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
  },
  sleeveDot: { width: 7, height: 7, borderRadius: radius.full },
  sleeveText: { flex: 1, minWidth: 0, gap: 1 },
  sleeveName: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  sleeveMeta: { fontSize: 10, lineHeight: 13 },
  currentValue: { width: 54, fontSize: 12, fontWeight: '500', textAlign: 'right' },
  targetCell: { width: 56 },
  bandCell: { width: 46 },
  chevron: { width: 22, alignItems: 'flex-end', justifyContent: 'center' },

  advanced: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  advRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  advText: { flex: 1, gap: 1 },
  advLabel: { fontSize: 12, fontWeight: '500' },
  advHint: { fontSize: 10, lineHeight: 14 },
  advError: { fontSize: 10, lineHeight: 14 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rangeField: { width: 62 },
  rangeDash: { fontSize: 12 },
  benchmarkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  benchmarkInput: {
    flex: 1,
    minWidth: 0,
    height: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 0,
    fontSize: 12,
  },

  fieldLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  fieldBoxDense: { height: 30, paddingHorizontal: 5 },
  fieldBoxMultiline: {
    height: 'auto',
    minHeight: 68,
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    width: 0,
    height: 32,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 13,
    fontWeight: '500',
  },
  fieldInputDense: { height: 28, fontSize: 12 },
  fieldInputMultiline: {
    height: 'auto',
    minHeight: 56,
    textAlignVertical: 'top',
    fontSize: 12,
    lineHeight: 18,
  },
  fieldAffix: { fontSize: 11, fontWeight: '500' },

  settingsBlock: {
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  blockLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  blockHint: { fontSize: 10, lineHeight: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  formCard: { gap: 10, padding: space.md },

  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 34,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  factLabel: { fontSize: 12 },
  factValue: { fontSize: 12, fontWeight: '500', flexShrink: 1, textAlign: 'right' },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  linkIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, minWidth: 0, gap: 1 },
  linkTitle: { fontSize: 13, fontWeight: '500' },
  linkMeta: { fontSize: 10, lineHeight: 14 },
  linkAction: { fontSize: 11, fontWeight: '600' },

  historyList: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  historyVersion: { width: 30, fontSize: 11, fontWeight: '600' },
  historyDate: { flex: 1, fontSize: 10 },
  historyTotal: { fontSize: 10 },

  saveBlock: { gap: 10 },
  saveHint: { fontSize: 10, lineHeight: 14, textAlign: 'center' },
});
