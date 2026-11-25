import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConcentrationRow } from '@/src/components/portfolio/insights/ConcentrationRow';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { LoadingProgress } from '@/src/components/ui/LoadingProgress';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SearchField } from '@/src/components/ui/SearchField';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/src/components/ui/States';
import type {
  StockConcentrationRow,
  StockConcentrationStatus,
} from '@/src/features/portfolio/concentration';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import { useStockConcentration } from '@/src/features/portfolio/useStockConcentration';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

type StatusFilter = 'all' | StockConcentrationStatus;
type SourceFilter = 'all' | 'direct' | 'fund';
type SortKey = 'exposure' | 'name' | 'status';

const STATUS_ORDER: Record<StockConcentrationStatus, number> = {
  breach: 0,
  watch: 1,
  ok: 2,
};

/**
 * Full concentration register. The Insights tab keeps a top-ten preview; this
 * screen follows the institutional pattern of a separate holdings table with
 * search, status/source filters, sortable columns and drill-through.
 */
export default function ConcentrationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const {
    summary,
    analytics,
    policyEvaluation,
    progress,
    isLoading,
    isRefreshing,
    error,
    refetch,
  } = usePortfolioData();

  const report = useStockConcentration({
    holdings: summary.holdings,
    funds: analytics.funds,
    sleeves: policyEvaluation.sleeves,
    equityValue: analytics.totals.equity,
    portfolioValue: analytics.totals.portfolio,
  });

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sort, setSort] = useState<SortKey>('exposure');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = report.rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (sourceFilter === 'direct' && row.directValue <= 0) return false;
      if (sourceFilter === 'fund' && row.fundValue <= 0) return false;
      if (!needle) return true;
      return [row.name, row.symbol ?? '', ...row.funds.map((fund) => fund.name)]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'status') {
        return (
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          b.totalValue - a.totalValue ||
          a.name.localeCompare(b.name)
        );
      }
      return b.totalValue - a.totalValue || a.name.localeCompare(b.name);
    });
  }, [report.rows, query, statusFilter, sourceFilter, sort]);

  const scaleMax = Math.max(
    report.limitPct * 1.5,
    (report.largest?.equityPercentage ?? 0) * 1.1,
    report.limitPct + 1,
  );
  const previewCount = Math.min(10, report.rows.length);
  const topShare =
    report.equityValue > 0
      ? (report.rows
          .slice(0, 10)
          .reduce((sum, row) => sum + row.totalValue, 0) /
          report.equityValue) *
        100
      : 0;
  const withinCount =
    report.rows.length - report.breachCount - report.watchCount;
  const filtersActive =
    query.length > 0 || statusFilter !== 'all' || sourceFilter !== 'all';

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setSourceFilter('all');
  };
  const openStock = (row: StockConcentrationRow) => {
    if (row.assetId) router.push(`/asset/${row.assetId}`);
  };
  const openFund = (assetId: string) => router.push(`/asset/${assetId}`);

  const screenHeader = (
    <ScreenHeader
      eyebrow="Portfolio intelligence"
      title="Concentration"
      subtitle={`${report.rows.length} stocks · ${formatCompactINR(
        report.equityValue,
      )} equity sleeve`}
      leading={
        <IconButton
          icon="arrow-left"
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        />
      }
      action={
        <IconButton
          icon="refresh-cw"
          onPress={() => void refetch()}
          accessibilityLabel="Refresh concentration"
        />
      }
    />
  );

  if (error) {
    return (
      <Screen refreshing={isRefreshing} onRefresh={refetch}>
        {screenHeader}
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
      </Screen>
    );
  }

  if (isLoading) {
    return (
      <Screen refreshing={isRefreshing} onRefresh={refetch}>
        {screenHeader}
        <LoadingProgress progress={progress} />
        <View style={styles.skeletonStack}>
          <Skeleton height={92} borderRadius={16} />
          <Skeleton height={42} borderRadius={10} />
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} height={52} borderRadius={8} />
          ))}
        </View>
      </Screen>
    );
  }

  const header = (
    <View style={styles.headerStack}>
      {screenHeader}

      <Card style={styles.summaryCard}>
        <View style={styles.summaryGrid}>
          <SummaryStat
            label="Positions"
            value={String(report.rows.length)}
            hint="stocks with exposure"
          />
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <SummaryStat
            label={`Top ${previewCount} share`}
            value={formatPercent(topShare, { precision: 1 })}
            hint={`${report.limitPct}% cap per stock`}
          />
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <SummaryStat
            label="Above cap"
            value={String(report.breachCount)}
            hint={
              report.watchCount > 0
                ? `${report.watchCount} near cap`
                : `${withinCount} within`
            }
            tone={report.breachCount > 0 ? 'negative' : undefined}
          />
        </View>
      </Card>

      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search stock, symbol or fund"
        accessibilityLabel="Search concentration"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Chip
          label="All statuses"
          selected={statusFilter === 'all'}
          onPress={() => setStatusFilter('all')}
        />
        <Chip
          label={`Above cap${report.breachCount > 0 ? ` · ${report.breachCount}` : ''}`}
          selected={statusFilter === 'breach'}
          onPress={() => setStatusFilter('breach')}
        />
        <Chip
          label={`Near cap${report.watchCount > 0 ? ` · ${report.watchCount}` : ''}`}
          selected={statusFilter === 'watch'}
          onPress={() => setStatusFilter('watch')}
        />
        <Chip
          label="Within"
          selected={statusFilter === 'ok'}
          onPress={() => setStatusFilter('ok')}
        />
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Chip
          label="All sources"
          selected={sourceFilter === 'all'}
          onPress={() => setSourceFilter('all')}
        />
        <Chip
          icon="briefcase"
          label="Direct"
          selected={sourceFilter === 'direct'}
          onPress={() => setSourceFilter('direct')}
        />
        <Chip
          icon="layers"
          label="Via funds"
          selected={sourceFilter === 'fund'}
          onPress={() => setSourceFilter('fund')}
        />
      </ScrollView>

      <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
        <SortHeader
          label="Stock"
          active={sort === 'name'}
          direction="asc"
          onPress={() => setSort('name')}
          style={styles.stockHeader}
        />
        <SortHeader
          label="% eq"
          active={sort === 'exposure'}
          direction="desc"
          onPress={() => setSort('exposure')}
          style={styles.percentHeader}
        />
        <SortHeader
          label="Status"
          active={sort === 'status'}
          direction="desc"
          onPress={() => setSort('status')}
          style={styles.statusHeader}
        />
        <View style={styles.chevronSpace} />
      </View>

      <View style={styles.resultRow}>
        <Text style={[styles.resultText, { color: colors.muted }]}>
          {rows.length === report.rows.length
            ? `${rows.length} ${rows.length === 1 ? 'stock' : 'stocks'}`
            : `${rows.length} of ${report.rows.length} stocks`}
        </Text>
        {filtersActive ? (
          <Pressable
            onPress={clearFilters}
            accessibilityRole="button"
            accessibilityLabel="Clear concentration filters"
            hitSlop={8}
          >
            <Text style={[styles.clearText, { color: colors.accent }]}>
              Clear filters
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const footer =
    report.rows.length === 0 ? null : (
      <View style={styles.footerStack}>
        <Text style={[styles.footerText, { color: colors.muted }]}>
          Measured against {formatCompactINR(report.equityValue)} of equity
          exposure. The cap is {report.limitPct}% per stock.
        </Text>
        {report.coverage.total > 0 ? (
          <Text style={[styles.footerText, { color: colors.muted }]}>
            {`Look-through covers ${report.coverage.withData} of ${
              report.coverage.total
            } ${
              report.coverage.total === 1 ? 'fund' : 'funds'
            } with equity exposure.`}
            {report.coverage.withData < report.coverage.total
              ? ' Undisclosed holdings may add concentration.'
              : ''}
          </Text>
        ) : null}
        {report.otherEquityValue > 0 ? (
          <Text style={[styles.footerText, { color: colors.muted }]}>
            Other equity covers undisclosed fund holdings and equity not
            attributed to a single stock.
          </Text>
        ) : null}
      </View>
    );

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => (
          <View style={[styles.rowWrap, { borderBottomColor: colors.border }]}>
            <ConcentrationRow
              row={item}
              scaleMax={scaleMax}
              limitPct={report.limitPct}
              onSelect={openStock}
              onSelectFund={openFund}
              maxFunds={10}
            />
          </View>
        )}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <EmptyState
              icon={report.rows.length === 0 ? 'bar-chart-2' : 'search'}
              title={report.rows.length === 0 ? 'No stock exposure' : 'No matches'}
              message={
                report.rows.length === 0
                  ? 'Add stocks, or sync a fund with disclosed holdings, to measure single-stock concentration.'
                  : 'Try a different name, symbol, fund or filter.'
              }
              actionLabel={
                report.rows.length > 0 && filtersActive ? 'Clear filters' : undefined
              }
              onAction={
                report.rows.length > 0 && filtersActive ? clearFilters : undefined
              }
            />
          </Card>
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + space.xxxl * 2 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refetch}
            tintColor={colors.muted}
            colors={[colors.accent]}
          />
        }
      />
    </Screen>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'negative';
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[
          styles.summaryValue,
          numeric,
          { color: tone === 'negative' ? colors.negative : colors.text },
        ]}
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

