import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { HoldingRow } from '@/src/components/portfolio/HoldingRow';
import { QuoteFreshnessBanner } from '@/src/components/portfolio/QuoteFreshnessBanner';
import { TargetVsActualCard } from '@/src/components/portfolio/TargetVsActualCard';
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
import type { PolicyUnmanagedSlice } from '@/src/features/portfolio/policy';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
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
 * Allocation is the app's home. The new Target vs Actual table leads; the
 * previous layout's remaining sections are temporarily stacked below it.
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
    exchangeIssues,
    isLoading,
    isRefreshing,
    error,
    priceError,
    refetch,
  } = usePortfolioData();

  const displayName = user?.displayName?.trim() || user?.email?.split('@')[0] || 'there';
  const firstName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
  const greetingLabel = user ? `${greeting()}, ${firstName}` : greeting();

  const { unmanaged } = policyEvaluation;

  const syncedLabel = lastSyncedAt ? formatRelativeTime(lastSyncedAt) : null;
  const quotesLabel = quotesAsOf ? formatRelativeTime(quotesAsOf) : null;
  const subtitle = isRefreshing && syncedLabel
    ? 'Refreshing your allocation…'
    : syncedLabel
      ? `Updated ${syncedLabel} · ${summary.assetCount} holdings${
          quotesLabel ? ` · quotes ${quotesLabel}` : ''
        }`
      : 'Target versus current allocation';

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
          exchangeIssues={exchangeIssues}
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

            <PortfolioStrip summary={summary} />

            <TargetVsActualCard
              evaluation={policyEvaluation}
              nodes={analytics.allocationAnalysis}
              total={analytics.totals.portfolio}
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

            <View style={styles.compareDivider} accessible={false}>
              <View style={[styles.compareLine, { backgroundColor: colors.border }]} />
              <Text style={[type.label, styles.compareLabel, { color: colors.muted }]}>
                Previous layout
              </Text>
              <View style={[styles.compareLine, { backgroundColor: colors.border }]} />
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

/** Compact portfolio context, deliberately quieter than the allocation table. */
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

function AllocationSkeleton() {
  return (
    <View style={styles.skeletonStack}>
      <Skeleton height={84} borderRadius={16} />
      <Skeleton height={460} borderRadius={16} />
      <Skeleton height={360} borderRadius={16} />
    </View>
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

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  headerActions: { flexDirection: 'row', gap: space.sm },
  compareDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.xs,
  },
  compareLine: { flex: 1, height: StyleSheet.hairlineWidth },
  compareLabel: { letterSpacing: 0.6 },
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
