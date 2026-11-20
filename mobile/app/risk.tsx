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
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { TextField } from '@/src/components/ui/TextField';
import { ErrorState } from '@/src/components/ui/States';
import { DEFAULT_USD_TO_INR } from '@/src/features/portfolio/aggregate';
import {
  currencyExposure,
  holdingExposure,
  liquidPercentage,
  liquidityExposure,
  type ExposureBucket,
  type HoldingExposure,
} from '@/src/features/portfolio/exposure';
import type { PolicyConfig } from '@/src/features/portfolio/policy';
import type { PolicyRiskModel } from '@/src/features/portfolio/types';
import { usePortfolioData, useSavePolicy } from '@/src/features/portfolio/queries';
import {
  computeRiskBudget,
  type RiskBudgetReport,
  type RiskBudgetStatus,
} from '@/src/features/portfolio/risk';
import {
  STRESS_SCENARIOS,
  runScenario,
  type ScenarioResult,
} from '@/src/features/portfolio/scenario';
import {
  formatCompactINR,
  formatPercent,
  formatSignedINR,
} from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const round2 = (value: number) => Math.round(value * 100) / 100;

const BUDGET_TONE: Record<RiskBudgetStatus, BadgeTone> = {
  breach: 'negative',
  watch: 'warning',
  within: 'positive',
  unbudgeted: 'neutral',
};

const BUDGET_LABEL: Record<RiskBudgetStatus, string> = {
  breach: 'Off budget',
  watch: 'Watch',
  within: 'Within',
  unbudgeted: 'No budget',
};

interface RiskSleeve {
  path: string;
  label: string;
  value: number;
}

function riskTone(status: RiskBudgetReport['status']): BadgeTone {
  if (status === 'breach') return 'negative';
  if (status === 'watch') return 'warning';
  return 'positive';
}

