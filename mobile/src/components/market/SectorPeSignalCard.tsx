import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { indexEntryVerdict } from '@/src/features/market/entrySignal';
import { indiaPeSourceLabel, useIndiaPe } from '@/src/features/market/indiaPe';
import {
  formatAsOf,
  formatPe,
  ordinalPercentile,
} from '@/src/features/market/peFormat';
import { describeMedianPosition, discountToMedian } from '@/src/features/market/peMetrics';
import { classifyPePercentile } from '@/src/features/market/peSignal';
import {
  countAtCutoff,
  sortSectorIndices,
  summarizePeZones,
} from '@/src/features/market/sectorView';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { SignalCard } from './SignalCard';

/** Compact sector summary; the detail screen carries every index and filter. */
export function SectorPeSignalCard() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, refetch } = useIndiaPe();
  const open = () => router.push('/research/sectors');

  if (isLoading && !data) {
    return (
      <SignalCard
        icon="pie-chart"
        tint={colors.accent}
        tintSoft={colors.accentSoft}
        title="Sector valuations"
        subtitle="Loading every NSE sector and thematic index…"
        onPress={open}
        accessibilityLabel="Open sector valuations"
      >
        <Skeleton height={54} borderRadius={radius.md} />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} height={36} borderRadius={radius.md} />
        ))}
      </SignalCard>
    );
  }

  const sectors = data?.indices.filter((index) => index.category !== 'broad') ?? [];
  if (!data || sectors.length === 0) {
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

  const counts = summarizePeZones(sectors);
  const cutoff = countAtCutoff(sectors);
  const rows = sortSectorIndices(sectors, 'percentile').slice(0, 3);
  const sourceLabel = indiaPeSourceLabel(data);
  const asOfLabel = `${formatAsOf(data.asOf)}${data.stale ? ' · last known' : ''}`;
  const segments = [
    { key: 'buy', count: counts.buyZone, color: colors.positive },
    { key: 'neutral', count: counts.neutral, color: colors.muted },
    { key: 'expensive', count: counts.expensive, color: colors.warning },
    { key: 'none', count: counts.noSignal, color: colors.border },
  ];

  return (
    <SignalCard
      icon="pie-chart"
      tint={colors.accent}
      tintSoft={colors.accentSoft}
      title="Sector valuations"
      subtitle={`${counts.total} sector & thematic indices · ${counts.buyZone + counts.neutral + counts.expensive} with signals`}
      badge={<Badge label={`${counts.buyZone} buy`} tone="positive" />}
      onPress={open}
      accessibilityLabel="Open sector valuations"
      footer={
        <>
          <Text style={[styles.footerText, { color: colors.muted }]}>
            {sourceLabel} · {asOfLabel}
          </Text>
          <Text style={[styles.footerSub, { color: colors.muted }]}>
            Tap for all 45 indices, filters, search and median discounts
          </Text>
        </>
      }
    >
      <View style={[styles.summary, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, numeric, { color: colors.positive }]}>
            {counts.buyZone}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Buy</Text>
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

      <View style={styles.list}>
        {rows.map((index, row) => {
          const percentile = index.history?.percentile ?? null;
          const zone = classifyPePercentile(percentile);
          const entry = indexEntryVerdict(zone);
          const discount = discountToMedian(index.pe, index.history?.medianPe ?? null);
          return (
            <View
              key={index.key}
              style={[
                styles.row,
                row > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
              ]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                  {index.name}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
                  {percentile != null
                    ? `${ordinalPercentile(percentile)} pct · ${describeMedianPosition(discount) ?? 'median unavailable'}`
                    : 'Current P/E only · history still building'}
                </Text>
              </View>
              <Text style={[styles.rowPe, numeric, { color: colors.text }]}>
                {formatPe(index.pe)}
              </Text>
              <Badge label={entry.label} tone={entry.tone} />
            </View>
          );
        })}
      </View>

      {cutoff > 0 ? (
        <Text style={[styles.cutoff, { color: colors.warning }]}>
          {cutoff} {cutoff === 1 ? 'index sits' : 'indices sit'} exactly at the 25th-percentile
          buy cutoff.
        </Text>
      ) : null}
    </SignalCard>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 1 },
  summaryDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  summaryValue: { fontSize: 16, fontWeight: '600' },
  summaryLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.3 },
  distribution: {
    flexDirection: 'row',
    height: 5,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: -space.xs,
  },
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12, fontWeight: '500' },
  rowMeta: { fontSize: 9.5 },
  rowPe: { fontSize: 12.5, fontWeight: '600' },
  cutoff: { fontSize: 10, lineHeight: 14 },
  footerText: { fontSize: 10.5 },
  footerSub: { fontSize: 9.5, marginTop: 1 },
});
