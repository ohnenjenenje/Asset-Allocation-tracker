import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { indexEntryVerdict } from '@/src/features/market/entrySignal';
import {
  indiaPeSourceLabel,
  useIndiaPe,
  type IndiaIndexValuation,
} from '@/src/features/market/indiaPe';
import {
  formatAsOf,
  formatPe,
  ordinalPercentile,
  peZoneLabel,
} from '@/src/features/market/peFormat';
import {
  describeMedianPosition,
  discountToMedian,
} from '@/src/features/market/peMetrics';
import {
  classifyPePercentile,
  peBoundaryLabel,
} from '@/src/features/market/peSignal';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { MarketSignalBadge } from './MarketSignalBadge';
import { PePercentileScale } from './PePercentileScale';
import { SignalCard } from './SignalCard';

function peerMeta(peer: IndiaIndexValuation): string {
  const percentile = peer.history?.percentile ?? null;
  if (percentile == null) return 'History still building';
  const discount = discountToMedian(peer.pe, peer.history?.medianPe ?? null);
  return `${ordinalPercentile(percentile)} pct · ${describeMedianPosition(discount) ?? 'median unavailable'}`;
}

/** Compact Nifty 50 signal; the detail screen carries every valuation metric. */
export function IndiaPeSignalCard() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, refetch } = useIndiaPe();
  const open = () => router.push('/research/india-pe');

  if (isLoading && !data) {
    return (
      <SignalCard
        icon="bar-chart-2"
        tint={colors.accent}
        tintSoft={colors.accentSoft}
        title="India index P/E"
        subtitle="Loading end-of-day valuations…"
        onPress={open}
        accessibilityLabel="Open the India index P/E signal"
      >
        <Skeleton height={38} width="45%" />
        <Skeleton height={52} borderRadius={radius.md} />
        <Skeleton height={64} borderRadius={radius.md} />
      </SignalCard>
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
  const boundary = peBoundaryLabel(percentile);
  const discount = discountToMedian(primary.pe, history?.medianPe ?? null);
  const peers = data.indices
    .filter((index) => index.featured && index.key !== primary.key)
    .slice(0, 3);
  const sourceLabel = indiaPeSourceLabel(data);
  const asOfLabel = `${formatAsOf(data.asOf)}${data.stale ? ' · last known' : ''}`;

  return (
    <SignalCard
      icon="bar-chart-2"
      tint={colors.accent}
      tintSoft={colors.accentSoft}
      title="India index P/E"
      subtitle={`${primary.name} against its own five-year history`}
      badge={<MarketSignalBadge label={entry.label} tone={entry.tone} icon={entry.icon} />}
      onPress={open}
      accessibilityLabel="Open the India index P/E signal"
      footer={
        <>
          <Text style={[styles.footerText, { color: colors.muted }]}>
            {sourceLabel} · {asOfLabel}
          </Text>
          <Text style={[styles.footerSub, { color: colors.muted }]}>
            Tap for P/B, dividend yield, sources and the full peer table
          </Text>
        </>
      }
    >
      <View style={styles.hero}>
        <View style={styles.heroMain}>
          <Text style={[styles.heroName, { color: colors.textSecondary }]}>{primary.name}</Text>
          <View style={styles.peLine}>
            <Text style={[styles.peValue, numeric, { color: colors.text }]}>
              {formatPe(primary.pe)}
            </Text>
            <Text style={[styles.peUnit, { color: colors.muted }]}>P/E</Text>
          </View>
        </View>
        <View style={styles.heroMeta}>
          <Text style={[styles.heroZone, { color: colors.text }]}>{peZoneLabel(zone)}</Text>
          <Text style={[styles.heroPercentile, numeric, { color: colors.muted }]}>
            {percentile != null ? `${ordinalPercentile(percentile)} pct` : 'No percentile'}
          </Text>
        </View>
      </View>

      <Text style={[styles.metaLine, { color: colors.muted }]}>
        {history
          ? `5y median ${formatPe(history.medianPe)} · ${history.sampleMonths} months · ${
              describeMedianPosition(discount) ?? 'median unavailable'
            }`
          : 'Five-year history is still building; only the current multiple is shown.'}
      </Text>

      {percentile != null ? <PePercentileScale percentile={percentile} compact /> : null}

      {boundary ? (
        <Text style={[styles.boundary, { color: colors.warning }]}>{boundary}</Text>
      ) : null}

      <View style={[styles.stats, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Median</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {formatPe(history?.medianPe ?? null)}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Percentile</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {percentile != null ? ordinalPercentile(percentile) : '—'}
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statLabel, { color: colors.muted }]}>Window</Text>
          <Text style={[styles.statValue, numeric, { color: colors.text }]}>
            {history ? `${history.sampleMonths} mo` : '—'}
          </Text>
        </View>
      </View>

      {peers.length > 0 ? (
        <View style={[styles.peers, { borderTopColor: colors.border }]}>
          <Text style={[styles.peersTitle, { color: colors.muted }]}>Featured indices</Text>
          {peers.map((peer) => {
            const peerZone = classifyPePercentile(peer.history?.percentile ?? null);
            const peerEntry = indexEntryVerdict(peerZone);
            return (
              <View key={peer.key} style={styles.peerRow}>
                <View style={styles.peerName}>
                  <Text style={[styles.peerTitle, { color: colors.text }]} numberOfLines={1}>
                    {peer.name}
                  </Text>
                  <Text style={[styles.peerMeta, { color: colors.muted }]} numberOfLines={1}>
                    {peerMeta(peer)}
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
      ) : null}
    </SignalCard>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md },
  heroMain: { flex: 1, gap: 1 },
  heroName: { fontSize: 12, fontWeight: '500' },
  peLine: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  peValue: { fontSize: 36, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },
  peUnit: { fontSize: 12, fontWeight: '600' },
  heroMeta: { alignItems: 'flex-end', gap: 1, paddingBottom: 4 },
  heroZone: { fontSize: 12, fontWeight: '600' },
  heroPercentile: { fontSize: 10.5 },
  metaLine: { fontSize: 10.5, lineHeight: 15, marginTop: -space.xs },
  boundary: { fontSize: 10, fontWeight: '600', marginTop: -space.xs },
  stats: {
    flexDirection: 'row',
    borderRadius: radius.md,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
  },
  stat: { flex: 1, gap: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: space.sm },
  statLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.4 },
  statValue: { fontSize: 13, fontWeight: '600' },
  peers: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.sm },
  peersTitle: { ...type.label, fontSize: 8.5, letterSpacing: 0.5 },
  peerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  peerName: { flex: 1, gap: 1 },
  peerTitle: { fontSize: 11.5, fontWeight: '500' },
  peerMeta: { fontSize: 9 },
  peerPe: { fontSize: 12, fontWeight: '600' },
  footerText: { fontSize: 10.5 },
  footerSub: { fontSize: 9.5, marginTop: 1 },
});
