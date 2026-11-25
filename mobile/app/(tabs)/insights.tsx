import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ConcentrationCard } from '@/src/components/portfolio/insights/ConcentrationCard';
import { ExposureCard } from '@/src/components/portfolio/insights/ExposureCard';
import { FundAllocationCard } from '@/src/components/portfolio/insights/FundAllocationCard';
import { SectorCapBars } from '@/src/components/portfolio/insights/SectorCapBars';
import { SectorCapTreemap } from '@/src/components/portfolio/insights/SectorCapTreemap';
import { Banner } from '@/src/components/ui/Banner';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { LoadingProgress } from '@/src/components/ui/LoadingProgress';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/src/components/ui/States';
import {
  analyzeStockConcentration,
  equitySleeveValue,
} from '@/src/features/portfolio/concentration';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

export default function InsightsScreen() {
  const router = useRouter();
  const {
    summary,
    analytics,
    policyEvaluation,
    fundCoverage,
    isDemo,
    progress,
    isLoading,
    isRefreshing,
    isFundLoading,
    error,
    priceError,
    fundError,
    refetch,
    refetchFunds,
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

  return (
    <Screen refreshing={isRefreshing} onRefresh={refetch}>
      <ScreenHeader
        eyebrow="Portfolio intelligence"
        title="Insights"
        subtitle="Look-through exposure, concentration and fund overlap"
        action={
          <IconButton icon="refresh-cw" onPress={refetch} accessibilityLabel="Refresh insights" />
        }
      />

      <View style={styles.stack}>
        {isDemo ? (
          <Banner
            tone="info"
            icon="layers"
            message="Demo data — scheme holdings and market caps are bundled so every chart renders offline."
          />
        ) : null}

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
            <InsightsSkeleton />
          </>
        ) : summary.assetCount === 0 ? (
          <Card>
            <EmptyState
              icon="activity"
              title="No analytics yet"
              message="Add stocks, funds or ETFs to unlock market-cap, sector and look-through analytics."
              actionLabel="Add an asset"
              onAction={() => router.push('/asset/new')}
            />
          </Card>
        ) : (
          <>
            {progress.active ? <LoadingProgress progress={progress} compact /> : null}

            <InsightsSummary
              portfolio={analytics.totals.portfolio}
              equity={analytics.totals.equity}
              fund={analytics.totals.fund}
              coverage={fundCoverage}
            />

            {priceError ? (
              <Banner
                tone="warning"
                icon="clock"
                message="Live prices are unavailable — analytics fall back to your average cost."
              />
            ) : null}

            {!isDemo && fundCoverage.total > 0 && fundCoverage.withData < fundCoverage.total ? (
              <Banner
                tone="warning"
                icon="alert-circle"
                message={`Look-through is available for ${fundCoverage.withData} of ${fundCoverage.total} funds. Cap and sector exposure may be understated until the rest sync.`}
                actionLabel="Retry"
                onAction={refetchFunds}
              />
            ) : null}

            <View>
              <SectionHeader
                title="Core exposure"
                subtitle="Direct holdings plus fund look-through"
              />
              <View style={styles.cards}>
                <ExposureCard
                  title="Market Cap Exposure"
                  subtitle="Size first · domestic vs global inside each band"
                  icon="bar-chart"
                  slices={analytics.marketCap}
                  colors={analytics.capColors}
                  centerLabel="Equity"
                  emptyMessage="Add equities, or funds with market-cap data, to see cap bands."
                  tint="#7C3AED"
                  tintSoft="rgba(124, 58, 237, 0.12)"
                  directLabel="Stocks"
                  indirectLabel="Funds"
                />

                <ExposureCard
                  title="Sector Allocation"
                  subtitle="Across sectors"
                  icon="pie-chart"
                  slices={analytics.sectors}
                  colors={analytics.sectorColors}
                  centerLabel="Sectors"
                  emptyMessage="Add equities or funds with sector weights to see sector allocation."
                  tint="#0D9488"
                  tintSoft="rgba(13, 148, 136, 0.12)"
                  directLabel="Stocks"
                  indirectLabel="Funds"
                />

                <FundAllocationCard
                  funds={analytics.funds}
                  coverage={fundCoverage}
                  isLoading={isFundLoading}
                  error={fundError}
                  onRetry={refetchFunds}
                />
              </View>
            </View>

            <View>
              <SectionHeader
                title="Concentration"
                subtitle={`Single-stock exposure against the ${concentration.limitPct}% equity cap`}
              />
              <View style={styles.cards}>
                <ConcentrationCard
                  report={concentration}
                  onSelect={(row) => {
                    if (row.assetId) router.push(`/asset/${row.assetId}`);
                  }}
                />
              </View>
            </View>

            <View>
              <SectionHeader
                title="Cap × sector matrix"
                subtitle="Where sector risk sits across cap bands"
              />
              <View style={styles.cards}>
                <SectorCapTreemap
                  rows={analytics.capRows}
                  sectorColors={analytics.sectorColors}
                  capColors={analytics.capColors}
                />
                <SectorCapBars
                  rows={analytics.capRows}
                  allSectors={analytics.allSectors}
                  sectorColors={analytics.sectorColors}
                  capColors={analytics.capColors}
                />
              </View>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

interface InsightsSummaryProps {
  portfolio: number;
  equity: number;
  fund: number;
  coverage: { withData: number; total: number };
}

function InsightsSummary({ portfolio, equity, fund, coverage }: InsightsSummaryProps) {
  const { colors } = useTheme();
  const equityPercent = portfolio > 0 ? (equity / portfolio) * 100 : 0;
  const fundPercent = portfolio > 0 ? (fund / portfolio) * 100 : 0;

  return (
    <Card style={styles.summaryCard}>
      <View style={styles.summaryGrid}>
        <SummaryStat
          label="Equity exposure"
          value={formatCompactINR(equity)}
          hint={`${formatPercent(equityPercent)} of portfolio`}
          icon="trending-up"
          color={colors.accent}
        />
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <SummaryStat
          label="Fund assets"
          value={formatCompactINR(fund)}
          hint={`${formatPercent(fundPercent)} of portfolio`}
          icon="briefcase"
          color={colors.warning}
        />
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <SummaryStat
          label="Look-through"
          value={
            coverage.total > 0 ? `${coverage.withData}/${coverage.total}` : '—'
          }
          hint={coverage.total > 0 ? 'funds mapped' : 'no funds held'}
          icon="search"
          color={colors.positive}
        />
      </View>
      <Text style={[type.caption, styles.summaryNote, { color: colors.muted }]}>
        Equity exposure includes fund holdings, so fund assets are not added on top.
      </Text>
    </Card>
  );
}

interface SummaryStatProps {
  label: string;
  value: string;
  hint: string;
  icon: ComponentProps<typeof Feather>['name'];
  color: string;
}

function SummaryStat({ label, value, hint, icon, color }: SummaryStatProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.summaryStat}>
      <View style={styles.summaryLabelRow}>
        <Feather name={icon} size={11} color={color} />
        <Text style={[styles.summaryLabel, { color: colors.muted }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text
        style={[styles.summaryValue, numeric, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {value}
      </Text>
      <Text style={[styles.summaryHint, { color: colors.muted }]} numberOfLines={1}>
        {hint}
      </Text>
    </View>
  );
}

function InsightsSkeleton() {
  return (
    <View style={styles.skeletonStack}>
      <Skeleton height={122} borderRadius={16} />
      <Skeleton height={420} borderRadius={16} />
      <Skeleton height={340} borderRadius={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  cards: { gap: space.lg },
  summaryCard: { paddingVertical: space.lg, gap: space.md },
  summaryGrid: { flexDirection: 'row', alignItems: 'stretch' },
  summaryNote: { lineHeight: 16 },
  summaryStat: { flex: 1, gap: 3, paddingHorizontal: space.xs },
  summaryLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  summaryLabel: { ...type.label, fontSize: 9, letterSpacing: 0.3, flex: 1 },
  summaryValue: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  summaryHint: { fontSize: 9 },
  summaryDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },
  skeletonStack: { gap: space.xl },
});
