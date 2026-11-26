import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HoldingRow } from '@/src/components/portfolio/HoldingRow';
import { QuoteFreshnessBanner } from '@/src/components/portfolio/QuoteFreshnessBanner';
import { Banner } from '@/src/components/ui/Banner';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { LoadingProgress } from '@/src/components/ui/LoadingProgress';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/src/components/ui/States';
import { useAuth } from '@/src/features/auth/AuthProvider';
import type { Holding } from '@/src/features/portfolio/aggregate';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface Section {
  title: string;
  total: number;
  invested: number;
  pnlPercent: number;
  data: Holding[];
}

export default function HoldingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isDemo } = useAuth();
  const {
    summary,
    progress,
    staleQuoteCount,
    staleQuotes,
    exchangeIsCached,
    cachedExchangeNames,
    exchangeLastSyncedAt,
    exchangeIssues,
    isLoading,
    isRefreshing,
    error,
    refetch,
  } = usePortfolioData();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  const categories = useMemo(
    () => summary.allocation.map((slice) => slice.label),
    [summary.allocation],
  );

  const colorByCategory = useMemo(() => {
    const map: Record<string, string> = {};
    for (const slice of summary.allocation) map[slice.label] = slice.color;
    return map;
  }, [summary.allocation]);

  const sections = useMemo<Section[]>(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = summary.positions.filter((holding) => {
      const matchesCategory = category === 'All' || holding.category === category;
      const matchesQuery =
        normalized.length === 0 ||
        holding.asset.name.toLowerCase().includes(normalized) ||
        holding.asset.symbol.toLowerCase().includes(normalized);
      return matchesCategory && matchesQuery;
    });

    const grouped = new Map<string, Holding[]>();
    for (const holding of filtered) {
      const list = grouped.get(holding.category) ?? [];
      list.push(holding);
      grouped.set(holding.category, list);
    }

    return [...grouped.entries()].map(([title, data]) => {
      const total = data.reduce((sum, item) => sum + item.currentValue, 0);
      const invested = data.reduce((sum, item) => sum + item.investedValue, 0);
      return {
        title,
        total,
        invested,
        pnlPercent: invested > 0 ? ((total - invested) / invested) * 100 : 0,
        data,
      };
    });
  }, [summary.positions, query, category]);

  const positionMeta = (holding: Holding): string | undefined => {
    if (holding.category !== 'Crypto') return undefined;
    const lotCount = holding.lotCount ?? 1;
    if (lotCount > 1) {
      return `${lotCount} lots${
        holding.costBasisIncomplete ? ' · partial cost basis' : ''
      }`;
    }
    if (holding.costBasisIncomplete) return 'no cost basis';
    return holding.asset.exchange;
  };

  const openPosition = (holding: Holding) => {
    if (
      holding.lots &&
      holding.lots.length > 1 &&
      holding.positionKey?.startsWith('crypto:')
    ) {
      router.push(`/position/${holding.positionKey.slice('crypto:'.length)}`);
      return;
    }
    router.push(`/asset/${holding.asset.id}`);
  };

  const listHeader = (
    <View style={styles.stack}>
      <ScreenHeader
        title="Holdings"
        subtitle={
          isDemo
            ? `${summary.positionCount} demo holdings`
            : `${summary.positionCount} holdings · ${formatCompactINR(summary.currentValue)}`
        }
        action={
          isDemo ? undefined : (
            <IconButton
              icon="plus"
              onPress={() => router.push('/asset/new')}
              accessibilityLabel="Add holding"
            />
          )
        }
      />

      {isDemo ? (
        <Banner tone="warning" icon="eye" message="Demo data is read-only. Sign in to edit holdings." />
      ) : null}

      <QuoteFreshnessBanner
        staleQuoteCount={staleQuoteCount}
        staleQuotes={staleQuotes}
        exchangeIsCached={exchangeIsCached}
        cachedExchangeNames={cachedExchangeNames}
        exchangeLastSyncedAt={exchangeLastSyncedAt}
        exchangeIssues={exchangeIssues}
        onRefresh={isDemo ? undefined : refetch}
        onOpenStale={
          isDemo
            ? undefined
            : (quote) => {
                if (quote.assetId) router.push(`/asset/${quote.assetId}`);
              }
        }
      />

      {progress.active && !isLoading ? (
        <LoadingProgress progress={progress} compact />
      ) : null}

      <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={15} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name or symbol"
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search holdings"
          style={[styles.searchInput, { color: colors.text }]}
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            hitSlop={8}
            accessibilityLabel="Clear search"
          >
            <Feather name="x" size={15} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {categories.length > 0 ? (
        <View style={styles.chips}>
          <Chip label="All" selected={category === 'All'} onPress={() => setCategory('All')} />
          {categories.map((item) => (
            <Chip
              key={item}
              label={item}
              selected={category === item}
              onPress={() => setCategory(item)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  if (isLoading || error) {
    return (
      <Screen refreshing={isRefreshing} onRefresh={refetch}>
        {listHeader}
        {error ? (
          <Card>
            <ErrorState
              message={error instanceof Error ? error.message : 'Could not load your holdings.'}
              onRetry={refetch}
            />
          </Card>
        ) : (
          <>
            <LoadingProgress progress={progress} />
            <View style={styles.skeletonStack}>
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} height={72} borderRadius={16} />
              ))}
            </View>
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.asset.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + space.xxxl * 2 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refetch}
            tintColor={colors.muted}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.bg }]}>
            <View style={styles.sectionRow}>
              <Text style={[type.label, { color: colors.muted }]}>{section.title}</Text>
              <Text style={[styles.sectionTotal, numeric, { color: colors.muted }]}>
                {formatCompactINR(section.total)}
              </Text>
            </View>
            <Text style={[styles.sectionMeta, { color: colors.muted }]}>
              Invested {formatCompactINR(section.invested)} · P&L{' '}
              <Text
                style={{
                  color:
                    section.pnlPercent >= 0 ? colors.positive : colors.negative,
                }}
              >
                {formatPercent(section.pnlPercent, { signed: true })}
              </Text>
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Card padded={false} style={styles.rowCard}>
            <HoldingRow
              holding={item}
              showWeight={false}
              accentColor={colorByCategory[item.category]}
              metaLabel={positionMeta(item)}
              onPress={() => openPosition(item)}
            />
          </Card>
        )}
        ListEmptyComponent={
          <Card>
            <EmptyState
              icon={summary.positionCount === 0 ? 'plus-circle' : 'search'}
              title={summary.positionCount === 0 ? 'No holdings yet' : 'No matches'}
              message={
                summary.positionCount === 0
                  ? 'Add your first holding to start tracking allocation and returns.'
                  : 'Try a different name, symbol or category filter.'
              }
              actionLabel={summary.positionCount === 0 && !isDemo ? 'Add holding' : undefined}
              onAction={
                summary.positionCount === 0 && !isDemo ? () => router.push('/asset/new') : undefined
              }
            />
          </Card>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  listContent: { paddingHorizontal: space.lg, paddingTop: space.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sectionHeader: {
    paddingTop: space.lg,
    paddingBottom: space.sm,
    gap: 2,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTotal: { fontSize: 11 },
  sectionMeta: { fontSize: 11 },
  rowCard: { marginBottom: space.sm },
  skeletonStack: { gap: space.sm },
});
