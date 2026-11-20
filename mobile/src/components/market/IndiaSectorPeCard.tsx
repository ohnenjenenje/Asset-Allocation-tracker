import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { indexEntryVerdict } from '@/src/features/market/entrySignal';
import {
  indiaPeSourceLabel,
  useIndiaPe,
  type IndiaIndexValuation,
} from '@/src/features/market/indiaPe';
import {
  classifyPePercentile,
  type PeZone,
} from '@/src/features/market/peSignal';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const COLLAPSED_ROWS = 8;

function formatNumber(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function ordinal(value: number): string {
  const rounded = Math.round(value);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`;
    case 2:
      return `${rounded}nd`;
    case 3:
      return `${rounded}rd`;
    default:
      return `${rounded}th`;
  }
}

function zoneLabel(zone: PeZone): string {
  switch (zone) {
    case 'cheap':
      return 'Cheap';
    case 'expensive':
      return 'Expensive';
    case 'fair':
      return 'Fair';
    default:
      return 'No history';
  }
}

function formatAsOf(value: string | null): string {
  if (!value) return 'date unavailable';
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return value;
  }
}

/**
 * Cheapest percentile first, because the list is an entry screen. Indices
 * without enough monthly readings still show their current P/E at the end.
 */
function sortByPercentile(indices: IndiaIndexValuation[]): IndiaIndexValuation[] {
  return [...indices].sort((a, b) => {
    const aPercentile = a.history?.percentile ?? null;
    const bPercentile = b.history?.percentile ?? null;
    if (aPercentile == null && bPercentile == null) return a.name.localeCompare(b.name);
    if (aPercentile == null) return 1;
    if (bPercentile == null) return -1;
    if (aPercentile !== bPercentile) return aPercentile - bPercentile;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Every sectoral and thematic index NSE publishes, benchmarked against its own
 * history. This is deliberately separate from the headline card so the Nifty 50
 * view stays focused and the long tail stays one tap away.
 */
export function IndiaSectorPeCard() {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { data, error, isLoading, isFetching, refetch } = useIndiaPe();

  if (isLoading && !data) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
            <Feather name="pie-chart" size={16} color={colors.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={[type.title, { color: colors.text }]}>Sector valuations</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              Loading every NSE sector and thematic index…
            </Text>
          </View>
        </View>
        <Skeleton height={58} borderRadius={radius.md} />
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} height={42} borderRadius={radius.md} />
        ))}
      </Card>
    );
  }

  const indices = data?.indices.filter((index) => index.category !== 'broad') ?? [];
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

  const rows = sortByPercentile(indices);
  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  let buyZone = 0;
  let neutral = 0;
  let expensive = 0;
  let noSignal = 0;
  for (const index of rows) {
    const zone = classifyPePercentile(index.history?.percentile ?? null);
    if (zone === 'cheap') buyZone += 1;
    else if (zone === 'expensive') expensive += 1;
    else if (zone === 'fair') neutral += 1;
    else noSignal += 1;
  }

  const sourceLabel = indiaPeSourceLabel(data);
  const asOfLabel = `${formatAsOf(data.asOf)}${data.stale ? ' · last known' : ''}`;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <Feather name="pie-chart" size={16} color={colors.accent} />
        </View>
        <View style={styles.headerText}>
          <Text style={[type.title, { color: colors.text }]}>Sector valuations</Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {rows.length} NSE indices · {sourceLabel} · {asOfLabel}
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

      <View style={[styles.summary, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, numeric, { color: colors.positive }]}>
            {buyZone}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Buy zone</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>{neutral}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Neutral</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, numeric, { color: colors.warning }]}>
            {expensive}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Expensive</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, numeric, { color: colors.muted }]}>
            {noSignal}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>No signal</Text>
        </View>
      </View>

      <View style={styles.list}>
        {visibleRows.map((index, row) => {
          const zone = classifyPePercentile(index.history?.percentile ?? null);
          const entry = indexEntryVerdict(zone);
          const percentile = index.history?.percentile ?? null;
          const meta =
            percentile != null
              ? `${zoneLabel(zone)} · ${ordinal(percentile)} pct · median ${formatNumber(
                  index.history?.medianPe ?? null,
                )}`
              : 'Current P/E only · history still building';

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
                <Text
                  style={[styles.rowTitle, { color: colors.text }]}
                  numberOfLines={1}
                >
                  {index.name}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
                  {meta}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowPe, numeric, { color: colors.text }]}>
                  {formatNumber(index.pe)}
                </Text>
                <Badge label={entry.label} tone={entry.tone} />
              </View>
            </View>
          );
        })}
      </View>

      {rows.length > COLLAPSED_ROWS ? (
        <Button
          label={
            expanded
              ? `Show cheapest ${COLLAPSED_ROWS}`
              : `Show all ${rows.length} indices`
          }
          icon={expanded ? 'chevron-up' : 'chevron-down'}
          variant="ghost"
          size="sm"
          fullWidth
          onPress={() => setExpanded((value) => !value)}
          accessibilityHint={
            expanded
              ? 'Collapse the list back to the cheapest indices'
              : 'Expand to every sector and thematic index'
          }
        />
      ) : null}

      <Text style={[styles.note, { color: colors.muted }]}>
        Sorted cheapest first. Percentiles compare each index with its own last 60 monthly
        readings; newer indices show their current P/E until 24 monthly readings accumulate.
        History uses NSE month-end archives, with Downstox filling any missing window. Current
        values fall back to Downstox, then the official Nifty Indices feed.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
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
  summaryLabel: { ...type.label, fontSize: 9, letterSpacing: 0.3 },
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 12.5, fontWeight: '500' },
  rowMeta: { fontSize: 9.5 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  rowPe: { fontSize: 13, fontWeight: '600' },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