export default function RiskScreen() {
  const router = useRouter();
  const {
    policyConfig,
    policyEvaluation,
    savedAssets,
    prices,
    isLoading,
    error,
    isDemo,
    refetch,
  } = usePortfolioData();

  const usdToInr = prices['INR=X']?.regularMarketPrice ?? DEFAULT_USD_TO_INR;

  const sleeves = useMemo<RiskSleeve[]>(
    () =>
      [
        ...policyEvaluation.sleeves.map((sleeve) => ({
          path: sleeve.path,
          label: sleeve.label,
          value: sleeve.currentValue,
        })),
        ...policyEvaluation.unmanaged.map((slice) => ({
          path: slice.path,
          label: slice.label,
          value: slice.currentValue,
        })),
      ].filter((sleeve) => sleeve.value > 0),
    [policyEvaluation.sleeves, policyEvaluation.unmanaged],
  );

  const holdings = useMemo(
    () => holdingExposure(savedAssets, prices, usdToInr),
    [prices, savedAssets, usdToInr],
  );

  const currencyBuckets = useMemo(() => currencyExposure(holdings), [holdings]);
  const liquidityBuckets = useMemo(() => liquidityExposure(holdings), [holdings]);
  const liquidPct = useMemo(() => liquidPercentage(holdings), [holdings]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          eyebrow="Institutional risk"
          title="Risk & liquidity"
          subtitle="Risk budget, stress scenarios, currency and liquidity exposure"
          action={
            <IconButton
              icon="x"
              onPress={() => router.back()}
              accessibilityLabel="Close risk and liquidity"
            />
          }
        />

        {error ? (
          <Card>
            <ErrorState
              message={
                error instanceof Error
                  ? error.message
                  : 'Risk analytics could not be loaded.'
              }
              onRetry={refetch}
            />
          </Card>
        ) : isLoading ? (
          <Card>
            <Text style={[type.body, { color: '#71717A' }]}>Loading risk analytics…</Text>
          </Card>
        ) : (
          <RiskBody
            key={`${policyConfig.policy.id}:${policyConfig.policy.version}:${policyConfig.policy.updatedAt}`}
            config={policyConfig}
            sleeves={sleeves}
            holdings={holdings}
            currencyBuckets={currencyBuckets}
            liquidityBuckets={liquidityBuckets}
            liquidPct={liquidPct}
            isDemo={isDemo}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function RiskBody({
  config,
  sleeves,
  holdings,
  currencyBuckets,
  liquidityBuckets,
  liquidPct,
  isDemo,
}: {
  config: PolicyConfig;
  sleeves: RiskSleeve[];
  holdings: HoldingExposure[];
  currencyBuckets: ExposureBucket[];
  liquidityBuckets: ExposureBucket[];
  liquidPct: number;
  isDemo: boolean;
}) {
  const { colors } = useTheme();
  const save = useSavePolicy();

  const [volInputs, setVolInputs] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const sleeve of sleeves) {
      next[sleeve.path] = String(
        round2(config.riskModel.volatility[sleeve.path] ?? 12),
      );
    }
    return next;
  });
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const sleeve of sleeves) {
      const stored = config.riskBudget[sleeve.path];
      next[sleeve.path] = stored != null ? String(round2(stored)) : '';
    }
    return next;
  });
  const [correlationInput, setCorrelationInput] = useState(
    String(round2(config.riskModel.correlation)),
  );
  const [minLiquidInput, setMinLiquidInput] = useState(
    String(round2(config.liquidityPolicy.minLiquidPct)),
  );
  const [hedgeInputs, setHedgeInputs] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const bucket of currencyBuckets) {
      const stored = config.currencyPolicy.hedgeTargets?.[bucket.key];
      next[bucket.key] = stored != null ? String(round2(stored)) : '';
    }
    return next;
  });
  const [scenarioId, setScenarioId] = useState(STRESS_SCENARIOS[0].id);

  const parsedVol = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const sleeve of sleeves) {
      const raw = (volInputs[sleeve.path] ?? '').trim();
      const fallback = config.riskModel.volatility[sleeve.path] ?? 12;
      if (raw === '') {
        values[sleeve.path] = fallback;
        errors[sleeve.path] = 'Required';
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        values[sleeve.path] = fallback;
        errors[sleeve.path] = 'Enter a number';
        continue;
      }
      if (value < 0 || value > 150) {
        values[sleeve.path] = fallback;
        errors[sleeve.path] = 'Use 0–150';
        continue;
      }
      values[sleeve.path] = value;
    }
    return { values, errors };
  }, [config.riskModel.volatility, sleeves, volInputs]);

  const parsedBudget = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: Record<string, string> = {};
    let sum = 0;
    for (const sleeve of sleeves) {
      const raw = (budgetInputs[sleeve.path] ?? '').trim();
      if (raw === '') {
        values[sleeve.path] = 0;
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        errors[sleeve.path] = 'Enter a number';
        continue;
      }
      if (value < 0 || value > 100) {
        errors[sleeve.path] = 'Use 0–100';
        continue;
      }
      values[sleeve.path] = value;
      sum += value;
    }
    if (sum > 100.01) {
      errors.sum = `Risk budgets total ${sum.toFixed(2)}%, above 100%`;
    }
    return {
      values,
      errors,
      sum: round2(sum),
      positive: Object.fromEntries(
        Object.entries(values).filter(([, value]) => value > 0),
      ) as Record<string, number>,
    };
  }, [budgetInputs, sleeves]);

  const parsedCorrelation = useMemo(() => {
    const raw = correlationInput.trim();
    const value = Number(raw);
    if (raw === '') return { value: config.riskModel.correlation, error: 'Required' };
    if (!Number.isFinite(value) || value < -1 || value > 1) {
      return { value: config.riskModel.correlation, error: 'Use −1 to 1' };
    }
    return { value, error: null as string | null };
  }, [config.riskModel.correlation, correlationInput]);

  const parsedMinLiquid = useMemo(() => {
    const raw = minLiquidInput.trim();
    const value = Number(raw);
    if (raw === '') return { value: config.liquidityPolicy.minLiquidPct, error: 'Required' };
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { value: config.liquidityPolicy.minLiquidPct, error: 'Use 0–100' };
    }
    return { value, error: null as string | null };
  }, [config.liquidityPolicy.minLiquidPct, minLiquidInput]);

  const parsedHedges = useMemo(() => {
    const values: Record<string, number> = {};
    const errors: Record<string, string> = {};
    for (const bucket of currencyBuckets) {
      const raw = (hedgeInputs[bucket.key] ?? '').trim();
      if (raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        errors[bucket.key] = 'Enter a number';
        continue;
      }
      if (value < 0 || value > 100) {
        errors[bucket.key] = 'Use 0–100';
        continue;
      }
      if (value > 0) values[bucket.key] = value;
    }
    return { values, errors };
  }, [currencyBuckets, hedgeInputs]);

  const effectiveVolatility = useMemo(() => {
    const next = { ...config.riskModel.volatility };
    for (const sleeve of sleeves) delete next[sleeve.path];
    return { ...next, ...parsedVol.values };
  }, [config.riskModel.volatility, parsedVol.values, sleeves]);

  const riskModel = useMemo<PolicyRiskModel>(
    () => ({
      volatility: effectiveVolatility,
      correlation: parsedCorrelation.value,
      correlations: config.riskModel.correlations,
    }),
    [config.riskModel.correlations, effectiveVolatility, parsedCorrelation.value],
  );

  const totalValue = useMemo(
    () => sleeves.reduce((sum, sleeve) => sum + sleeve.value, 0),
    [sleeves],
  );

  const risk = useMemo(
    () =>
      computeRiskBudget({
        sleeves,
        model: riskModel,
        budget: parsedBudget.positive,
        totalValue,
      }),
    [parsedBudget.positive, riskModel, sleeves, totalValue],
  );

  const selectedScenario =
    STRESS_SCENARIOS.find((scenario) => scenario.id === scenarioId) ??
    STRESS_SCENARIOS[0];

  const usdValue = holdings
    .filter((holding) => holding.currency === 'USD')
    .reduce((sum, holding) => sum + holding.value, 0);

  const scenario = useMemo<ScenarioResult>(
    () =>
      runScenario({
        sleeves,
        scenario: selectedScenario,
        ranges: config.ranges,
        usdValue,
      }),
    [config.ranges, selectedScenario, sleeves, usdValue],
  );

  const dirty = useMemo(() => {
    for (const sleeve of sleeves) {
      if (
        round2(parsedVol.values[sleeve.path] ?? 0) !==
        round2(config.riskModel.volatility[sleeve.path] ?? 12)
      ) {
        return true;
      }
      if (
        round2(parsedBudget.values[sleeve.path] ?? 0) !==
        round2(config.riskBudget[sleeve.path] ?? 0)
      ) {
        return true;
      }
    }
    if (round2(parsedCorrelation.value) !== round2(config.riskModel.correlation)) {
      return true;
    }
    if (round2(parsedMinLiquid.value) !== round2(config.liquidityPolicy.minLiquidPct)) {
      return true;
    }
    const savedHedges = config.currencyPolicy.hedgeTargets ?? {};
    const keys = new Set([
      ...Object.keys(savedHedges),
      ...Object.keys(parsedHedges.values),
    ]);
    for (const key of keys) {
      if (round2(savedHedges[key] ?? 0) !== round2(parsedHedges.values[key] ?? 0)) {
        return true;
      }
    }
    return false;
  }, [
    config.currencyPolicy.hedgeTargets,
    config.liquidityPolicy.minLiquidPct,
    config.riskBudget,
    config.riskModel.correlation,
    config.riskModel.volatility,
    parsedBudget.values,
    parsedCorrelation.value,
    parsedHedges.values,
    parsedMinLiquid.value,
    parsedVol.values,
    sleeves,
  ]);

  const hasErrors =
    Object.keys(parsedVol.errors).length > 0 ||
    Object.keys(parsedBudget.errors).length > 0 ||
    Object.keys(parsedHedges.errors).length > 0 ||
    parsedCorrelation.error != null ||
    parsedMinLiquid.error != null;

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
        ? 'Resolve assumption inputs'
        : !dirty
          ? 'No assumption changes'
          : save.isPending
            ? 'Saving assumptions…'
            : 'Save risk assumptions';

  const submit = () => {
    if (!canSave) return;

    // Preserve budgets and hedge intents for sleeves or currencies that are not
    // currently held; only the visible rows may overwrite their own values.
    const nextRiskBudget = { ...config.riskBudget };
    for (const sleeve of sleeves) delete nextRiskBudget[sleeve.path];
    Object.assign(nextRiskBudget, parsedBudget.positive);

    const nextHedges = { ...(config.currencyPolicy.hedgeTargets ?? {}) };
    for (const bucket of currencyBuckets) delete nextHedges[bucket.key];
    Object.assign(nextHedges, parsedHedges.values);

    save.mutate({
      targets: config.policy.targets,
      bands: config.bands,
      reviewCadence: config.policy.reviewCadence,
      ranges: config.policy.ranges,
      decisionLevels: config.policy.decisionLevels,
      benchmarks: config.policy.benchmarks,
      sectorTargets: config.policy.sectorTargets,
      sectorRanges: config.policy.sectorRanges,
      riskBudget: nextRiskBudget,
      riskModel,
      currencyPolicy: {
        baseCurrency: 'INR',
        hedgeTargets: nextHedges,
      },
      liquidityPolicy: { minLiquidPct: parsedMinLiquid.value },
      allowUnallocated: config.policy.allowUnallocated,
      notes: config.policy.notes,
      approvedBy: config.policy.approvedBy,
      changeNote: 'Risk and liquidity assumptions update',
    });
  };

  const liquidStatus =
    liquidPct + 0.01 < parsedMinLiquid.value
      ? 'breach'
      : liquidPct < parsedMinLiquid.value + 5
        ? 'watch'
        : 'ok';

  return (
    <View style={styles.stack}>
      {isDemo ? (
        <Banner
          tone="warning"
          icon="play-circle"
          message="Risk assumptions are read-only in demo mode. Scenarios and exposures still run on demo data."
        />
      ) : null}

      {config.isTemplate || !config.isValid ? (
        <Banner
          tone="warning"
          icon="alert-triangle"
          message={
            config.isTemplate
              ? 'Confirm the root policy before saving risk assumptions. Scenarios and exposures still run on the current data.'
              : 'Root sleeve targets must total 100% before risk assumptions can be saved. Fix them on the policy screen.'
          }
        />
      ) : null}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryText}>
            <Text style={[type.label, { color: colors.muted }]}>
              Estimated portfolio volatility
            </Text>
            <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
              {formatPercent(risk.portfolioVolatilityPct)}
            </Text>
          </View>
          <Badge
            label={
              risk.status === 'breach'
                ? 'Off budget'
                : risk.status === 'watch'
                  ? 'Watch'
                  : 'Within budget'
            }
            tone={riskTone(risk.status)}
          />
        </View>
        <Text style={[type.caption, { color: colors.muted }]}>
          Annualised assumption, not a forecast. Diversification benefit{' '}
          {formatPercent(risk.diversificationBenefitPp)} vs the weighted average.
          {risk.topRiskPath
            ? ` Largest risk contributor: ${risk.topRiskPath} at ${formatPercent(
                risk.topRiskPct,
              )}.`
            : ''}
        </Text>
        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Risk budget used</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {formatPercent(risk.budgetTotal)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Off-budget sleeves</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {risk.breachCount}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Stress breaches</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {scenario.breaches}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Liquid assets</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {formatPercent(liquidPct)}
            </Text>
          </View>
        </View>
      </Card>

      {save.isError ? (
        <Banner
          tone="error"
          icon="alert-circle"
          message={
            save.error instanceof Error
              ? save.error.message
              : 'The risk assumptions could not be saved.'
          }
        />
      ) : null}

      <View>
        <SectionHeader
          title="Risk budget"
          subtitle="Estimated contribution to portfolio volatility, not capital weight"
        />
        <Card style={styles.settingsCard}>
          <View style={styles.assumptionRow}>
            <View style={styles.inputGrow}>
              <TextField
                label="Default correlation"
                value={correlationInput}
                onChangeText={setCorrelationInput}
                keyboardType="numbers-and-punctuation"
                inputMode="decimal"
                selectTextOnFocus
                editable={!isDemo}
                error={parsedCorrelation.error ?? undefined}
                hint="−1 to 1. Cash is always treated as uncorrelated."
              />
            </View>
            <View style={styles.inputGrow}>
              <TextField
                label="Minimum liquid %"
                value={minLiquidInput}
                onChangeText={setMinLiquidInput}
                keyboardType="decimal-pad"
                inputMode="decimal"
                selectTextOnFocus
                editable={!isDemo}
                error={parsedMinLiquid.error ?? undefined}
                hint="Daily + weekly assets."
              />
            </View>
          </View>

          {risk.rows.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              Add valued holdings to see risk contributions.
            </Text>
          ) : (
            <View style={styles.budgetStack}>
              {risk.rows.map((row) => {
                const volError = parsedVol.errors[row.path];
                const budgetError = parsedBudget.errors[row.path];
                return (
                  <View
                    key={row.path}
                    style={[styles.budgetRow, { borderColor: colors.border }]}
                  >
                    <View style={styles.budgetHeader}>
                      <View style={styles.budgetTitle}>
                        <Text
                          style={[type.bodyMedium, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {row.path}
                        </Text>
                        <Text style={[type.caption, { color: colors.muted }]}>
                          Weight {formatPercent(row.weightPct)} · volatility{' '}
                          {formatPercent(row.volatilityPct)} · risk{' '}
                          {formatPercent(row.contributionPct)}
                        </Text>
                      </View>
                      <Badge
                        label={BUDGET_LABEL[row.status]}
                        tone={BUDGET_TONE[row.status]}
                      />
                    </View>

                    <View style={styles.assumptionRow}>
                      <View style={styles.inputGrow}>
                        <TextField
                          label="Volatility %"
                          value={volInputs[row.path] ?? ''}
                          onChangeText={(value) =>
                            setVolInputs((current) => ({
                              ...current,
                              [row.path]: value,
                            }))
                          }
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                          selectTextOnFocus
                          editable={!isDemo}
                          error={volError}
                        />
                      </View>
                      <View style={styles.inputGrow}>
                        <TextField
                          label="Risk budget %"
                          value={budgetInputs[row.path] ?? ''}
                          onChangeText={(value) =>
                            setBudgetInputs((current) => ({
                              ...current,
                              [row.path]: value,
                            }))
                          }
                          placeholder="—"
                          keyboardType="decimal-pad"
                          inputMode="decimal"
                          selectTextOnFocus
                          editable={!isDemo}
                          error={budgetError}
                          hint={
                            row.budgetPct == null
                              ? 'No budget set'
                              : `Gap ${formatPercent(row.gapPp ?? 0, {
                                  signed: true,
                                })}`
                          }
                        />
                      </View>
                    </View>

                    <View
                      style={[styles.barTrack, { backgroundColor: colors.cardMuted }]}
                    >
                      <View
                        style={[
                          styles.barFill,
                          {
                            flex: Math.max(0.01, row.contributionPct),
                            backgroundColor:
                              row.status === 'breach'
                                ? colors.negative
                                : row.status === 'watch'
                                  ? colors.warning
                                  : colors.accent,
                          },
                        ]}
                      />
                      <View
                        style={{
                          flex: Math.max(0.01, 100 - row.contributionPct),
                        }}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={[styles.inlineRow, { borderTopColor: colors.border }]}>
            <Text style={[type.caption, { color: colors.muted }]}>
              Budget total {formatPercent(parsedBudget.sum)}
            </Text>
            <Text
              style={[
                type.caption,
                {
                  color:
                    parsedBudget.errors.sum != null
                      ? colors.negative
                      : Math.abs(parsedBudget.sum - 100) <= 0.01
                        ? colors.positive
                        : colors.warning,
                },
              ]}
            >
              {parsedBudget.errors.sum ??
                (Math.abs(parsedBudget.sum - 100) <= 0.01
                  ? 'Fully budgeted'
                  : `${formatPercent(Math.max(0, 100 - parsedBudget.sum))} unbudgeted`)}
            </Text>
          </View>
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Stress scenarios"
          subtitle="Deterministic sleeve shocks with an explicit FX approximation"
        />
        <View style={styles.chips}>
          {STRESS_SCENARIOS.map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={scenarioId === item.id}
              onPress={() => setScenarioId(item.id)}
            />
          ))}
        </View>

        <Card style={styles.scenarioCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryText}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>
                {scenario.scenario.name}
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {scenario.scenario.description}
              </Text>
            </View>
            <Badge
              label={
                scenario.breaches > 0
                  ? `${scenario.breaches} range ${scenario.breaches === 1 ? 'breach' : 'breaches'}`
                  : 'No range breach'
              }
              tone={scenario.breaches > 0 ? 'negative' : 'positive'}
            />
          </View>

          <View style={styles.metricRow}>
            <View style={styles.metric}>
              <Text style={[type.label, { color: colors.muted }]}>Current</Text>
              <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
                {formatCompactINR(scenario.currentTotal)}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={[type.label, { color: colors.muted }]}>Projected</Text>
              <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
                {formatCompactINR(scenario.projectedTotal)}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={[type.label, { color: colors.muted }]}>Change</Text>
              <Text
                style={[
                  styles.metricValue,
                  numeric,
                  {
                    color:
                      scenario.changeValue >= 0 ? colors.positive : colors.negative,
                  },
                ]}
              >
                {formatSignedINR(scenario.changeValue)}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={[type.label, { color: colors.muted }]}>Change %</Text>
              <Text
                style={[
                  styles.metricValue,
                  numeric,
                  {
                    color:
                      scenario.changePct >= 0 ? colors.positive : colors.negative,
                  },
                ]}
              >
                {formatPercent(scenario.changePct, { signed: true })}
              </Text>
            </View>
          </View>

          <View style={styles.scenarioRows}>
            {scenario.rows.map((row) => (
              <View
                key={row.path}
                style={[styles.scenarioRow, { borderTopColor: colors.border }]}
              >
                <View style={styles.scenarioText}>
                  <Text style={[type.caption, { color: colors.textSecondary }]}>
                    {row.path}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {formatPercent(row.currentPercentage)} →{' '}
                    {formatPercent(row.projectedPercentage)}
                  </Text>
                </View>
                <Text
                  style={[
                    type.caption,
                    numeric,
                    {
                      color:
                        row.changeValue >= 0 ? colors.positive : colors.negative,
                    },
                  ]}
                >
                  {formatSignedINR(row.changeValue)}
                </Text>
                {row.breach ? (
                  <Badge
                    label={row.breach === 'below' ? 'Below range' : 'Above range'}
                    tone="negative"
                  />
                ) : (
                  <Badge label="In range" tone="positive" />
                )}
              </View>
            ))}
          </View>

          <Text style={[type.caption, { color: colors.muted }]}>
            FX shocks are translated pro-rata across sleeves because the app does not
            store a historical currency split. Treat that line as an approximation.
          </Text>
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Currency exposure"
          subtitle="Share of portfolio value by quote currency"
        />
        <Card style={styles.settingsCard}>
          {currencyBuckets.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              No valued holdings to classify.
            </Text>
          ) : (
            currencyBuckets.map((bucket) => (
              <View key={bucket.key} style={styles.bucketRow}>
                <View style={styles.bucketHeader}>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>
                    {bucket.key}
                  </Text>
                  <Text style={[type.caption, numeric, { color: colors.muted }]}>
                    {formatPercent(bucket.percentage)} ·{' '}
                    {formatCompactINR(bucket.value)}
                  </Text>
                </View>
                <View
                  style={[styles.barTrack, { backgroundColor: colors.cardMuted }]}
                >
                  <View
                    style={[
                      styles.barFill,
                      {
                        flex: Math.max(0.01, bucket.percentage),
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                  <View style={{ flex: Math.max(0.01, 100 - bucket.percentage) }} />
                </View>
                <View style={styles.hedgeRow}>
                  <View style={styles.inputGrow}>
                    <TextField
                      label={`${bucket.key} hedge target %`}
                      value={hedgeInputs[bucket.key] ?? ''}
                      onChangeText={(value) =>
                        setHedgeInputs((current) => ({
                          ...current,
                          [bucket.key]: value,
                        }))
                      }
                      placeholder="0"
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      selectTextOnFocus
                      editable={!isDemo}
                      error={parsedHedges.errors[bucket.key]}
                      hint="Intended hedged share, not a trade instruction."
                    />
                  </View>
                </View>
              </View>
            ))
          )}
          <Text style={[type.caption, { color: colors.muted }]}>
            Base currency INR. Currency policy records intent only; no hedge trades are
            generated.
          </Text>
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Liquidity"
          subtitle="Daily and weekly assets count toward the liquidity floor"
        />
        <Card style={styles.settingsCard}>
          <View style={styles.summaryHeader}>
            <View style={styles.summaryText}>
              <Text style={[type.label, { color: colors.muted }]}>Liquid share</Text>
              <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
                {formatPercent(liquidPct)}
              </Text>
            </View>
            <Badge
              label={
                liquidStatus === 'breach'
                  ? 'Below floor'
                  : liquidStatus === 'watch'
                    ? 'Near floor'
                    : 'Above floor'
              }
              tone={
                liquidStatus === 'breach'
                  ? 'negative'
                  : liquidStatus === 'watch'
                    ? 'warning'
                    : 'positive'
              }
            />
          </View>
          <Text style={[type.caption, { color: colors.muted }]}>
            Policy floor {formatPercent(parsedMinLiquid.value)} of the portfolio.
          </Text>

          {liquidityBuckets.map((bucket) => (
            <View key={bucket.key} style={styles.bucketRow}>
              <View style={styles.bucketHeader}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>
                  {bucket.key}
                </Text>
                <Text style={[type.caption, numeric, { color: colors.muted }]}>
                  {formatPercent(bucket.percentage)} · {formatCompactINR(bucket.value)}
                </Text>
              </View>
              <View
                style={[styles.barTrack, { backgroundColor: colors.cardMuted }]}
              >
                <View
                  style={[
                    styles.barFill,
                    {
                      flex: Math.max(0.01, bucket.percentage),
                      backgroundColor:
                        bucket.key === 'Daily' || bucket.key === 'Weekly'
                          ? colors.positive
                          : bucket.key === 'Illiquid'
                            ? colors.negative
                            : colors.warning,
                    },
                  ]}
                />
                <View style={{ flex: Math.max(0.01, 100 - bucket.percentage) }} />
              </View>
            </View>
          ))}

          {holdings.length > 0 ? (
            <View style={[styles.holdingsBlock, { borderTopColor: colors.border }]}>
              <Text style={[type.label, { color: colors.muted }]}>Largest holdings</Text>
              {holdings.slice(0, 5).map((holding) => (
                <View key={holding.id} style={styles.inlineRow}>
                  <Text
                    style={[type.caption, { color: colors.textSecondary, flex: 1 }]}
                    numberOfLines={1}
                  >
                    {holding.name}
                  </Text>
                  <Text style={[type.caption, numeric, { color: colors.muted }]}>
                    {formatPercent(holding.percentage)} · {holding.liquidity}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </View>

      <Card style={styles.footerCard}>
        <Text style={[type.bodyMedium, { color: colors.text }]}>
          How the model works
        </Text>
        <Text style={[type.caption, { color: colors.muted }]}>
          Risk contribution uses a transparent covariance matrix built from your explicit
          volatility and correlation assumptions. It is a budgeting tool, not a
          value-at-risk guarantee. Scenarios are deterministic shocks, not forecasts.
        </Text>
      </Card>

      <View style={styles.saveBlock}>
        <Button
          label={saveLabel}
          onPress={submit}
          disabled={!canSave}
          loading={save.isPending}
          icon="save"
          fullWidth
          size="lg"
        />
        <Text style={[styles.saveHint, { color: colors.muted }]}>
          Saving records a new policy version. Allocation targets, bands, composition and
          sector policy are preserved.
        </Text>
      </View>
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
  metricValue: { fontSize: 17, fontWeight: '600' },
  settingsCard: { gap: space.md },
  assumptionRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  inputGrow: { flex: 1 },
  budgetStack: { gap: space.md },
  budgetRow: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  budgetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  budgetTitle: { flex: 1, gap: 2 },
  barTrack: {
    height: 6,
    borderRadius: radius.full,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: radius.full },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  scenarioCard: { gap: space.md },
  scenarioRows: { gap: space.sm },
  scenarioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  scenarioText: { flex: 1, gap: 2 },
  bucketRow: { gap: space.xs },
  bucketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  hedgeRow: { flexDirection: 'row', gap: space.sm },
  holdingsBlock: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
  footerCard: { gap: space.sm },
  saveBlock: { gap: space.md },
  saveHint: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
