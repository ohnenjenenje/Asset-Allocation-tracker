import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, type BadgeTone } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import {
  useIndiaPe,
  type IndiaIndexValuation,
} from '@/src/features/market/indiaPe';
import {
  classifyPePercentile,
  type PeZone,
} from '@/src/features/market/peSignal';
import { formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

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

function zoneTone(zone: PeZone): BadgeTone {
  switch (zone) {
    case 'cheap':
      return 'positive';
    case 'expensive':
      return 'warning';
    case 'fair':
      return 'neutral';
    default:
      return 'neutral';
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

function historyComparison(index: IndiaIndexValuation): string | null {
  const history = index.history;
  if (!history || history.percentile == null) return null;

  const percentile = history.percentile;
  const share = Math.round(percentile <= 50 ? 100 - percentile : percentile);
  const direction = percentile <= 50 ? 'Cheaper' : 'More expensive';
  return `${direction} than ${share}% of the last ${history.sampleMonths} months`;
}

/**
 * Valuation context, not a forecast. Each index is compared with its own
 * five-year monthly history so a high-multiple sector is not framed as
 * expensive merely because it trades above a broad-market P/E.
 */
export function IndiaIndexPeCard() {
  const { colors } = useTheme();
  const { data, error, isLoading, isFetching, refetch } = useIndiaPe();

  if (isLoading && !data) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
            <Feather name="bar-chart-2" size={16} color={colors.accent} />
          </View>
          <View style={styles.headerText}>
            <Text style={[type.title, { color: colors.text }]}>India index P/E</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              Loading end-of-day valuations…
            </Text>
          </View>
        </View>
        <Skeleton height={40} width="45%" />
        <Skeleton height={56} borderRadius={radius.md} />
        <Skeleton height={64} borderRadius={radius.md} />
      </Card>
    );
  }

  const primary = data?.indices.find((index) => index.key === 'nifty50') ?? data?.indices[0];
  if (!data || !primary || primary.pe == null) {
    return (
      <Card>
        <ErrorState
          title="Valuations unavailable"
          message={
            error instanceof Error
              ? error.message
              : 'NSE index valuations could not be loaded. Check the connection and try again.'
          }
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  const history = primary.history;
  const percentile = history?.percentile ?? null;
  const zone = classifyPePercentile(percentile);
  const tone = zoneTone(zone);
  const zoneColor =
    zone === 'cheap' ? colors.positive : zone === 'expensive' ? colors.warning : colors.muted;
  const markerPosition = `${Math.min(Math.max(percentile ?? 0, 0), 100)}%` as `${number}%`;
  const peers = data.indices.filter((index) => index.key !== primary.key);
  const sourceLabel =
    data.source === 'downstox'
      ? 'Downstox fallback'
      : data.source === 'mixed'
        ? 'NSE + Downstox'
        : 'NSE close';
  const asOfLabel = `${formatAsOf(data.asOf)}${data.stale ? ' · last known' : ''}`;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
          <Feather name="bar-chart-2" size={16} color={colors.accent} />
        </View>
        <View style={styles.headerText}>
          <Text style={[type.title, { color: colors.text }]}>India index P/E</Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {sourceLabel} · {asOfLabel}
          </Text>
        </View>
        <IconButton
          icon="refresh-cw"
          variant="plain"
          size={32}
          onPress={() => void refetch()}
          accessibilityLabel="Refresh Indian index valuations"
          disabled={isFetching}
        />
      </View>

      <View style={styles.hero}>
        <View style={styles.heroRow}>
          <View style={styles.heroName}>
            <Text style={[type.bodyMedium, { color: colors.textSecondary }]}>{primary.name}</Text>
            <View style={styles.peLine}>
              <Text style={[styles.peValue, numeric, { color: colors.text }]}>
                {formatNumber(primary.pe)}
              </Text>
              <Text style={[styles.peUnit, { color: colors.muted }]}>P/E</Text>
            </View>
          </View>
          <Badge label={zoneLabel(zone)} tone={tone} />
        </View>
        <Text style={[styles.heroMeta, { color: colors.muted }]}>
          5y median {formatNumber(history?.medianPe ?? null)}
          {percentile != null ? ` · ${ordinal(percentile)} percentile` : ''}
        </Text>
      </View>

      <View style={[styles.stats, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>P/B</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {formatNumber(primary.pb)}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Div yield</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {primary.dividendYield != null ? formatPercent(primary.dividendYield) : '—'}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Earnings yield</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {primary.earningsYield != null ? formatPercent(primary.earningsYield) : '—'}
          </Text>
        </View>
      </View>

      {percentile != null ? (
        <View style={styles.history}>
          <View style={styles.historyHeader}>
            <Text style={[styles.historyTitle, { color: colors.text }]}>
              Versus its own 5-year history
            </Text>
            <Text style={[styles.historyPercentile, numeric, { color: zoneColor }]}>
              {ordinal(percentile)}
            </Text>
          </View>
          <View style={styles.scale}>
            <View style={styles.scaleTrack}>
              <View
                style={[styles.scaleSegment, { flex: 25, backgroundColor: colors.positiveSoft }]}
              />
              <View
                style={[styles.scaleSegment, { flex: 50, backgroundColor: colors.cardMuted }]}
              />
              <View
                style={[styles.scaleSegment, { flex: 25, backgroundColor: colors.warningSoft }]}
              />
            </View>
            <View
              style={[styles.scaleMarker, { left: markerPosition, backgroundColor: zoneColor }]}
            />
            <View style={styles.scaleLabels}>
              <Text style={[styles.scaleLabel, { flex: 25, color: colors.positive }]}>Cheap</Text>
              <Text
                style={[
                  styles.scaleLabel,
                  styles.scaleLabelCenter,
                  { flex: 50, color: colors.muted },
                ]}
              >
                Fair
              </Text>
              <Text
                style={[
                  styles.scaleLabel,
                  styles.scaleLabelRight,
                  { flex: 25, color: colors.warning },
                ]}
              >
                Expensive
              </Text>
            </View>
          </View>
          <Text style={[styles.historyDetail, { color: colors.muted }]}>
            {historyComparison(primary) ?? 'History baseline unavailable.'}
          </Text>
        </View>
      ) : (
        <Text style={[styles.historyDetail, { color: colors.muted }]}>
          Five-year history is unavailable, so only the current multiple is shown.
        </Text>
      )}

      <View style={[styles.peers, { borderTopColor: colors.border }]}>
        {peers.map((peer) => {
          const peerZone = classifyPePercentile(peer.history?.percentile ?? null);
          const peerPercentile = peer.history?.percentile;
          return (
            <View key={peer.key} style={styles.peerRow}>
              <View style={styles.peerName}>
                <Text style={[styles.peerTitle, { color: colors.text }]}>{peer.name}</Text>
                <Text style={[styles.peerMeta, { color: colors.muted }]}>
                  {peer.history != null && peerPercentile != null
                    ? `${ordinal(peerPercentile)} pct · median ${formatNumber(
                        peer.history.medianPe,
                      )}`
                    : 'History unavailable'}
                </Text>
              </View>
              <Text style={[styles.peerPe, numeric, { color: colors.text }]}>
                {formatNumber(peer.pe)}
              </Text>
              <Badge label={zoneLabel(peerZone)} tone={zoneTone(peerZone)} />
            </View>
          );
        })}
      </View>

      <Text style={[styles.note, { color: colors.muted }]}>
        P/E is price divided by trailing earnings. Percentiles compare each index with its own last
        60 monthly readings; they describe the past, not a forecast. History uses post-2021
        consolidated earnings.
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
  hero: { gap: 2 },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md },
  heroName: { flex: 1, gap: 1 },
  peLine: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  peValue: { fontSize: 40, lineHeight: 44, fontWeight: '600', letterSpacing: -1.2 },
  peUnit: { fontSize: 13, fontWeight: '600' },
  heroMeta: { fontSize: 11 },
  stats: {
    flexDirection: 'row',
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  stat: { flex: 1, gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: space.sm },
  statLabel: { ...type.label, fontSize: 9.5, letterSpacing: 0.4 },
  statValue: { fontSize: 15, fontWeight: '600' },
  history: { gap: space.sm },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyTitle: { fontSize: 12, fontWeight: '600' },
  historyPercentile: { fontSize: 12, fontWeight: '600' },
  scale: { position: 'relative' },
  scaleTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  scaleSegment: { height: '100%' },
  scaleMarker: {
    position: 'absolute',
    top: -3,
    width: 3,
    height: 12,
    borderRadius: 2,
    marginLeft: -1.5,
  },
  scaleLabels: { flexDirection: 'row', marginTop: 5 },
  scaleLabel: { fontSize: 9, fontWeight: '600' },
  scaleLabelCenter: { textAlign: 'center' },
  scaleLabelRight: { textAlign: 'right' },
  historyDetail: { fontSize: 10.5, lineHeight: 15 },
  peers: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.sm },
  peerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  peerName: { flex: 1, gap: 1 },
  peerTitle: { fontSize: 12, fontWeight: '500' },
  peerMeta: { fontSize: 9.5 },
  peerPe: { fontSize: 13, fontWeight: '600' },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
