import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { TextField } from '@/src/components/ui/TextField';
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
  formatPercent,
} from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
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
          subtitle="Versioned sleeve targets, tolerance bands and review cadence"
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
              <Skeleton height={148} borderRadius={16} />
              <Skeleton height={220} borderRadius={16} />
              <Skeleton height={140} borderRadius={16} />
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

  const [targets, setTargets] = useState(() =>
    targetInputs(paths, config.rootTargets),
  );
  const [bands, setBands] = useState(() => bandInputs(paths, config.bands));
  const [cadence, setCadence] = useState<PolicyReviewCadence>(
    config.policy.reviewCadence ?? 'quarterly',
  );
  const [showValidation, setShowValidation] = useState(false);
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
      ? `${formatPercent(totalTarget - 100)} over`
      : `${formatPercent(100 - totalTarget)} unallocated`;
  const targetTotalTone = totalValid ? colors.positive : colors.warning;

  return (
    <>
      <Card style={styles.totalCard}>
        <View style={styles.totalHeader}>
          <View style={styles.totalText}>
            <Text style={[type.label, { color: colors.muted }]}>Total target</Text>
            <Text
              style={[styles.totalValue, numeric, { color: targetTotalTone }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {formatPercent(totalTarget)}
            </Text>
          </View>
          <View style={styles.totalBadges}>
            <Badge label={targetTotalLabel} tone={totalValid ? 'positive' : 'warning'} />
            <Badge label={policyStatus.badgeLabel} tone={policyStatus.badgeTone} />
          </View>
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          {formatCompactINR(portfolioValue)} portfolio ·{' '}
          {formatPercent(evaluation.managedPercentage)} covered by policy
          {evaluation.unmanaged.length > 0
            ? ` · ${formatPercent(evaluation.unmanagedPercentage)} outside`
            : ''}
        </Text>

        {!totalValid ? (
          <Button
            label="Scale targets to 100%"
            onPress={scaleTo100}
            variant="secondary"
            size="sm"
            icon="sliders"
            disabled={isDemo || totalTarget <= 0}
          />
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
          subtitle="Root sleeves are % of total; bands ±pp; an explicit range overrides the band"
          actionLabel="Load template"
          onAction={isDemo ? undefined : loadTemplate}
        />

        <View style={styles.sleeveStack}>
          {paths.map((path, index) => {
            const current = currentByPath.get(path);
            const currentPercent = current?.percent ?? 0;
            const currentValue = current?.value ?? 0;
            const targetValue = portfolioValue * ((parsedTargets.values[path] ?? 0) / 100);
            const targetError = showValidation
              ? parsedTargets.errors[path]
              : undefined;
            const bandError = showValidation ? parsedBands.errors[path] : undefined;
            const untargeted = (parsedTargets.values[path] ?? 0) <= 0 && currentPercent > 0;

            return (
              <Card key={path} style={styles.sleeveCard}>
                <View style={styles.sleeveHeader}>
                  <View
                    style={[
                      styles.sleeveDot,
                      { backgroundColor: colorForSleeve(path, index) },
                    ]}
                  />
                  <View style={styles.sleeveTitle}>
                    <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={1}>
                      {path}
                    </Text>
                    <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
                      Current {formatPercent(currentPercent)} · {formatCompactINR(currentValue)}
                    </Text>
                  </View>
                  {untargeted ? <Badge label="Outside" tone="warning" /> : null}
                </View>

                <View style={styles.sleeveInputs}>
                  <View style={styles.inputHalf}>
                    <TextField
                      label="Target %"
                      value={targets[path] ?? ''}
                      onChangeText={(value) =>
                        setTargets((current) => ({ ...current, [path]: value }))
                      }
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      selectTextOnFocus
                      editable={!isDemo}
                      error={targetError}
                      hint={
                        (parsedTargets.values[path] ?? 0) > 0
                          ? `≈ ${formatCompactINR(targetValue)}`
                          : 'Not targeted'
                      }
                    />
                  </View>
                  <View style={styles.inputHalf}>
                    <TextField
                      label="Band ±pp"
                      value={bands[path] ?? ''}
                      onChangeText={(value) =>
                        setBands((current) => ({ ...current, [path]: value }))
                      }
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      selectTextOnFocus
                      editable={!isDemo}
                      error={bandError}
                      hint={`Default ±${defaultBandFor(path)} pp`}
                    />
                  </View>
                </View>

                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                <View style={styles.rangeHeader}>
                  <View style={styles.rangeText}>
                    <Text style={[type.bodyMedium, { color: colors.text }]}>
                      Custom policy range
                    </Text>
                    <Text style={[type.caption, { color: colors.muted }]}>
                      {customRanges[path]
                        ? `Allowed ${rangeInputs[path]?.min || '—'}–${
                            rangeInputs[path]?.max || '—'
                          }% of portfolio`
                        : `Defaults to ±${parsedBands.values[path] ?? defaultBandFor(
                            path,
                          )} pp around the target`}
                    </Text>
                  </View>
                  <Chip
                    label={customRanges[path] ? 'On' : 'Off'}
                    selected={Boolean(customRanges[path])}
                    onPress={isDemo ? undefined : () => toggleRange(path)}
                  />
                </View>

                {customRanges[path] ? (
                  <View style={styles.sleeveInputs}>
                    <View style={styles.inputHalf}>
                      <TextField
                        label="Range min %"
                        value={rangeInputs[path]?.min ?? ''}
                        onChangeText={(value) =>
                          setRangeInputs((current) => ({
                            ...current,
                            [path]: {
                              min: value,
                              max: current[path]?.max ?? '',
                            },
                          }))
                        }
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        selectTextOnFocus
                        editable={!isDemo}
                      />
                    </View>
                    <View style={styles.inputHalf}>
                      <TextField
                        label="Range max %"
                        value={rangeInputs[path]?.max ?? ''}
                        onChangeText={(value) =>
                          setRangeInputs((current) => ({
                            ...current,
                            [path]: {
                              min: current[path]?.min ?? '',
                              max: value,
                            },
                          }))
                        }
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        selectTextOnFocus
                        editable={!isDemo}
                      />
                    </View>
                  </View>
                ) : null}

                {customRanges[path] && showValidation && parsedRanges.errors[path] ? (
                  <Text style={[type.caption, { color: colors.negative }]}>
                    {parsedRanges.errors[path]}
                  </Text>
                ) : null}

                <TextField
                  label="Benchmark (optional)"
                  placeholder="e.g. Nifty 500 TRI"
                  value={benchmarks[path] ?? ''}
                  onChangeText={(value) =>
                    setBenchmarks((current) => ({ ...current, [path]: value }))
                  }
                  autoCapitalize="characters"
                  editable={!isDemo}
                  hint="Shown in the policy report. No return comparison is implied."
                />
              </Card>
            );
          })}
        </View>
      </View>

      <View>
        <SectionHeader
          title="Sleeve composition"
          subtitle="Optional sub-targets that explain how each sleeve is built"
        />
        <Card style={styles.settingsCard}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>
            Composition targets
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            Add only the groups you actually use, such as Domestic/Global Equity or
            Gold/Silver. Roots stay the only policy level; composition nodes do not change
            bands, drift or the rebalance plan unless you promote them.
          </Text>
          <Button
            label={isDemo ? 'View composition' : 'Manage composition'}
            onPress={() => router.push('/breakdown')}
            variant="secondary"
            size="sm"
            icon="layers"
            fullWidth
          />
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Institutional tools"
          subtitle="Monitoring, risk budgeting and governed reporting"
        />
        <Card style={styles.settingsCard}>
          <Button
            label="Compliance & ranges"
            onPress={() => router.push('/compliance')}
            variant="secondary"
            size="sm"
            icon="shield"
            fullWidth
          />
          <Button
            label="Risk & liquidity"
            onPress={() => router.push('/risk')}
            variant="secondary"
            size="sm"
            icon="activity"
            fullWidth
          />
          <Button
            label="Policy report"
            onPress={() => router.push('/report')}
            variant="secondary"
            size="sm"
            icon="file-text"
            fullWidth
          />
          <Text style={[type.caption, { color: colors.muted }]}>
            Compliance compares explicit ranges and hard limits. Risk uses transparent
            volatility and correlation assumptions. The report consolidates accounts and
            the policy audit trail.
          </Text>
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Review & rebalance"
          subtitle="Cadence is a commitment, not a prediction"
        />
        <Card style={styles.settingsCard}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>Review cadence</Text>
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
          <Text style={[type.caption, { color: colors.muted }]}>
            {CADENCE_OPTIONS.find((option) => option.key === cadence)?.hint}
            {reviewDue
              ? ` · next review due ${formatDate(reviewDue)}`
              : ' · the first confirmation starts the review clock.'}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Rebalance method</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              Threshold · cash-flow first
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Tolerance model</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              Per-sleeve bands
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Cash reserve floor</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.policy.rebalance.minCashPct}% before rebalancing
            </Text>
          </View>
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Governance"
          subtitle="Notes and approval attach to the next policy version"
        />
        <Card style={styles.settingsCard}>
          <TextField
            label="Policy notes"
            placeholder="Mandate, constraints, liquidity needs…"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            style={styles.notesInput}
            editable={!isDemo}
            hint="Standing context for this policy. Prefilled from the current version."
          />
          <TextField
            label="Change note"
            placeholder="What changed and why"
            value={changeNote}
            onChangeText={setChangeNote}
            editable={!isDemo}
            hint="Recorded with the new version in the policy history."
          />
          <TextField
            label="Approved by"
            placeholder="e.g. Investment committee"
            value={approvedBy}
            onChangeText={setApprovedBy}
            autoCapitalize="words"
            editable={!isDemo}
            hint="Optional approver of record for this version."
          />
        </Card>
      </View>

      <View>
        <SectionHeader title="Policy record" subtitle="Every confirmation becomes a new version" />
        <Card style={styles.settingsCard}>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Version</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.isTemplate ? 'Not confirmed' : `v${config.policy.version}`}
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Source</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {SOURCE_LABEL[config.policy.source]}
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Effective from</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.isTemplate ? '—' : formatDate(config.policy.effectiveFrom)}
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Last changed</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.isTemplate ? '—' : formatDate(config.policy.updatedAt)}
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Next review</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {reviewDue ? formatDate(reviewDue) : '—'}
            </Text>
          </View>
          <View style={styles.factRow}>
            <Text style={[type.body, { color: colors.muted }]}>Prior versions</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.history.length}
            </Text>
          </View>

          {config.history.length > 0 ? (
            <View style={styles.historyList}>
              {config.history.slice(0, 3).map((entry) => {
                const previousTotal = Object.values(
                  rootTargetsFromMap(entry.targets),
                ).reduce((sum, value) => sum + value, 0);
                return (
                  <View
                    key={`${entry.id}:${entry.version}`}
                    style={[styles.historyRow, { borderTopColor: colors.border }]}
                  >
                    <Text style={[styles.historyVersion, { color: colors.text }]}>
                      v{entry.version}
                    </Text>
                    <Text style={[styles.historyDate, { color: colors.muted }]}>
                      {formatDate(entry.effectiveFrom)}
                    </Text>
                    <Text style={[styles.historyTotal, numeric, { color: colors.textSecondary }]}>
                      Targets {formatPercent(previousTotal)}
                    </Text>
                  </View>
                );
              })}
              {config.history.length > 3 ? (
                <Text style={[type.caption, { color: colors.muted }]}>
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
        {inputsValid && !totalValid ? (
          <Banner
            tone="warning"
            icon="alert-triangle"
            message={`Targets total ${formatPercent(totalTarget)}. Scale or adjust them to exactly 100%.`}
          />
        ) : null}

        <Button
          label={save.isPending ? 'Saving policy…' : saveLabel}
          onPress={confirm}
          disabled={!canSave}
          loading={save.isPending}
          icon={config.isTemplate ? 'check' : 'save'}
          fullWidth
          size="lg"
        />
        <Text style={[styles.saveHint, { color: colors.muted }]}>
          {config.isTemplate
            ? 'Confirming adopts these targets and creates policy v1.'
            : 'Saving creates a new version and keeps the previous version in the audit trail.'}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.xl },
  footer: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  totalCard: { gap: space.md },
  totalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  totalText: { flex: 1, gap: 2 },
  totalValue: { fontSize: 30, fontWeight: '600', letterSpacing: -0.6 },
  totalBadges: { alignItems: 'flex-end', gap: space.xs, maxWidth: '46%' },
  sleeveStack: { gap: space.md },
  sleeveCard: { gap: space.md, padding: space.md },
  sleeveHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sleeveDot: { width: 8, height: 8, borderRadius: radius.full },
  sleeveTitle: { flex: 1, gap: 2 },
  sleeveInputs: { flexDirection: 'row', gap: space.sm },
  inputHalf: { flex: 1 },
  rangeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rangeText: { flex: 1, gap: 2 },
  settingsCard: { gap: space.md },
  notesInput: { minHeight: 88, textAlignVertical: 'top', paddingTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { height: StyleSheet.hairlineWidth },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  factValue: { fontSize: 13, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  historyList: { gap: space.sm },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  historyVersion: { width: 32, fontSize: 11, fontWeight: '600' },
  historyDate: { flex: 1, fontSize: 10 },
  historyTotal: { fontSize: 10 },
  saveBlock: { gap: space.md },
  saveHint: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
