import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Donut } from '@/src/components/charts/Donut';
import { AllocationHealthCard } from '@/src/components/portfolio/AllocationHealthCard';
import { HoldingRow } from '@/src/components/portfolio/HoldingRow';
import { PolicyAllocationLegend } from '@/src/components/portfolio/PolicyAllocationLegend';
import { QuoteFreshnessBanner } from '@/src/components/portfolio/QuoteFreshnessBanner';
import { AllocationAnalysisCard } from '@/src/components/portfolio/insights/AllocationAnalysisCard';
import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { LoadingProgress } from '@/src/components/ui/LoadingProgress';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/src/components/ui/States';
import type { PortfolioSummary } from '@/src/features/portfolio/aggregate';
import type {
  PolicySleeveEvaluation,
  PolicyUnmanagedSlice,
} from '@/src/features/portfolio/policy';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import {
  formatCompactINR,
  formatDriftPp,
  formatPercent,
} from '@/src/lib/format/money';
import { formatRelativeTime } from '@/src/lib/format/time';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Allocation is the app's home. The screen answers three questions in order:
 * how the portfolio sits against target, what to do next, and what is owned.
 * Portfolio value and P&L remain present, but below the allocation decision.
 */
export default function AllocationHomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, isDemo } = useAuth();
  const {
    summary,
    analytics,
    policyConfig,
    policyEvaluation,
    progress,
    lastSyncedAt,
    quotesAsOf,
    staleQuoteCount,
    exchangeIsCached,
    exchangeLastSyncedAt,
    isLoading,
    isRefreshing,
    error,
    priceError,
    refetch,
  } = usePortfolioData();

  const displayName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'there';
  const firstName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
  const greetingLabel = user ? `${greeting()}, ${firstName}` : greeting();

  const {
    sleeves,
    unmanaged,
    targetedCount,
    inToleranceCount,
    isTemplate,
    isValid,
  } = policyEvaluation;
  const needsTargets = isTemplate || !isValid || targetedCount === 0;

  const donutSlices = [
    ...sleeves.map((sleeve) => ({
      key: sleeve.path,
      value: Math.max(0, sleeve.currentValue),
      color: sleeve.color,
    })),
    ...unmanaged.map((slice) => ({
      key: slice.path,
      value: Math.max(0, slice.currentValue),
      color: slice.color,
    })),
  ].filter((slice) => slice.value > 0);

  const toleranceLabel =
    targetedCount > 0
      ? `${inToleranceCount}/${targetedCount} sleeves in tolerance`
      : 'no sleeve targets';
  const policySubtitle = isTemplate
    ? isDemo
      ? 'Default template · read-only in demo'
      : 'Default template · confirm your targets'
    : !isValid
      ? `Policy v${policyConfig.policy.version} · targets total ${formatPercent(
          policyEvaluation.targetSum,
        )}`
      : `Policy v${policyConfig.policy.version} · ${toleranceLabel}${
          unmanaged.length > 0
            ? ` · ${formatPercent(policyEvaluation.unmanagedPercentage)} unmanaged`
            : ''
        }`;

  const offPolicy = sleeves
    .filter((sleeve) => sleeve.status !== 'within')
    .sort((a, b) => Math.abs(b.driftPp) - Math.abs(a.driftPp));

  const syncedLabel = lastSyncedAt ? formatRelativeTime(lastSyncedAt) : null;
  const quotesLabel = quotesAsOf ? formatRelativeTime(quotesAsOf) : null;
  const subtitle = isRefreshing && syncedLabel
    ? 'Refreshing your allocation…'
    : syncedLabel
      ? `Updated ${syncedLabel} · ${summary.assetCount} holdings${
          quotesLabel ? ` · quotes ${quotesLabel}` : ''
        }`
      : 'Target versus current allocation';

  const donutTone = needsTargets
    ? colors.text
    : inToleranceCount === 0
      ? colors.negative
      : inToleranceCount === targetedCount
        ? colors.positive
        : colors.warning;

  return (
    <Screen refreshing={isRefreshing} onRefresh={refetch}>
      <ScreenHeader
        eyebrow={greetingLabel}
        title="Allocation"
        subtitle={subtitle}
        size="large"
        action={
          <View style={styles.headerActions}>
            <IconButton
              icon="message-circle"
              onPress={() => router.push('/assistant')}
              accessibilityLabel="Open the AI assistant"
            />
            <IconButton
              icon="refresh-cw"
              onPress={refetch}
              accessibilityLabel="Refresh portfolio"
            />
          </View>
        }
      />

      <View style={styles.stack}>
        {isDemo ? (
          <Banner
            tone="warning"
            icon="play-circle"
            message="You are exploring a bundled demo. Sign out and use your account to sync real holdings."
          />
        ) : null}

        <QuoteFreshnessBanner
          staleQuoteCount={staleQuoteCount}
          exchangeIsCached={exchangeIsCached}
          exchangeLastSyncedAt={exchangeLastSyncedAt}
          onRefresh={isDemo ? undefined : refetch}
        />

        {error ? (
          <Card>
            <ErrorState
              message={
                error instanceof Error
                  ? error.message
                  : 'The portfolio service could not be reached.'
              }
              onRetry={refetch}
            />
          </Card>
        ) : isLoading ? (
          <>
            <LoadingProgress progress={progress} />
            <AllocationSkeleton />
          </>
        ) : summary.assetCount === 0 ? (
          <Card>
            <EmptyState
              icon="target"
              title="No allocation to analyse"
              message="Add your first stock, fund, crypto or cash position to compare your allocation with your targets."
              actionLabel={isDemo ? undefined : 'Add an asset'}
              onAction={isDemo ? undefined : () => router.push('/asset/new')}
            />
          </Card>
        ) : (
          <>
            {progress.active ? <LoadingProgress progress={progress} compact /> : null}

            <AllocationHealthCard
              evaluation={policyEvaluation}
              policyVersion={policyConfig.policy.version}
              readOnly={isDemo}
              onManageTargets={() => router.push('/policy')}
              onPlanRebalance={() => router.push('/rebalance')}
            />

            {priceError ? (
              <Banner
                tone="warning"
                icon="clock"
                message="Live prices are unavailable right now — allocation values fall back to your average cost."
              />
            ) : null}

            {!needsTargets && offPolicy.length > 0 ? (
              <DriftMonitor
                sleeves={offPolicy}
                onPlanRebalance={() => router.push('/rebalance')}
              />
            ) : null}

            <PortfolioStrip summary={summary} />

            <View>
              <SectionHeader
                title="Current allocation"
                subtitle={policySubtitle}
                actionLabel={isDemo ? 'View' : 'Manage'}
                onAction={() => router.push('/policy')}
              />
              <Card style={styles.allocationCard}>
                <View style={styles.donutWrap}>
                  <Donut
                    data={donutSlices}
                    accessibilityLabel={`Current allocation across ${sleeves.length} policy sleeves${
                      unmanaged.length > 0
                        ? ` and ${unmanaged.length} unmanaged categories`
                        : ''
                    }`}
                  >
                    <Text style={[type.label, { color: colors.muted }]}>
                      {needsTargets ? 'Sleeves' : 'In tolerance'}
                    </Text>
                    <Text style={[styles.donutValue, numeric, { color: donutTone }]}>
                      {needsTargets ? sleeves.length : `${inToleranceCount}/${targetedCount}`}
                    </Text>
                  </Donut>
                </View>
                <PolicyAllocationLegend evaluation={policyEvaluation} />
              </Card>
            </View>

            {unmanaged.length > 0 ? (
              <UnmanagedCard
                slices={unmanaged}
                readOnly={isDemo}
                onExtend={() => router.push('/policy')}
              />
            ) : null}

            <View>
              <SectionHeader
                title="Allocation tree"
                subtitle="Root sleeves carry the policy; tap to inspect sub-sleeves and holdings"
              />
              <AllocationAnalysisCard
                nodes={analytics.allocationAnalysis}
                total={analytics.totals.portfolio}
                policy={policyEvaluation}
                policyVersion={policyConfig.policy.version}
              />
            </View>

            <View>
              <SectionHeader
                title="Top holdings"
                subtitle="The largest positions behind your current allocation"
                actionLabel="View all"
                onAction={() => router.push('/assets')}
              />
              <Card padded={false} style={styles.holdingsCard}>
                {summary.topHoldings.map((holding, index) => (
                  <View key={holding.asset.id}>
                    {index > 0 ? (
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    ) : null}
                    <HoldingRow
                      holding={holding}
                      rank={index + 1}
                      weight={
                        summary.currentValue > 0
                          ? (holding.currentValue / summary.currentValue) * 100
                          : 0
                      }
                      onPress={() => router.push(`/asset/${holding.asset.id}`)}
                    />
                  </View>
                ))}
                {summary.assetCount > summary.topHoldings.length ? (
                  <View style={[styles.more, { borderTopColor: colors.border }]}>
                    <Button
                      label={`View ${summary.assetCount - summary.topHoldings.length} more`}
                      onPress={() => router.push('/assets')}
                      variant="ghost"
                      size="sm"
                    />
                  </View>
                ) : null}
              </Card>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

/** Compact portfolio context, deliberately quieter than the allocation cards. */
function PortfolioStrip({ summary }: { summary: PortfolioSummary }) {
  const { colors } = useTheme();
  const positive = summary.pnl >= 0;
  const noQuotes = summary.assetCount > 0 && summary.pricedCount === 0;
  const partialQuotes =
    summary.pricedCount > 0 && summary.pricedCount < summary.assetCount;
  const pnlTone = noQuotes
    ? colors.muted
    : positive
      ? colors.positive
      : colors.negative;

  return (
    <Card style={styles.portfolioStrip}>
      <StripStat
        label="Value"
        value={formatCompactINR(summary.currentValue)}
        hint={`${summary.assetCount} ${summary.assetCount === 1 ? 'holding' : 'holdings'}`}
      />
      <View style={[styles.stripDivider, { backgroundColor: colors.border }]} />
      <StripStat
        label="Invested"
        value={formatCompactINR(summary.investedValue)}
        hint={`${summary.categories} ${summary.categories === 1 ? 'category' : 'categories'}`}
      />
      <View style={[styles.stripDivider, { backgroundColor: colors.border }]} />
      <StripStat
        label="P&L"
        value={
          noQuotes
            ? '—'
            : `${positive ? '+' : '-'}${formatCompactINR(Math.abs(summary.pnl))}`
        }
        hint={
          noQuotes
            ? 'Awaiting quotes'
            : partialQuotes
              ? `${summary.pricedCount}/${summary.assetCount} priced`
              : formatPercent(summary.pnlPercent, { signed: true })
        }
        tone={pnlTone}
        accessibilityLabel={
          noQuotes
            ? 'Unrealised profit and loss awaiting live quotes'
            : `Unrealised profit and loss ${positive ? 'up' : 'down'} ${formatPercent(
                Math.abs(summary.pnlPercent),
              )}`
        }
      />
    </Card>
  );
}

interface StripStatProps {
  label: string;
  value: string;
  hint: string;
  tone?: string;
  accessibilityLabel?: string;
}

function StripStat({ label, value, hint, tone, accessibilityLabel }: StripStatProps) {
  const { colors } = useTheme();

  return (
    <View
      style={styles.stripStat}
      accessible
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}. ${hint}`}
    >
      <Text style={[styles.stripLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.stripValue, numeric, { color: tone ?? colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
      <Text style={[styles.stripHint, { color: colors.muted }]} numberOfLines={1}>
        {hint}
      </Text>
    </View>
  );
}

interface DriftMonitorProps {
  sleeves: PolicySleeveEvaluation[];
  onPlanRebalance: () => void;
}

/** Off-target sleeves with the rupee size of the rebalancing gap. */
function DriftMonitor({ sleeves, onPlanRebalance }: DriftMonitorProps) {
  const { colors } = useTheme();
  const overweight = sleeves.filter((sleeve) => sleeve.driftPp > 0).length;
  const underweight = sleeves.filter((sleeve) => sleeve.driftPp < 0).length;
  const breaches = sleeves.filter((sleeve) => sleeve.status === 'breach').length;
  const watches = sleeves.length - breaches;
  const alertTone = breaches > 0 ? colors.negative : colors.warning;
  const alertSoft = breaches > 0 ? colors.negativeSoft : colors.warningSoft;

  return (
    <Card style={styles.driftCard}>
      <View style={styles.driftHeader}>
        <View style={[styles.driftIcon, { backgroundColor: alertSoft }]}>
          <Feather name="activity" size={15} color={alertTone} />
        </View>
        <View style={styles.driftHeaderText}>
          <Text style={[type.title, { color: colors.text }]}>Drift & rebalance</Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>
            {breaches > 0
              ? `${breaches} sleeve${breaches === 1 ? '' : 's'} outside band${
                  watches > 0 ? ` · ${watches} near band` : ''
                }`
              : `${watches} nearing tolerance`}
          </Text>
        </View>
        <Badge
          label={`${overweight} over · ${underweight} under`}
          tone={breaches > 0 ? 'negative' : 'warning'}
        />
      </View>

      <View style={styles.driftRows}>
        {sleeves.map((sleeve) => {
          const over = sleeve.driftPp > 0;
          const breach = sleeve.status === 'breach';
          const tone = breach ? colors.negative : colors.warning;
          const soft = breach ? colors.negativeSoft : colors.warningSoft;
          return (
            <View
              key={sleeve.path}
              style={[styles.driftRow, { backgroundColor: colors.cardMuted }]}
            >
              <View style={[styles.driftRowIcon, { backgroundColor: soft }]}>
                <Feather
                  name={over ? 'arrow-up-right' : 'arrow-down-right'}
                  size={13}
                  color={tone}
                />
              </View>
              <View style={styles.driftRowText}>
                <Text style={[styles.driftName, { color: colors.text }]} numberOfLines={1}>
                  {sleeve.label}
                </Text>
                <Text style={[styles.driftHint, { color: colors.muted }]} numberOfLines={1}>
                  {formatCompactINR(Math.abs(sleeve.driftValue))} {over ? 'above' : 'below'} · target{' '}
                  {formatPercent(sleeve.targetPercentage)} ±{sleeve.bandPp}pp
                </Text>
              </View>
              <View style={styles.driftRight}>
                <Badge
                  label={breach ? (over ? 'Trim' : 'Add') : 'Near band'}
                  tone={breach ? 'negative' : 'warning'}
                />
                <Text style={[styles.driftPercent, numeric, { color: tone }]}>
                  {formatDriftPp(sleeve.driftPp, { signed: true })}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={[styles.driftFooter, { borderTopColor: colors.border }]}>
        <Text style={[styles.driftFooterText, { color: colors.muted }]}>
          Rebalance with new contributions first, then trim overweight sleeves. Bands apply to
          each sleeve independently.
        </Text>
        <Button
          label="Build rebalance plan"
          icon="sliders"
          variant="secondary"
          size="sm"
          fullWidth
          onPress={onPlanRebalance}
        />
      </View>
    </Card>
  );
}

interface UnmanagedCardProps {
  slices: PolicyUnmanagedSlice[];
  readOnly?: boolean;
  onExtend: () => void;
}

/** Holdings that count in the portfolio but have no policy target. */
function UnmanagedCard({ slices, readOnly = false, onExtend }: UnmanagedCardProps) {
  const { colors } = useTheme();
  const percentage = slices.reduce((sum, slice) => sum + slice.currentPercentage, 0);
  const value = slices.reduce((sum, slice) => sum + slice.currentValue, 0);

  return (
    <Card style={styles.unmanagedCard}>
      <View style={styles.unmanagedHeader}>
        <View style={[styles.unmanagedIcon, { backgroundColor: colors.warningSoft }]}>
          <Feather name="help-circle" size={15} color={colors.warning} />
        </View>
        <View style={styles.unmanagedHeaderText}>
          <Text style={[type.title, { color: colors.text }]}>Outside policy</Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>
            {formatCompactINR(value)} ({formatPercent(percentage)} of value) sits outside every sleeve
          </Text>
        </View>
        <Badge label="Unmanaged" tone="warning" />
      </View>

      <View style={styles.unmanagedRows}>
        {slices.map((slice) => (
          <View key={slice.path} style={styles.unmanagedRow}>
            <View style={[styles.unmanagedDot, { backgroundColor: slice.color }]} />
            <Text style={[styles.unmanagedName, { color: colors.textSecondary }]} numberOfLines={1}>
              {slice.label}
            </Text>
            <Text style={[styles.unmanagedPercent, numeric, { color: colors.muted }]}>
              {formatPercent(slice.currentPercentage)}
            </Text>
            <Text style={[styles.unmanagedValue, numeric, { color: colors.textSecondary }]}>
              {formatCompactINR(slice.currentValue)}
            </Text>
          </View>
        ))}
      </View>

      <Button
        label={readOnly ? 'View policy' : 'Add to policy'}
        onPress={onExtend}
        variant="secondary"
        size="sm"
        icon={readOnly ? 'eye' : 'plus'}
      />
    </Card>
  );
}

function AllocationSkeleton() {
  return (
    <View style={styles.skeletonStack}>
      <Skeleton height={196} borderRadius={16} />
      <Skeleton height={210} borderRadius={16} />
      <Skeleton height={84} borderRadius={16} />
      <Skeleton height={330} borderRadius={16} />
      <Skeleton height={360} borderRadius={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  headerActions: { flexDirection: 'row', gap: space.sm },
  allocationCard: { gap: space.xl },
  donutWrap: { alignItems: 'center' },
  donutValue: { fontSize: 19, fontWeight: '600', marginTop: 2 },
  portfolioStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: space.md,
  },
  stripStat: { flex: 1, gap: 2, paddingHorizontal: space.xxs },
  stripLabel: { ...type.label, fontSize: 9.5, letterSpacing: 0.35 },
  stripValue: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  stripHint: { fontSize: 9.5 },
  stripDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },
  driftCard: { gap: space.md },
  driftHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  driftIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driftHeaderText: { flex: 1 },
  driftRows: { gap: space.sm },
  driftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  driftRowIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driftRowText: { flex: 1 },
  driftName: { fontSize: 12, fontWeight: '600' },
  driftHint: { fontSize: 10, marginTop: 1 },
  driftRight: { alignItems: 'flex-end', gap: 3 },
  driftPercent: { fontSize: 12, fontWeight: '600' },
  driftFooter: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  driftFooterText: { fontSize: 10, lineHeight: 15 },
  unmanagedCard: { gap: space.md },
  unmanagedHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  unmanagedIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unmanagedHeaderText: { flex: 1 },
  unmanagedRows: { gap: space.xs },
  unmanagedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  unmanagedDot: { width: 6, height: 6, borderRadius: radius.full },
  unmanagedName: { flex: 1, fontSize: 11 },
  unmanagedPercent: { width: 48, fontSize: 10, textAlign: 'right' },
  unmanagedValue: { width: 66, fontSize: 10, textAlign: 'right' },
  holdingsCard: { overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 34 + space.md + space.lg },
  more: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.xs },
  skeletonStack: { gap: space.xl },
});
