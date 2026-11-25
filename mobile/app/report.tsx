import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Share,
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
import { ErrorState } from '@/src/components/ui/States';
import type { Holding } from '@/src/features/portfolio/aggregate';
import type { AllocationNode } from '@/src/features/portfolio/analytics';
import {
  accountSummary,
  buildContributionReport,
  type AccountRow,
  type ContributionReport,
} from '@/src/features/portfolio/attribution';
import { validateComposition } from '@/src/features/portfolio/breakdown';
import {
  evaluateCompliance,
  type ComplianceReport,
} from '@/src/features/portfolio/compliance';
import {
  analyzeStockConcentration,
  equitySleeveValue,
} from '@/src/features/portfolio/concentration';
import {
  colorForSleeve,
  reviewDueDate,
  rootTargetsFromMap,
  type PolicyConfig,
} from '@/src/features/portfolio/policy';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import {
  computeRiskBudget,
  type RiskBudgetReport,
} from '@/src/features/portfolio/risk';
import {
  formatCompactINR,
  formatINR,
  formatPercent,
  formatSignedINR,
} from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

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

function reviewStatus(reviewDue: string | null): {
  label: string;
  tone: BadgeTone;
  detail: string;
} {
  if (!reviewDue) {
    return {
      label: 'Not scheduled',
      tone: 'neutral',
      detail: 'Confirm the policy to start the review clock.',
    };
  }
  const due = new Date(reviewDue).getTime();
  if (!Number.isFinite(due)) {
    return { label: 'Not scheduled', tone: 'neutral', detail: 'Review date is invalid.' };
  }
  const days = Math.ceil((due - Date.now()) / 86_400_000);
  if (days < 0) {
    return {
      label: 'Overdue',
      tone: 'negative',
      detail: `Policy review is overdue by ${Math.abs(days)} days.`,
    };
  }
  if (days <= 30) {
    return {
      label: 'Due soon',
      tone: 'warning',
      detail: `Policy review is due in ${days} days.`,
    };
  }
  return {
    label: 'Scheduled',
    tone: 'positive',
    detail: `Policy review is due in ${days} days.`,
  };
}

const COMPLIANCE_LABEL: Record<ComplianceReport['status'], string> = {
  compliant: 'Compliant',
  watch: 'Watch',
  breach: 'Breach',
  template: 'Template',
  unmanaged: 'No policy',
};

