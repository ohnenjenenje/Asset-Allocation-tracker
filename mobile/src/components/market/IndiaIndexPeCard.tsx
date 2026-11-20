import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
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
  historyComparison,
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
import {
  classifyPePercentile,
  peBoundaryLabel,
} from '@/src/features/market/peSignal';
import { formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { MarketSignalBadge } from './MarketSignalBadge';
import { PePercentileScale } from './PePercentileScale';

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
  const entry = indexEntryVerdict(zone);
  const entryColor =
    entry.tone === 'positive'
      ? colors.positive
      : entry.tone === 'warning'
        ? colors.warning
        : entry.tone === 'accent'
          ? colors.accent
          : colors.muted;
  const discount = discountToMedian(primary.pe, history?.medianPe ?? null);
  const boundary = peBoundaryLabel(percentile);
  const peers = data.indices.filter(
    (index) => index.featured && index.key !== primary.key,
  );
  const sourceLabel = indiaPeSourceLabel(data);
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
                {formatPe(primary.pe)}
              </Text>
              <Text style={[styles.peUnit, { color: colors.muted }]}>P/E</Text>
            </View>
          </View>
          <MarketSignalBadge
            label={entry.label}
            tone={entry.tone}
            icon={entry.icon}
          />
        </View>
        <Text style={[styles.heroMeta, { color: colors.muted }]}>
          {peZoneLabel(zone)} valuation · 5y median {formatPe(history?.medianPe ?? null)}
          {percentile != null ? ` · ${ordinalPercentile(percentile)} percentile` : ''}
        </Text>
        <Text style={[styles.entryHeadline, { color: entryColor }]}>
          {entry.headline}
        </Text>
      </View>

      <View style={[styles.stats, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>P/B</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {formatPe(primary.pb)}
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
            <Text style={[styles.historyPercentile, numeric, { color: entryColor }]}>
              {ordinalPercentile(percentile)}
            </Text>
          </View>
          <PePercentileScale percentile={percentile} showCutoffs />
          {boundary ? (
            <Text style={[styles.boundary, { color: colors.warning }]}>{boundary}</Text>
          ) : null}
          <Text style={[styles.historyDetail, { color: colors.muted }]}>
            {historyComparison(history) ?? 'History baseline unavailable.'}
          </Text>
        </View>
      ) : (
        <Text style={[styles.historyDetail, { color: colors.muted }]}>
          Five-year history is unavailable, so only the current multiple is shown.
        </Text>
      )}

      <View style={[styles.details, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.detailRow}>
          <DetailCell label="5y median" value={formatPe(history?.medianPe ?? null)} />
          <DetailCell
            label="Vs median"
            value={describeMedianPosition(discount) ?? '—'}
          />
        </View>
        <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
        <View style={styles.detailRow}>
          <DetailCell label="History window" value={formatHistoryWindow(history)} />
          <DetailCell
            label="Sample"
            value={history ? `${history.sampleMonths} months` : '—'}
          />
        </View>
        <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
        <View style={styles.detailRow}>
          <DetailCell
            label="Current source"
            value={currentSourceLabel(primary.currentSource)}
          />
          <DetailCell
            label="History source"
            value={historySourceLabel(primary.historySource)}
          />
        </View>
      </View>

      <View style={[styles.peers, { borderTopColor: colors.border }]}>
        {peers.map((peer) => {
          const peerZone = classifyPePercentile(peer.history?.percentile ?? null);
          const peerEntry = indexEntryVerdict(peerZone);
          const peerPercentile = peer.history?.percentile;
          const peerDiscount = discountToMedian(peer.pe, peer.history?.medianPe ?? null);
          const peerRelative = relativePe(peer.pe, primary.pe);
          return (
            <View key={peer.key} style={styles.peerRow}>
              <View style={styles.peerName}>
                <Text style={[styles.peerTitle, { color: colors.text }]}>{peer.name}</Text>
                <Text style={[styles.peerMeta, { color: colors.muted }]} numberOfLines={2}>
                  {peerPercentile != null
                    ? `${peZoneLabel(peerZone)} · ${ordinalPercentile(peerPercentile)} pct · median ${formatPe(
                        peer.history?.medianPe ?? null,
                      )} · ${describeMedianPosition(peerDiscount) ?? 'median unavailable'}`
                    : 'History unavailable'}
                  {peerRelative != null ? ` · ${formatRelativePe(peerRelative)} Nifty 50` : ''}
                </Text>
              </View>
              <Text style={[styles.peerPe, numeric, { color: colors.text }]}>
                {formatPe(peer.pe)}
              </Text>
              <Badge label={peerEntry.label} tone={peerEntry.tone} />
            </View>
          );
        })}
      </View>

      <Text style={[styles.note, { color: colors.muted }]}>
        P/E is price divided by trailing earnings. Percentiles compare each index with its own last
        60 monthly readings; the bottom quartile includes the 25th-percentile boundary. The median
        discount is secondary context, not a separate signal. History uses post-2021 consolidated
        earnings.
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
  entryHeadline: { fontSize: 11.5, fontWeight: '600' },
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
  boundary: { fontSize: 10, fontWeight: '600', marginTop: -space.xs },
  historyDetail: { fontSize: 10.5, lineHeight: 15 },
  details: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  detailRow: { flexDirection: 'row', gap: space.md },
  detailDivider: { height: StyleSheet.hairlineWidth },
  detailCell: { flex: 1, gap: 1 },
  detailLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.4 },
  detailValue: { fontSize: 11, fontWeight: '500', lineHeight: 15 },
  peers: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.sm },
  peerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  peerName: { flex: 1, gap: 1 },
  peerTitle: { fontSize: 12, fontWeight: '500' },
  peerMeta: { fontSize: 9.5, lineHeight: 13 },
  peerPe: { fontSize: 13, fontWeight: '600' },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
