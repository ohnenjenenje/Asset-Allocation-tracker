import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Badge, type BadgeTone } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { TextField } from '@/src/components/ui/TextField';
import { ErrorState } from '@/src/components/ui/States';
import type { ExposureSlice } from '@/src/features/portfolio/analytics';
import { validateComposition } from '@/src/features/portfolio/breakdown';
import {
  evaluateCompliance,
  rangeStatusFor,
  severityForRange,
  type ComplianceReport,
  type ComplianceSeverity,
  type PolicyRangeRow,
  type RangeStatus,
} from '@/src/features/portfolio/compliance';
import {
  analyzeStockConcentration,
  equitySleeveValue,
} from '@/src/features/portfolio/concentration';
import { reviewDueDate, type PolicyConfig } from '@/src/features/portfolio/policy';
import { usePortfolioData, useSavePolicy } from '@/src/features/portfolio/queries';
import type { PolicyRange } from '@/src/features/portfolio/types';
import {
  formatCompactINR,
  formatDriftPp,
  formatPercent,
} from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const round2 = (value: number) => Math.round(value * 100) / 100;

const STATUS_COPY: Record<
  ComplianceReport['status'],
  { label: string; tone: BadgeTone; detail: string }
> = {
  compliant: {
    label: 'Compliant',
    tone: 'positive',
    detail: 'Every monitored range and policy check is inside tolerance.',
  },
  watch: {
    label: 'Watch',
    tone: 'warning',
    detail: 'No breaches, but at least one range or check needs attention.',
  },
  breach: {
    label: 'Breach',
    tone: 'negative',
    detail: 'At least one policy range or hard limit is outside tolerance.',
  },
  template: {
    label: 'Template',
    tone: 'neutral',
    detail: 'Confirm the root policy before compliance can be measured.',
  },
  unmanaged: {
    label: 'No policy nodes',
    tone: 'neutral',
    detail: 'Add sleeve targets to start monitoring compliance.',
  },
};

function severityTone(severity: ComplianceSeverity): BadgeTone {
  if (severity === 'breach') return 'negative';
  if (severity === 'watch') return 'warning';
  return 'positive';
}

function rangeStatusLabel(row: PolicyRangeRow): string {
  switch (row.status) {
    case 'below':
      return 'Below range';
    case 'watch-low':
      return 'Near low';
    case 'watch-high':
      return 'Near high';
    case 'above':
      return 'Above range';
    default:
      return 'Inside';
  }
}

function sectorStatusLabel(status: RangeStatus | 'untargeted'): string {
  switch (status) {
    case 'below':
      return 'Below range';
    case 'watch-low':
      return 'Near low';
    case 'watch-high':
      return 'Near high';
    case 'above':
      return 'Above range';
    case 'untargeted':
      return 'Untargeted';
    default:
      return 'Inside';
  }
}