function pnlTone(value: number): BadgeTone {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

export default function ReportScreen() {
  const router = useRouter();
  const {
    analytics,
    summary,
    policyConfig,
    policyEvaluation,
    fundCoverage,
    isLoading,
    error,
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

  const compliance = useMemo(
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

  const risk = useMemo(
    () =>
      computeRiskBudget({
        sleeves: [
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
        model: policyConfig.riskModel,
        budget: policyConfig.riskBudget,
        totalValue: analytics.totals.portfolio,
      }),
    [
      analytics.totals.portfolio,
      policyConfig.riskBudget,
      policyConfig.riskModel,
      policyEvaluation.sleeves,
      policyEvaluation.unmanaged,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          eyebrow="Advanced reporting"
          title="Policy report"
          subtitle="Contribution, accounts, policy audit and a shareable summary"
          action={
            <IconButton
              icon="x"
              onPress={() => router.back()}
              accessibilityLabel="Close policy report"
            />
          }
        />

        {error ? (
          <Card>
            <ErrorState
              message={
                error instanceof Error
                  ? error.message
                  : 'The report could not be loaded.'
              }
              onRetry={refetch}
            />
          </Card>
        ) : isLoading ? (
          <Card>
            <Text style={[type.body, { color: '#71717A' }]}>Building report…</Text>
          </Card>
        ) : (
          <ReportBody
            config={policyConfig}
            holdings={summary.holdings}
            nodes={analytics.allocationAnalysis}
            compliance={compliance}
            risk={risk}
          />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function ReportBody({
  config,
  holdings,
  nodes,
  compliance,
  risk,
}: {
  config: PolicyConfig;
  holdings: Holding[];
  nodes: AllocationNode[];
  compliance: ComplianceReport;
  risk: RiskBudgetReport;
}) {
  const { colors } = useTheme();

  const contribution = useMemo<ContributionReport>(
    () => buildContributionReport({ holdings, nodes }),
    [holdings, nodes],
  );
  const accounts = useMemo<AccountRow[]>(
    () => accountSummary(holdings),
    [holdings],
  );
  const composition = useMemo(
    () =>
      validateComposition(config.targets, {
        allowUnallocated: config.policy.allowUnallocated ?? false,
      }),
    [config.policy.allowUnallocated, config.targets],
  );

  const review = reviewStatus(reviewDueDate(config.policy));
  const sources = config.history;
  const rootTargets = rootTargetsFromMap(config.targets);
  const rootPaths = Object.keys(rootTargets);
  const unallocatedParents = Object.entries(composition.unallocatedByParent);

  const reportText = useMemo(() => {
    const lines: string[] = [];
    const generated = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date());

    lines.push('PORTFOLIO POLICY REPORT');
    lines.push(`Generated ${generated}`);
    lines.push('');
    lines.push('PORTFOLIO');
    lines.push(`Value: ${formatINR(contribution.totalValue)}`);
    lines.push(`Invested: ${formatINR(contribution.totalInvested)}`);
    lines.push(`Unrealised P&L: ${formatSignedINR(contribution.totalPnl)}`);
    lines.push(
      `Holdings: ${holdings.length} · accounts: ${accounts.length} · winners ${contribution.winners} · losers ${contribution.losers}`,
    );
    lines.push('');
    lines.push('POLICY');
    lines.push(
      config.isTemplate
        ? 'Status: template, not confirmed'
        : `Status: v${config.policy.version} · ${config.policy.source} · effective ${formatDate(
            config.policy.effectiveFrom,
          )}`,
    );
    lines.push(`Review: ${review.label} — ${review.detail}`);
    for (const path of rootPaths) {
      const range = config.ranges[path];
      const benchmark = config.benchmarks[path];
      lines.push(
        `- ${path}: ${formatPercent(rootTargets[path] ?? 0)} of portfolio${
          range ? ` · range ${formatPercent(range.min)}–${formatPercent(range.max)}` : ''
        }${benchmark ? ` · benchmark ${benchmark}` : ''}`,
      );
    }
    if (config.policy.notes) {
      lines.push(`Notes: ${config.policy.notes}`);
    }
    if (config.policy.approvedBy) {
      lines.push(`Approved by: ${config.policy.approvedBy}`);
    }
    lines.push('');
    lines.push('COMPOSITION');
    lines.push(
      `${composition.definedCount} sub-category targets · ${composition.parentCount} parents · ${
        config.policy.allowUnallocated ? 'Unallocated allowed' : '100% per parent required'
      }`,
    );
    for (const [parent, gap] of unallocatedParents) {
      lines.push(`- ${parent}: ${formatPercent(gap)} explicit Unallocated`);
    }
    if (config.policy.sectorTargets) {
      const sectorNames = Object.keys(config.policy.sectorTargets);
      if (sectorNames.length > 0) {
        lines.push('');
        lines.push('SECTOR POLICY (% OF EQUITY)');
        for (const name of sectorNames) {
          lines.push(
            `- ${name}: ${formatPercent(config.policy.sectorTargets[name] ?? 0)}`,
          );
        }
      }
    }
    lines.push('');
    lines.push('RISK');
    lines.push(`Estimated volatility: ${formatPercent(risk.portfolioVolatilityPct)}`);
    lines.push(
      `Top risk contributor: ${
        risk.topRiskPath
          ? `${risk.topRiskPath} at ${formatPercent(risk.topRiskPct)}`
          : 'none'
      }`,
    );
    lines.push(`Risk budget total: ${formatPercent(risk.budgetTotal)}`);
    lines.push('');
    lines.push('COMPLIANCE');
    lines.push(
      `Status: ${COMPLIANCE_LABEL[compliance.status]} · breaches ${compliance.breachCount} · watches ${compliance.watchCount}`,
    );
    lines.push(`Range coverage: ${formatPercent(compliance.rangeCoveragePercentage)}`);
    lines.push('');
    lines.push('CONTRIBUTION BY SLEEVE');
    for (const row of contribution.bySleeve.slice(0, 8)) {
      lines.push(
        `- ${row.label}: ${formatSignedINR(row.pnl)} (${formatPercent(
          row.contributionPct,
          { signed: true },
        )} of portfolio)`,
      );
    }
    lines.push('');
    lines.push('ACCOUNTS');
    for (const account of accounts) {
      lines.push(
        `- ${account.account}: ${formatINR(account.currentValue)} (${formatPercent(
          account.percentage,
        )}) · ${account.holdings} holdings · P&L ${formatSignedINR(account.pnl)}`,
      );
    }
    lines.push('');
    lines.push('TOP HOLDINGS');
    for (const holding of holdings.slice(0, 5)) {
      const percentage =
        contribution.totalValue > 0
          ? (holding.currentValue / contribution.totalValue) * 100
          : 0;
      lines.push(
        `- ${holding.asset.name}: ${formatPercent(percentage)} · ${formatINR(
          holding.currentValue,
        )} · P&L ${formatSignedINR(holding.pnl)}`,
      );
    }
    lines.push('');
    lines.push(
      'Contribution is current unrealised P&L, not historical Brinson attribution.',
    );
    lines.push(
      `Policy range, composition and benchmark data from policy v${config.policy.version}.`,
    );

    return lines.join('\n');
  }, [
    accounts,
    compliance,
    composition,
    config,
    contribution,
    holdings,
    review,
    risk,
    rootTargets,
    rootPaths,
    unallocatedParents,
  ]);

  const shareReport = () => {
    void Share.share({
      title: 'Portfolio policy report',
      message: reportText,
    }).catch(() => undefined);
  };

  return (
    <View style={styles.stack}>
      {config.isTemplate ? (
        <Banner
          tone="warning"
          icon="alert-triangle"
          message="This is still the default template. Confirm root targets to produce a governed report."
        />
      ) : null}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryText}>
            <Text style={[type.label, { color: colors.muted }]}>
              Portfolio value
            </Text>
            <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
              {formatCompactINR(contribution.totalValue)}
            </Text>
          </View>
          <Badge
            label={
              contribution.totalPnl >= 0 ? 'Unrealised gain' : 'Unrealised loss'
            }
            tone={pnlTone(contribution.totalPnl)}
          />
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          Invested {formatCompactINR(contribution.totalInvested)} · P&L{' '}
          {formatSignedINR(contribution.totalPnl)} ·{' '}
          {formatPercent(
            contribution.totalInvested > 0
              ? (contribution.totalPnl / contribution.totalInvested) * 100
              : 0,
            { signed: true },
          )}
        </Text>

        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Holdings</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {holdings.length}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Accounts</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
              {accounts.length}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Winners</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.positive }]}>
              {contribution.winners}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={[type.label, { color: colors.muted }]}>Losers</Text>
            <Text style={[styles.metricValue, numeric, { color: colors.negative }]}>
              {contribution.losers}
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.inlineRow}>
          <View style={styles.inlineText}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>
              Compliance
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {compliance.breachCount} breaches · {compliance.watchCount} watches
            </Text>
          </View>
          <Badge
            label={COMPLIANCE_LABEL[compliance.status]}
            tone={
              compliance.status === 'breach'
                ? 'negative'
                : compliance.status === 'watch' ||
                    compliance.status === 'template'
                  ? 'warning'
                  : compliance.status === 'compliant'
                    ? 'positive'
                    : 'neutral'
            }
          />
        </View>
        <View style={styles.inlineRow}>
          <View style={styles.inlineText}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>Policy review</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {review.detail}
            </Text>
          </View>
          <Badge label={review.label} tone={review.tone} />
        </View>
      </Card>

      <View>
        <SectionHeader
          title="Contribution by sleeve"
          subtitle="Current unrealised P&L, not historical attribution"
        />
        <Card style={styles.listCard}>
          {contribution.bySleeve.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              Add holdings to calculate contribution.
            </Text>
          ) : (
            contribution.bySleeve.map((row, index) => (
              <View
                key={row.key}
                style={[
                  styles.listRow,
                  index > 0 ? { borderTopColor: colors.border } : null,
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: colorForSleeve(row.label, index) },
                  ]}
                />
                <View style={styles.listText}>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>
                    {row.label}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {formatCompactINR(row.currentValue)} ·{' '}
                    {formatPercent(row.contributionPct, { signed: true })} of
                    portfolio
                  </Text>
                </View>
                <View style={styles.listRight}>
                  <Text
                    style={[
                      type.bodyMedium,
                      numeric,
                      { color: row.pnl >= 0 ? colors.positive : colors.negative },
                    ]}
                  >
                    {formatSignedINR(row.pnl)}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {formatPercent(row.pnlPercent, { signed: true })}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Accounts"
          subtitle="Household consolidation with per-account P&L"
        />
        <Card style={styles.listCard}>
          {accounts.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              No accounts yet. Tag holdings in the asset editor.
            </Text>
          ) : (
            accounts.map((account, index) => (
              <View
                key={account.account}
                style={[
                  styles.listRow,
                  index > 0 ? { borderTopColor: colors.border } : null,
                ]}
              >
                <View style={styles.accountIcon}>
                  <Badge label={account.account} tone="accent" />
                </View>
                <View style={styles.listText}>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {account.holdings}{' '}
                    {account.holdings === 1 ? 'holding' : 'holdings'}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {formatCompactINR(account.currentValue)}
                  </Text>
                </View>
                <View style={styles.listRight}>
                  <Text style={[type.bodyMedium, numeric, { color: colors.text }]}>
                    {formatPercent(account.percentage)}
                  </Text>
                  <Text
                    style={[
                      type.caption,
                      numeric,
                      {
                        color: account.pnl >= 0 ? colors.positive : colors.negative,
                      },
                    ]}
                  >
                    {formatSignedINR(account.pnl)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Top holdings"
          subtitle="Current contribution, sorted by absolute P&L"
        />
        <Card style={styles.listCard}>
          {contribution.byHolding.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              No valued holdings.
            </Text>
          ) : (
            contribution.byHolding.slice(0, 8).map((row, index) => (
              <View
                key={row.key}
                style={[
                  styles.listRow,
                  index > 0 ? { borderTopColor: colors.border } : null,
                ]}
              >
                <View style={styles.listText}>
                  <Text
                    style={[type.bodyMedium, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {row.label}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {row.account} · {formatCompactINR(row.currentValue)}
                  </Text>
                </View>
                <View style={styles.listRight}>
                  <Text
                    style={[
                      type.bodyMedium,
                      numeric,
                      { color: row.pnl >= 0 ? colors.positive : colors.negative },
                    ]}
                  >
                    {formatSignedINR(row.pnl)}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    {formatPercent(row.pnlPercent, { signed: true })}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Policy audit"
          subtitle="Targets, ranges, benchmarks and every recorded version"
        />
        <Card style={styles.settingsCard}>
          <View style={styles.inlineRow}>
            <Text style={[type.body, { color: colors.muted }]}>Version</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.isTemplate ? 'Not confirmed' : `v${config.policy.version}`}
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <Text style={[type.body, { color: colors.muted }]}>Effective from</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.isTemplate ? '—' : formatDate(config.policy.effectiveFrom)}
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <Text style={[type.body, { color: colors.muted }]}>Review due</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {formatDate(reviewDueDate(config.policy))}
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <Text style={[type.body, { color: colors.muted }]}>Approved by</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.policy.approvedBy || '—'}
            </Text>
          </View>
          <View style={styles.inlineRow}>
            <Text style={[type.body, { color: colors.muted }]}>Notes</Text>
            <Text style={[styles.factValue, { color: colors.textSecondary }]}>
              {config.policy.notes || '—'}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {rootPaths.map((path, index) => {
            const range = config.ranges[path];
            const benchmark = config.benchmarks[path];
            return (
              <View key={path} style={styles.policyRow}>
                <View
                  style={[styles.dot, { backgroundColor: colorForSleeve(path, index) }]}
                />
                <View style={styles.listText}>
                  <Text style={[type.bodyMedium, { color: colors.text }]}>
                    {path}
                  </Text>
                  <Text style={[type.caption, { color: colors.muted }]}>
                    Target {formatPercent(rootTargets[path] ?? 0)}
                    {range
                      ? ` · range ${formatPercent(range.min)}–${formatPercent(range.max)}`
                      : ''}
                    {benchmark ? ` · ${benchmark}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}

          {unallocatedParents.length > 0 ? (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Text style={[type.label, { color: colors.muted }]}>
                Explicit Unallocated
              </Text>
              {unallocatedParents.map(([parent, gap]) => (
                <View key={parent} style={styles.inlineRow}>
                  <Text style={[type.caption, { color: colors.textSecondary }]}>
                    {parent}
                  </Text>
                  <Text style={[type.caption, numeric, { color: colors.warning }]}>
                    {formatPercent(gap)}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Text style={[type.label, { color: colors.muted }]}>
            Recorded versions
          </Text>
          {sources.length === 0 ? (
            <Text style={[type.caption, { color: colors.muted }]}>
              No prior versions recorded.
            </Text>
          ) : (
            sources.slice(0, 5).map((entry) => {
              const total = Object.values(rootTargetsFromMap(entry.targets)).reduce(
                (sum, value) => sum + value,
                0,
              );
              return (
                <View key={`${entry.id}:${entry.version}`} style={styles.historyRow}>
                  <Text style={[styles.historyVersion, { color: colors.text }]}>
                    v{entry.version}
                  </Text>
                  <View style={styles.listText}>
                    <Text style={[type.caption, { color: colors.textSecondary }]}>
                      {formatDate(entry.effectiveFrom)} · targets{' '}
                      {formatPercent(total)}
                    </Text>
                    <Text style={[type.caption, { color: colors.muted }]}>
                      {entry.changeNote ||
                        entry.notes ||
                        (entry.approvedBy ? `Approved by ${entry.approvedBy}` : 'No note recorded')}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </View>

      <View>
        <SectionHeader
          title="Share report"
          subtitle="Plain text, generated from current data and policy"
        />
        <Card style={styles.shareCard}>
          <Text style={[type.caption, { color: colors.muted }]}>
            The summary includes portfolio value, policy targets and ranges, composition,
            risk, compliance, contribution, accounts and top holdings. It is generated on
            this device and leaves only when you choose to share it.
          </Text>
          <Button
            label="Share report"
            onPress={shareReport}
            icon="share-2"
            variant="secondary"
            fullWidth
          />
        </Card>
      </View>

      <Text style={[styles.footnote, { color: colors.muted }]}>
        Contribution is current unrealised P&L. The app does not store historical
        snapshots, so this is not Brinson or time-weighted attribution.
      </Text>
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
  summaryValue: { fontSize: 28, fontWeight: '600', letterSpacing: -0.5 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  metric: { flexBasis: '42%', flexGrow: 1, gap: 2 },
  metricValue: { fontSize: 18, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  inlineText: { flex: 1, gap: 2 },
  listCard: { gap: 0 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  listText: { flex: 1, gap: 2 },
  listRight: { alignItems: 'flex-end', gap: 2 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  accountIcon: { width: 92 },
  settingsCard: { gap: space.md },
  factValue: { fontSize: 13, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  historyVersion: { width: 32, fontSize: 11, fontWeight: '600' },
  shareCard: { gap: space.md },
  footnote: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