function SortHeader({
  label,
  active,
  direction,
  onPress,
  style,
}: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
      accessibilityState={{ selected: active }}
      style={[styles.sortHeader, style]}
    >
      <Text
        style={[
          styles.sortLabel,
          { color: active ? colors.text : colors.muted },
          active && styles.sortLabelActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {active ? (
        <Feather
          name={direction === 'asc' ? 'arrow-up' : 'arrow-down'}
          size={10}
          color={colors.accent}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerStack: { gap: space.md, paddingTop: space.sm },
  summaryCard: { paddingVertical: space.md },
  summaryGrid: { flexDirection: 'row', alignItems: 'stretch' },
  summaryStat: { flex: 1, gap: 2, paddingHorizontal: space.xs },
  summaryLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.3 },
  summaryValue: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  summaryHint: { fontSize: 9 },
  summaryDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },
  chipRow: { gap: space.sm, paddingRight: space.lg },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: space.xs,
    marginTop: space.xs,
  },
  sortHeader: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stockHeader: { flex: 1 },
  percentHeader: { width: 46, justifyContent: 'flex-end' },
  statusHeader: { width: 58, justifyContent: 'flex-end' },
  chevronSpace: { width: 13 },
  sortLabel: { fontSize: 9.5, fontWeight: '600', letterSpacing: 0.2 },
  sortLabelActive: { fontWeight: '700' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.xxs,
  },
  resultText: { fontSize: 10 },
  clearText: { fontSize: 10, fontWeight: '600' },
  rowWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.md,
  },
  emptyCard: { marginTop: space.md },
  footerStack: { gap: 3, paddingTop: space.lg },
  footerText: { fontSize: 10, lineHeight: 15 },
  listContent: { paddingHorizontal: space.lg, paddingTop: 0 },
  skeletonStack: { gap: space.md },
});
