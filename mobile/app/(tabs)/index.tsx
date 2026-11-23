import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { HoldingRow } from '@/src/components/portfolio/HoldingRow';
import { QuoteFreshnessBanner } from '@/src/components/portfolio/QuoteFreshnessBanner';
import { TargetVsActualCard } from '@/src/components/portfolio/TargetVsActualCard';
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
import { useAuth } from '@/src/features/auth/AuthProvider';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { formatRelativeTime } from '@/src/lib/format/time';
import { numeric, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Allocation is the app's home. The Target vs Actual table answers how the
 * portfolio sits against policy first; portfolio value and holdings stay below
 * as supporting context.
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

            {priceError ? (
              <Banner
                tone="warning"
                icon="clock"
                message="Live prices are unavailable right now — allocation values fall back to your average cost."
              />
            ) : null}

            <TargetVsActualCard
              evaluation={policyEvaluation}
              nodes={analytics.allocationAnalysis}
              total={analytics.totals.portfolio}
              policyVersion={policyConfig.policy.version}
              readOnly={isDemo}
              onManageTargets={() => router.push('/policy')}
              onPlanRebalance={() => router.push('/rebalance')}
            />

            <PortfolioStrip summary={summary} />

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
      <Skeleton height={420} borderRadius={16} />
      <Skeleton height={84} borderRadius={16} />
      <Skeleton height={320} borderRadius={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  headerActions: { flexDirection: 'row', gap: space.sm },
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
  holdingsCard: { overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 34 + space.md + space.lg },
  more: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.xs },
  skeletonStack: { gap: space.xl },
});
