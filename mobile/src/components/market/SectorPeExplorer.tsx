import { Feather } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { Chip } from '@/src/components/ui/Chip';
import { IconButton } from '@/src/components/ui/IconButton';
import { SearchField } from '@/src/components/ui/SearchField';
import { SegmentedControl } from '@/src/components/ui/SegmentedControl';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { indexEntryVerdict } from '@/src/features/market/entrySignal';
import {
  indiaPeSourceLabel,
  useIndiaPe,
} from '@/src/features/market/indiaPe';
import {
  currentSourceLabel,
  formatAsOf,
  formatHistoryWindow,
  formatPe,
  historySourceLabel,
  ordinalPercentile,
  peZoneLabel,
} from '@/src/features/market/peFormat';
import {
  describeMedianPosition,
  discountToMedian,
  formatRelativePe,
  relativePe,
} from '@/src/features/market/peMetrics';
import { classifyPePercentile } from '@/src/features/market/peSignal';
import {
  countAtCutoff,
  filterSectorIndices,
  SECTOR_CATEGORY_OPTIONS,
  SECTOR_SORT_OPTIONS,
  SECTOR_ZONE_OPTIONS,
  sectorUniverse,
  sortSectorIndices,
  summarizePeZones,
  type SectorCategoryFilter,
  type SectorSort,
  type SectorZoneFilter,
} from '@/src/features/market/sectorView';
import { formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { SectorPeHistory } from './SectorPeHistory';

function categoryCaption(filter: SectorCategoryFilter): string {
  switch (filter) {
    case 'sector':
      return 'Sector & thematic is the signal universe. Broad indices are benchmarks, not peers.';
    case 'broad':
      return 'Broad indices are benchmarks for relative valuation, not sector peers.';
    default:
      return 'All 45 indices, with broad benchmarks labelled separately.';
  }
}

function categoryShortLabel(filter: SectorCategoryFilter): string {
  switch (filter) {
    case 'sector':
      return 'Sector';
    case 'broad':
      return 'Broad';
    default:
      return 'All';
  }
}

function sortCaption(sort: SectorSort): string {
  switch (sort) {
    case 'discount':
      return 'largest discount to the 5-year median first';
    case 'name':
      return 'alphabetical';
    default:
      return 'cheapest percentile first';
  }
}

function DetailCell({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.detailCell}>
      <Text style={[styles.detailLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Full sector screen: every index, category and zone filters, search, sorting
 * and expandable rows. Percentiles remain the classifier; the median discount
 * and relative P/E are secondary context.
 */
export function SectorPeExplorer() {
  const { colors } = useTheme();
  const { data, error, isLoading, isFetching, refetch } = useIndiaPe();
  const [category, setCategory] = useState<SectorCategoryFilter>('sector');
  const [zone, setZone] = useState<SectorZoneFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SectorSort>('percentile');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const indices = useMemo(() => data?.indices ?? [], [data?.indices]);
  const benchmark = indices.find((index) => index.key === 'nifty50') ?? null;
  const benchmarkPe = benchmark?.pe ?? null;

  const universe = useMemo(
    () => sectorUniverse(indices, category, query),
    [indices, category, query],
  );
  const counts = useMemo(() => summarizePeZones(universe), [universe]);
  const rows = useMemo(
    () => sortSectorIndices(filterSectorIndices(indices, { category, zone, query }), sort),
    [indices, category, zone, query, sort],
  );
  const categoryCounts = useMemo(
    () =>
      Object.fromEntries(
        SECTOR_CATEGORY_OPTIONS.map((option) => [
          option.value,
          sectorUniverse(indices, option.value, '').length,
        ]),
      ) as Record<SectorCategoryFilter, number>,
    [indices],
  );
  const zoneCounts: Record<SectorZoneFilter, number> = {
    all: counts.total,
    cheap: counts.buyZone,
    fair: counts.neutral,
    expensive: counts.expensive,
    unknown: counts.noSignal,
  };
  const cutoff = countAtCutoff(rows);

  if (isLoading && !data) {
    return (
      <Card style={styles.card}>
        <View style={styles.loadingHeader}>
          <Text style={[type.title, { color: colors.text }]}>Sector valuations</Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            Loading every NSE sector and thematic index…
          </Text>
        </View>
        <Skeleton height={42} borderRadius={radius.md} />
        <Skeleton height={58} borderRadius={radius.md} />
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} height={44} borderRadius={radius.md} />
        ))}
      </Card>
    );
  }

  if (!data || indices.length === 0) {
    return (
      <Card>
        <ErrorState
          title="Sector valuations unavailable"
          message={
            error instanceof Error
              ? error.message
              : 'NSE sector valuations could not be loaded. Check the connection and try again.'
          }
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  const sourceLabel = indiaPeSourceLabel(data);
  const asOfLabel = `${formatAsOf(data.asOf)}${data.stale ? ' · last known' : ''}`;
  const segments = [
    { key: 'buy', count: counts.buyZone, color: colors.positive },
    { key: 'neutral', count: counts.neutral, color: colors.muted },
    { key: 'expensive', count: counts.expensive, color: colors.warning },
    { key: 'none', count: counts.noSignal, color: colors.border },
  ];

  return (
    <View style={styles.stack}>
      <Card style={styles.card}>
        <View style={styles.toolbar}>
          <View style={styles.toolbarText}>
            <Text style={[type.title, { color: colors.text }]}>Sector valuations</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {sourceLabel} · {asOfLabel}
            </Text>
          </View>
          <IconButton
            icon="refresh-cw"
            variant="plain"
            size={32}
            onPress={() => void refetch()}
            accessibilityLabel="Refresh sector valuations"
            disabled={isFetching}
          />
        </View>

        <SegmentedControl
          options={SECTOR_CATEGORY_OPTIONS.map((option) => ({
            value: option.value,
            label: `${categoryShortLabel(option.value)} ${categoryCounts[option.value]}`,
          }))}
          value={category}
          onChange={(value) => {
            setCategory(value);
            setExpandedKey(null);
          }}
          accessibilityLabel="Index category"
        />
        <Text style={[styles.caption, { color: colors.muted }]}>
          {categoryCaption(category)}
        </Text>

        <View style={[styles.summary, { backgroundColor: colors.cardMuted }]}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, numeric, { color: colors.positive }]}>
              {counts.buyZone}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>Buy zone</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
              {counts.neutral}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>Neutral</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, numeric, { color: colors.warning }]}>
              {counts.expensive}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>Expensive</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, numeric, { color: colors.muted }]}>
              {counts.noSignal}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>No signal</Text>
          </View>
        </View>

        <View style={[styles.distribution, { backgroundColor: colors.cardMuted }]}>
          {segments.map((segment) =>
            segment.count > 0 ? (
              <View
                key={segment.key}
                style={{ flex: segment.count, backgroundColor: segment.color }}
              />
            ) : null,
          )}
        </View>

        <View style={styles.chipRow}>
          {SECTOR_ZONE_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={`${option.label} ${zoneCounts[option.value]}`}
              selected={zone === option.value}
              onPress={() => {
                setZone(option.value);
                setExpandedKey(null);
              }}
            />
          ))}
        </View>

        <SearchField
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setExpandedKey(null);
          }}
          placeholder="Search indices"
          accessibilityLabel="Search sector and thematic indices"
        />

        <View style={styles.sortRow}>
          <Text style={[styles.sortLabel, { color: colors.muted }]}>Sort</Text>
          {SECTOR_SORT_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={sort === option.value}
              onPress={() => setSort(option.value)}
            />
          ))}
        </View>

        <Text style={[styles.resultLine, { color: colors.muted }]}>
          Showing {rows.length} of {universe.length} · {sortCaption(sort)}
        </Text>

        <View style={styles.list}>
          {rows.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: colors.cardMuted }]}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No indices match these filters
              </Text>
              <Pressable
                onPress={() => {
                  setZone('all');
                  setQuery('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear sector filters"
              >
                <Text style={[styles.clear, { color: colors.accent }]}>Clear filters</Text>
              </Pressable>
            </View>
          ) : (
            rows.map((index, row) => {
              const percentile = index.history?.percentile ?? null;
              const indexZone = classifyPePercentile(percentile);
              const entry = indexEntryVerdict(indexZone);
              const discount = discountToMedian(index.pe, index.history?.medianPe ?? null);
              const relative = relativePe(index.pe, benchmarkPe);
              const expanded = expandedKey === index.key;
              return (
                <Pressable
                  key={index.key}
                  onPress={() => setExpandedKey(expanded ? null : index.key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${index.name}, ${entry.label}, P/E ${formatPe(index.pe)}`}
                  style={({ pressed }) => [
                    styles.row,
                    row > 0 && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.rowMain}>
                    <View style={styles.rowText}>
                      <View style={styles.nameRow}>
                        <Text
                          style={[styles.rowTitle, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {index.name}
                        </Text>
                        {index.category === 'broad' ? (
                          <Badge label="Benchmark" tone="neutral" />
                        ) : null}
                      </View>
                      <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={2}>
                        {percentile != null
                          ? `${peZoneLabel(indexZone)} · ${ordinalPercentile(percentile)} pct · median ${formatPe(
                              index.history?.medianPe ?? null,
                            )} · ${describeMedianPosition(discount) ?? 'median unavailable'}`
                          : 'Current P/E only · history still building'}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowPe, numeric, { color: colors.text }]}>
                        {formatPe(index.pe)}
                      </Text>
                      <Badge label={entry.label} tone={entry.tone} />
                    </View>
                    <Feather
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color={colors.muted}
                    />
                  </View>

                  {expanded ? (
                    <View style={[styles.details, { backgroundColor: colors.cardMuted }]}>
                      <View style={styles.detailRow}>
                        <DetailCell label="Current P/E" value={formatPe(index.pe)} />
                        <DetailCell label="P/B" value={formatPe(index.pb)} />
                        <DetailCell
                          label="Div yield"
                          value={
                            index.dividendYield != null
                              ? formatPercent(index.dividendYield)
                              : '—'
                          }
                        />
                      </View>
                      <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                      <View style={styles.detailRow}>
                        <DetailCell
                          label="Earnings yield"
                          value={
                            index.earningsYield != null
                              ? formatPercent(index.earningsYield)
                              : '—'
                          }
                        />
                        <DetailCell
                          label="5y median"
                          value={formatPe(index.history?.medianPe ?? null)}
                        />
                        <DetailCell
                          label="Percentile"
                          value={
                            percentile != null ? ordinalPercentile(percentile) : '—'
                          }
                        />
                      </View>
                      <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                      <View style={styles.detailRow}>
                        <DetailCell
                          label="Vs median"
                          value={describeMedianPosition(discount) ?? '—'}
                        />
                        <DetailCell
                          label="Relative P/E"
                          value={
                            relative != null
                              ? `${formatRelativePe(relative)} vs Nifty 50`
                              : '—'
                          }
                        />
                        <DetailCell
                          label="Sample"
                          value={
                            index.history ? `${index.history.sampleMonths} months` : '—'
                          }
                        />
                      </View>
                      <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                      <View style={styles.detailRow}>
                        <DetailCell
                          label="History window"
                          value={formatHistoryWindow(index.history)}
                        />
                        <DetailCell
                          label="Current source"
                          value={currentSourceLabel(index.currentSource)}
                        />
                        <DetailCell
                          label="History source"
                          value={historySourceLabel(index.historySource)}
                        />
                      </View>
                      <View style={[styles.chartBlock, { borderTopColor: colors.border }]}>
                        <Text style={[styles.chartTitle, { color: colors.text }]}>P/E history</Text>
                        <SectorPeHistory index={index} />
                      </View>
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>

        {cutoff > 0 ? (
          <Text style={[styles.cutoff, { color: colors.warning }]}>
            {cutoff} {cutoff === 1 ? 'index is' : 'indices are'} exactly at the 25th-percentile
            buy cutoff in this view.
          </Text>
        ) : null}
      </Card>

      <Text style={[styles.note, { color: colors.muted }]}>
        Percentiles compare each index with its own last 60 monthly readings; the bottom quartile
        includes the 25th-percentile boundary. Discount to median is secondary context, not a
        separate signal. Relative P/E divides the index P/E by Nifty 50. Broad indices are
        benchmarks, not sector peers. History uses NSE month-end archives, with Downstox filling
        missing windows; current values fall back to Downstox, then the official Nifty Indices feed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  card: { gap: space.md },
  loadingHeader: { gap: 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  toolbarText: { flex: 1, gap: 2 },
  caption: { fontSize: 10.5, lineHeight: 15, marginTop: -space.xs },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 1 },
  summaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  summaryValue: { fontSize: 17, fontWeight: '600' },
  summaryLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.3 },
  distribution: {
    flexDirection: 'row',
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: -space.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sortRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  sortLabel: { ...type.label, fontSize: 9, letterSpacing: 0.4 },
  resultLine: { fontSize: 10.5 },
  list: { gap: 0 },
  row: { paddingVertical: space.sm, gap: space.sm },
  rowPressed: { opacity: 0.72 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowText: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowTitle: { flexShrink: 1, fontSize: 12.5, fontWeight: '500' },
  rowMeta: { fontSize: 9.5, lineHeight: 13 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  rowPe: { fontSize: 13, fontWeight: '600' },
  details: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  detailRow: { flexDirection: 'row', gap: space.md },
  detailDivider: { height: StyleSheet.hairlineWidth },
  detailCell: { flex: 1, gap: 1 },
  detailLabel: { ...type.label, fontSize: 8, letterSpacing: 0.3 },
  detailValue: { fontSize: 10.5, fontWeight: '500', lineHeight: 14 },
  chartBlock: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.xs },
  chartTitle: { fontSize: 11.5, fontWeight: '600' },
  empty: { borderRadius: radius.md, padding: space.lg, alignItems: 'center', gap: space.xs },
  emptyTitle: { fontSize: 12.5, fontWeight: '600' },
  clear: { fontSize: 12, fontWeight: '600' },
  cutoff: { fontSize: 10, lineHeight: 14 },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