export default function ComplianceScreen() {
  const router = useRouter();
  const {
    analytics,
    summary,
    policyConfig,
    policyEvaluation,
    fundCoverage,
    isLoading,
    error,
    isDemo,
    refetch,
  } = usePortfolioData();

  const concentration = useMemo(
    () =>
      analyzeStockConcentration({
        holdings: summary.holdings,
        funds: analytics.funds,
        equityValue: equitySleeveValue(
          policyEvaluation.sleeves,
          analytics.totals.equity,
        ),
        portfolioValue: analytics.totals.portfolio,
      }),
    [
      analytics.funds,
      analytics.totals.equity,
      analytics.totals.portfolio,
      policyEvaluation.sleeves,
      summary.holdings,
    ],
  );

  const report = useMemo(
    () =>
      evaluateCompliance({
        config: policyConfig,
        nodes: analytics.allocationAnalysis,
        totalValue: analytics.totals.portfolio,
        fundCoverage,
        unmanagedPercentage: policyEvaluation.unmanagedPercentage,
        holdings: summary.holdings.map((holding) => ({
          name: holding.asset.name,
          symbol: holding.asset.symbol,
          value: holding.currentValue,
        })),
        sectors: analytics.sectors,
        equityTotal: analytics.totals.equity,
        reviewDue: reviewDueDate(policyConfig.policy),
        stockConcentration: concentration,
      }),
    [
      analytics.allocationAnalysis,
      analytics.sectors,
      analytics.totals.equity,
      analytics.totals.portfolio,
      concentration,
      fundCoverage,
      policyConfig,
      policyEvaluation.unmanagedPercentage,
      summary.holdings,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          eyebrow="Policy monitoring"
          title="Compliance"
          subtitle="Explicit ranges, exceptions, exposure checks and sector policy"
          action={
            <IconButton
              icon="x"
              onPress={() => router.back()}
              accessibilityLabel="Close compliance"
            />
          }
        />

        {error ? (
          <Card>
            <ErrorState
              message={
                error instanceof Error
                  ? error.message
                  : 'Compliance could not be loaded.'
              }
              onRetry={refetch}
            />
          </Card>
        ) : isLoading ? (
          <Card>
            <Text style={[type.body, { color: '#71717A' }]}>Loading compliance…</Text>
          </Card>
        ) : (
          <ComplianceBody
            key={`${policyConfig.policy.id}:${policyConfig.policy.version}:${policyConfig.policy.updatedAt}`}
            config={policyConfig}
            report={report}
            sectors={analytics.sectors}
            equityTotal={analytics.totals.equity}
            isDemo={isDemo}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function ComplianceBody({
  config,
  report,
  sectors,
  equityTotal,
  isDemo,
}: {
  config: PolicyConfig;
  report: ComplianceReport;
  sectors: ExposureSlice[];
  equityTotal: number;
  isDemo: boolean;
}) {
  const { colors } = useTheme();
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const composition = useMemo(
    () =>
      validateComposition(config.targets, {
        allowUnallocated: config.policy.allowUnallocated ?? false,
      }),
    [config.policy.allowUnallocated, config.targets],
  );

  const status = STATUS_COPY[report.status];
  const rows = useMemo(() => {
    const order: Record<ComplianceSeverity, number> = {
      breach: 0,
      watch: 1,
      ok: 2,
    };
    return [...report.ranges]
      .filter((row) => !onlyExceptions || row.severity !== 'ok')
      .sort(
        (a, b) =>
          order[a.severity] - order[b.severity] ||
          a.path.localeCompare(b.path),
      );
  }, [onlyExceptions, report.ranges]);

  const unallocatedParents = Object.entries(composition.unallocatedByParent);

  return (
    <View style={styles.stack}>
      {isDemo ? (
        <Banner
          tone="warning"
          icon="play-circle"
          message="Sector policy is read-only in demo mode. Every other check still runs on demo data."
        />
      ) : null}

      {config.isTemplate ? (
        <Banner
          tone="warning"
          icon="alert-triangle"
          message="Compliance starts after the root sleeve targets are confirmed. Drafts can be prepared, but compliance and sector assumptions cannot be saved yet."
        />
      ) : !config.isValid ? (
        <Banner
          tone="warning"
          icon="alert-triangle"
          message="Root sleeve targets must total 100% before compliance assumptions can be saved. Fix them on the policy screen."
        />
      ) : null}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryText}>
            <Text style={[type.label, { color: colors.muted }]}>Overall status</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              {status.label}
            </Text>
          </View>
          <Badge label={status.label} tone={status.tone} />
        </View>
        <Text style={[type.caption, { color: colors.muted }]}>{status.detail}</Text>

        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Breaches</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.negative }]}>
              {report.breachCount}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Watches</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.warning }]}>
              {report.watchCount}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Root coverage</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {formatPercent(report.rangeCoveragePercentage)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Sector policy</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {report.sectorPolicyDefined
                ? formatPercent(report.sectorTargetSum)
                : 'None'}
            </Text>
          </View>
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          Policy v{config.policy.version} · {report.ranges.length} monitored{' '}
          {report.ranges.length === 1 ? 'node' : 'nodes'} ·{' '}
          {composition.parentCount} composition{' '}
          {composition.parentCount === 1 ? 'parent' : 'parents'}
        </Text>
      </Card>

      <View>
        <SectionHeader
          title="Policy ranges"
          subtitle="Roots and promoted nodes, measured as % of the total portfolio"
          actionLabel={onlyExceptions ? 'Show all' : 'Exceptions only'}
          onAction={() => setOnlyExceptions((value) => !value)}
        />

        {rows.length === 0 ? (
          <Card>
            <Text style={[type.caption, { color: colors.muted }]}>
              {onlyExceptions
                ? 'No range exceptions right now. Every monitored node is inside its explicit range.'
                : 'No monitored nodes yet. Confirm root targets and promote composition nodes in the sleeve editor.'}
            </Text>
          </Card>
        ) : (
          <View style={styles.rangeStack}>
            {rows.map((row) => (
              <Card key={row.path} style={styles.rangeCard}>
                <View style={styles.rangeHeader}>
                  <View
                    style={[
                      styles.rangeBar,
                      { backgroundColor: row.color },
                    ]}
                  />
                  <View style={styles.rangeTitle}>
                    <Text
                      style={[type.bodyMedium, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {row.path}
                    </Text>
                    <Text style={[type.caption, { color: colors.muted }]}>
                      Current {formatPercent(row.currentPercentage)} · target{' '}
                      {formatPercent(row.targetPercentage)} · range{' '}
                      {formatPercent(row.range.min)}–{formatPercent(row.range.max)}
                    </Text>
                    <Text style={[type.caption, { color: colors.muted }]}>
                      {formatCompactINR(row.currentValue)} · drift{' '}
                      {formatDriftPp(row.driftPp, { signed: true })}
                      {row.level === 'monitor' ? ' · monitor only' : ' · actionable'}
                    </Text>
                  </View>
                  <Badge
                    label={rangeStatusLabel(row)}
                    tone={severityTone(row.severity)}
                  />
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>

      <View>
        <SectionHeader
          title="Policy checks"
          subtitle="Cash floor, concentration, coverage, review and classification"
        />
        <Card style={styles.checkCard}>
          {report.checks.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              No checks are available until the portfolio has holdings.
            </Text>
          ) : (
            report.checks.map((check, index) => (
              <View
                key={check.id}
                style={[
                  styles.checkRow,
                  index > 0
                    ? { borderTopColor: colors.border }
                    : null,
                ]}
              >
                <View style={styles.checkText}>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>
                    {check.label}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {check.detail}
                  </Text>
                </View>
                <Badge
                  label={
                    check.severity === 'breach'
                      ? 'Breach'
                      : check.severity === 'watch'
                        ? 'Watch'
                        : 'OK'
                  }
                  tone={severityTone(check.severity)}
                />
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Explicit Unallocated"
          subtitle="Remainders carried deliberately inside a parent sleeve"
        />
        <Card style={styles.settingsCard}>
          <View style={styles.inlineRow}>
            <Text style={[type.body, { color: colors.textSecondary }]}>
              Remainder mode
            </Text>
            <Badge
              label={
                config.policy.allowUnallocated
                  ? 'Allowed'
                  : 'Require 100%'
              }
              tone={config.policy.allowUnallocated ? 'accent' : 'neutral'}
            />
          </View>
          {unallocatedParents.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              {composition.parentCount === 0
                ? 'No composition parents yet. Add sub-categories in the sleeve editor.'
                : 'Every parent with children is fully allocated.'}
            </Text>
          ) : (
            unallocatedParents.map(([parent, gap]) => (
              <View key={parent} style={styles.inlineRow}>
                <Text style={[type.caption, { color: colors.textSecondary }]}>
                  {parent}
                </Text>
                <Text style={[type.caption, numeric, { color: colors.warning }]}>
                  {formatPercent(gap)} unallocated
                </Text>
              </View>
            ))
          )}
          {Object.keys(composition.parentErrors).length > 0 ? (
            <Text style={[type.caption, { color: colors.negative }]}>
              {Object.values(composition.parentErrors)[0]}
            </Text>
          ) : null}
        </Card>
      </View>

      <SectorPolicyEditor
        config={config}
        sectors={sectors}
        equityTotal={equityTotal}
        isDemo={isDemo}
      />
    </View>
  );
}

function SectorPolicyEditor({
  config,
  sectors,
  equityTotal,
  isDemo,
}: {
  config: PolicyConfig;
  sectors: ExposureSlice[];
  equityTotal: number;
  isDemo: boolean;
}) {
  const { colors } = useTheme();
  const save = useSavePolicy();

  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const [name, value] of Object.entries(config.sectorTargets)) {
      next[name] = String(round2(value));
    }
    return next;
  });
  const [rangeInputs, setRangeInputs] = useState<
    Record<string, { min: string; max: string }>
  >(() => {
    const next: Record<string, { min: string; max: string }> = {};
    for (const [name, target] of Object.entries(config.sectorTargets)) {
      const range = config.sectorRanges[name];
      next[name] = {
        min: String(round2(range?.min ?? Math.max(0, target - 5))),
        max: String(round2(range?.max ?? Math.min(100, target + 5))),
      };
    }
    return next;
  });
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const sector of sectors) set.add(sector.name);
    for (const name of Object.keys(config.sectorTargets)) set.add(name);
    for (const name of customNames) set.add(name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [config.sectorTargets, customNames, sectors]);

  const currentBySector = useMemo(
    () =>
      new Map(sectors.map((sector) => [sector.name, sector.value] as const)),
    [sectors],
  );

  const parsed = useMemo(() => {
    const targets: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let sum = 0;

    for (const name of names) {
      const raw = (inputs[name] ?? '').trim();
      if (raw === '') {
        targets[name] = 0;
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        errors[name] = 'Enter a number';
        continue;
      }
      if (value < 0 || value > 100) {
        errors[name] = 'Use 0–100';
        continue;
      }
      targets[name] = value;
      sum += value;
    }

    const ranges: Record<string, PolicyRange> = {};
    for (const name of names) {
      const target = targets[name] ?? 0;
      if (target <= 0) continue;
      const input = rangeInputs[name] ?? { min: '', max: '' };
      const minRaw = input.min.trim();
      const maxRaw = input.max.trim();
      if (minRaw === '' && maxRaw === '') {
        ranges[name] = {
          min: Math.max(0, target - 5),
          max: Math.min(100, target + 5),
        };
        continue;
      }
      if (minRaw === '' || maxRaw === '') {
        errors[`range:${name}`] = 'Enter both min and max';
        continue;
      }
      const min = Number(minRaw);
      const max = Number(maxRaw);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        errors[`range:${name}`] = 'Enter numbers';
        continue;
      }
      if (min < 0 || max > 100 || max < min) {
        errors[`range:${name}`] = 'Use 0–100 with max ≥ min';
        continue;
      }
      if (target < min || target > max) {
        errors[`range:${name}`] = 'Target is outside the range';
        continue;
      }
      ranges[name] = { min, max };
    }

    if (sum > 100.01) {
      errors.sum = `Sector targets total ${sum.toFixed(2)}%, above 100%`;
    }

    return {
      targets,
      ranges,
      sum: round2(sum),
      errors,
      positive: Object.fromEntries(
        Object.entries(targets).filter(([, value]) => value > 0),
      ) as Record<string, number>,
    };
  }, [inputs, names, rangeInputs]);

  const dirty = useMemo(() => {
    const savedKeys = Object.keys(config.sectorTargets).sort();
    const nextKeys = Object.keys(parsed.positive).sort();
    if (savedKeys.join('|') !== nextKeys.join('|')) return true;
    if (
      nextKeys.some(
        (name) =>
          round2(config.sectorTargets[name] ?? 0) !==
          round2(parsed.positive[name] ?? 0),
      )
    ) {
      return true;
    }
    for (const name of nextKeys) {
      const saved = config.sectorRanges[name];
      const next = parsed.ranges[name];
      if (!saved || !next) return true;
      if (round2(saved.min) !== round2(next.min) || round2(saved.max) !== round2(next.max)) {
        return true;
      }
    }
    return false;
  }, [config.sectorRanges, config.sectorTargets, parsed.positive, parsed.ranges]);

  const hasErrors = Object.keys(parsed.errors).length > 0;
  const blockedByPolicy = config.isTemplate || !config.isValid;
  const canSave =
    !isDemo && !blockedByPolicy && !hasErrors && dirty && !save.isPending;
  const saveLabel = isDemo
    ? 'Read-only in demo'
    : blockedByPolicy
      ? config.isTemplate
        ? 'Confirm root policy first'
        : 'Fix root targets first'
      : hasErrors
        ? 'Resolve sector inputs'
        : !dirty
          ? 'No sector changes'
          : Object.keys(parsed.positive).length === 0
            ? 'Clear sector policy'
            : save.isPending
              ? 'Saving sector policy…'
              : 'Save sector policy';

  const updateInput = (name: string, value: string) => {
    setInputs((current) => ({ ...current, [name]: value }));
  };

  const updateRange = (
    name: string,
    patch: Partial<{ min: string; max: string }>,
  ) => {
    setRangeInputs((current) => ({
      ...current,
      [name]: {
        min: patch.min ?? current[name]?.min ?? '',
        max: patch.max ?? current[name]?.max ?? '',
      },
    }));
  };

  const addSector = () => {
    const name = newName.trim();
    if (!name) {
      setAddError('Enter a sector name.');
      return;
    }
    if (names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setAddError('That sector already has a row.');
      return;
    }
    setCustomNames((current) => [...current, name]);
    setInputs((current) => ({ ...current, [name]: '' }));
    setRangeInputs((current) => ({
      ...current,
      [name]: { min: '', max: '' },
    }));
    setNewName('');
    setAddError(null);
  };

  const clearAll = () => {
    setInputs({});
    setRangeInputs({});
  };

  const submit = () => {
    if (!canSave) return;
    save.mutate({
      targets: config.policy.targets,
      bands: config.bands,
      reviewCadence: config.policy.reviewCadence,
      ranges: config.policy.ranges,
      decisionLevels: config.policy.decisionLevels,
      benchmarks: config.policy.benchmarks,
      sectorTargets: parsed.positive,
      sectorRanges: parsed.ranges,
      riskBudget: config.policy.riskBudget,
      riskModel: config.policy.riskModel,
      currencyPolicy: config.policy.currencyPolicy,
      liquidityPolicy: config.policy.liquidityPolicy,
      allowUnallocated: config.policy.allowUnallocated,
      notes: config.policy.notes,
      approvedBy: config.policy.approvedBy,
      changeNote: 'Sector policy update',
    });
  };

  return (
    <View>
      <SectionHeader
        title="Sector policy"
        subtitle="Separate equity lens, expressed as % of equity exposure"
        actionLabel="Clear"
        onAction={isDemo ? undefined : clearAll}
      />

      {save.isError ? (
        <Banner
          tone="error"
          icon="alert-circle"
          message={
            save.error instanceof Error
              ? save.error.message
              : 'The sector policy could not be saved.'
          }
        />
      ) : null}

      <Card style={styles.settingsCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryText}>
            <Text style={[type.label, { color: colors.muted }]}>Sector target total</Text>
            <Text
              style={[
                styles.sectorTotal,
                numeric,
                {
                  color:
                    parsed.errors.sum != null
                      ? colors.negative
                      : Math.abs(parsed.sum - 100) <= 0.01
                        ? colors.positive
                        : colors.warning,
                },
              ]}
            >
              {formatPercent(parsed.sum)}
            </Text>
          </View>
          <Badge
            label={
              parsed.errors.sum != null
                ? 'Over 100%'
                : Math.abs(parsed.sum - 100) <= 0.01
                  ? 'Fully allocated'
                  : `${formatPercent(Math.max(0, 100 - parsed.sum))} unallocated`
            }
            tone={
              parsed.errors.sum != null
                ? 'negative'
                : Math.abs(parsed.sum - 100) <= 0.01
                  ? 'positive'
                  : 'warning'
            }
          />
        </View>
        <Text style={[type.caption, { color: colors.muted }]}>
          Equity exposure {formatCompactINR(equityTotal)}. A remainder below 100% is
          explicit and never spread across untargeted sectors.
        </Text>

        {names.length === 0 ? (
          <Text style={[type.caption, { color: colors.muted }]}>
            No sectors detected yet. Add a sector manually to build the policy.
          </Text>
        ) : (
          <View style={styles.sectorStack}>
            {names.map((name) => {
              const currentValue = currentBySector.get(name) ?? 0;
              const currentPct =
                equityTotal > 0 ? (currentValue / equityTotal) * 100 : 0;
              const target = parsed.targets[name] ?? 0;
              const rowError =
                parsed.errors[name] ?? parsed.errors[`range:${name}`];
              const effectiveRange =
                target > 0
                  ? (parsed.ranges[name] ?? {
                      min: Math.max(0, target - 5),
                      max: Math.min(100, target + 5),
                    })
                  : null;
              const rangeStatus = effectiveRange
                ? rangeStatusFor(currentPct, effectiveRange)
                : null;

              return (
                <View
                  key={name}
                  style={[styles.sectorRow, { borderColor: colors.border }]}
                >
                  <View style={styles.sectorHeader}>
                    <View style={styles.sectorTitle}>
                      <Text style={[type.bodyMedium, { color: colors.text }]}>
                        {name}
                      </Text>
                      <Text style={[type.caption, { color: colors.muted }]}>
                        Current {formatPercent(currentPct)} · target{' '}
                        {formatPercent(target)} · {formatCompactINR(currentValue)}
                      </Text>
                    </View>
                    <Badge
                      label={sectorStatusLabel(rangeStatus ?? 'untargeted')}
                      tone={
                        rangeStatus
                          ? severityTone(severityForRange(rangeStatus))
                          : 'neutral'
                      }
                    />
                  </View>

                  <View style={styles.sectorInputs}>
                    <View style={styles.inputGrow}>
                      <TextField
                        label="Target % of equity"
                        value={inputs[name] ?? ''}
                        onChangeText={(value) => updateInput(name, value)}
                        placeholder="0"
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        selectTextOnFocus
                        editable={!isDemo}
                        error={rowError && !rowError.includes('outside') ? rowError : undefined}
                      />
                    </View>
                    {target > 0 ? (
                      <>
                        <View style={styles.inputHalf}>
                          <TextField
                            label="Min %"
                            value={rangeInputs[name]?.min ?? ''}
                            onChangeText={(value) =>
                              updateRange(name, { min: value })
                            }
                            keyboardType="decimal-pad"
                            inputMode="decimal"
                            selectTextOnFocus
                            editable={!isDemo}
                          />
                        </View>
                        <View style={styles.inputHalf}>
                          <TextField
                            label="Max %"
                            value={rangeInputs[name]?.max ?? ''}
                            onChangeText={(value) =>
                              updateRange(name, { max: value })
                            }
                            keyboardType="decimal-pad"
                            inputMode="decimal"
                            selectTextOnFocus
                            editable={!isDemo}
                          />
                        </View>
                      </>
                    ) : null}
                  </View>

                  {rowError ? (
                    <Text style={[type.caption, { color: colors.negative }]}>
                      {rowError}
                    </Text>
                  ) : target > 0 ? (
                    <Text style={[type.caption, { color: colors.muted }]}>
                      Policy range {formatPercent(parsed.ranges[name]?.min ?? 0)}–
                      {formatPercent(parsed.ranges[name]?.max ?? 0)} of equity.
                      Blank range defaults to ±5 pp.
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <View style={[styles.addSector, { borderTopColor: colors.border }]}>
          <TextField
            label="Add sector"
            placeholder="e.g. Financials"
            value={newName}
            onChangeText={(value) => {
              setNewName(value);
              setAddError(null);
            }}
            autoCapitalize="words"
            editable={!isDemo}
            error={addError ?? undefined}
          />
          <Button
            label="Add row"
            onPress={addSector}
            variant="secondary"
            size="sm"
            icon="plus"
            disabled={isDemo}
          />
        </View>

        {save.isSuccess ? (
          <Text style={[type.caption, { color: colors.positive }]}>
            Sector policy saved as a new policy version.
          </Text>
        ) : null}

        <Button
          label={saveLabel}
          onPress={submit}
          disabled={!canSave}
          loading={save.isPending}
          icon="save"
          fullWidth
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.xl },
  summaryCard: { gap: space.md },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
  },
  summaryText: { flex: 1, gap: 2 },
  summaryValue: { fontSize: 26, fontWeight: '600', letterSpacing: -0.4 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  metric: { flexBasis: '42%', flexGrow: 1, gap: 2 },
  metricValue: { fontSize: 18, fontWeight: '600' },
  rangeStack: { gap: space.sm },
  rangeCard: { padding: space.md },
  rangeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  rangeBar: { width: 4, alignSelf: 'stretch', borderRadius: radius.full },
  rangeTitle: { flex: 1, gap: 2 },
  checkCard: { gap: 0 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  checkText: { flex: 1, gap: 2 },
  settingsCard: { gap: space.md },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  sectorTotal: { fontSize: 22, fontWeight: '600' },
  sectorStack: { gap: space.md },
  sectorRow: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  sectorHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  sectorTitle: { flex: 1, gap: 2 },
  sectorInputs: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  inputGrow: { flex: 1.4 },
  inputHalf: { flex: 1 },
  addSector: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
});
